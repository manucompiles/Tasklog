import {
  createSdkMcpServer,
  query,
  tool,
  type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { ZodRawShape, z } from "zod";

/**
 * The companion's AI provider seam (#87, P87 Decision 1).
 *
 * The interface is shaped around MESSAGES + TOOLS (not `complete(text)`) on purpose:
 * a raw Anthropic Messages-API tool loop or a local model can implement the same
 * contract later without the route changing. v4.0 ships one implementation -
 * ClaudeCodeProvider - which runs each turn on the user's own Claude subscription
 * via the Agent SDK (no API key, Decision 8: PC-first).
 */

/** Events a provider yields while running one conversational turn. */
export type CompanionTurnEvent =
  | { type: "text_delta"; text: string }
  | { type: "card"; capture: unknown }
  // v4.1 (#92): the autonomous writers' receipt - the entity was already
  // created; the chip is an affordance to edit/undo, never an approval ask.
  | { type: "receipt"; capture: unknown; entity?: unknown }
  | { type: "done"; sdkSessionId: string | null; text: string }
  // partialText carries whatever streamed before the failure so the caller can
  // still persist it - words shown to the user must never exist only on screen.
  | { type: "error"; message: string; partialText?: string };

/**
 * One tool the companion may call mid-turn. `handler` returns the payload sent
 * back to the model; when it also returns `event`, the provider forwards it to
 * the client stream (how a propose_capture card reaches the UI live).
 */
export interface CompanionTool<Shape extends ZodRawShape = ZodRawShape> {
  name: string;
  description: string;
  schema: Shape;
  handler: (args: z.infer<z.ZodObject<Shape>>) => Promise<{
    result: unknown;
    event?: CompanionTurnEvent;
  }>;
}

export interface CompanionTurnInput {
  /** The user's new message (one turn; history lives in the resumed session). */
  message: string;
  /** Provider-native session id from the previous turn; null starts fresh. */
  resumeSessionId: string | null;
  /** Full system prompt: the persona spec + injected grounding context. */
  systemPrompt: string;
  tools: CompanionTool[];
}

export interface CompanionProvider {
  runTurn(input: CompanionTurnInput): AsyncGenerator<CompanionTurnEvent>;
}

/**
 * Claude Code implementation. Per-turn `query()` with `resume` (P87 Decision 9):
 * Next.js route handlers are request-scoped, so no long-lived session object is
 * held across requests - the SDK's own session storage carries the conversation.
 */
export class ClaudeCodeProvider implements CompanionProvider {
  async *runTurn(input: CompanionTurnInput): AsyncGenerator<CompanionTurnEvent> {
    // Tool events land here while the SDK is mid-message; the loop below flushes
    // the queue between SDK messages so cards stream out in order.
    const pending: CompanionTurnEvent[] = [];

    const server = createSdkMcpServer({
      name: "companion",
      version: "1.0.0",
      // Without this the SDK defers MCP tools behind ToolSearch (which the
      // companion disables below) - the writers must live in the prompt itself.
      alwaysLoad: true,
      tools: input.tools.map((t) =>
        tool(t.name, t.description, t.schema, async (args) => {
          const { result, event } = await t.handler(
            args as Parameters<typeof t.handler>[0],
          );
          if (event) pending.push(event);
          return { content: [{ type: "text", text: JSON.stringify(result) }] };
        }),
      ),
    });

    const q = query({
      prompt: input.message,
      options: {
        cwd: process.cwd(),
        ...(input.resumeSessionId ? { resume: input.resumeSessionId } : {}),
        // A fully custom system prompt: Sage must NOT inherit the claude_code
        // coding persona, and settingSources: [] keeps CLAUDE.md files (global
        // and repo) out of an intimate journaling context.
        systemPrompt: input.systemPrompt,
        settingSources: [],
        includePartialMessages: true,
        permissionMode: "default",
        mcpServers: { companion: server },
        // The companion is a conversation, not an agent loose in the repo:
        // tools: [] removes the ENTIRE built-in toolset (the old deny-list
        // approach missed modern harness names, and a "*" deny removed even our
        // own MCP tools - both found live, 12 Sep). allowedTools auto-approves
        // the writers, which is exactly right: they are AUTONOMOUS (plan D1),
        // there is no approval step left to shadow.
        tools: [],
        allowedTools: input.tools.map((t) => `mcp__companion__${t.name}`),
        // The user's claude.ai connectors (Tasklog/Spotify/Drive) leak in from
        // the logged-in CLI config otherwise - an intimate journal must not see
        // them. strict = only the mcpServers passed right here exist.
        strictMcpConfig: true,
        // Belt over braces: anything unexpected is denied at call time.
        canUseTool: async (toolName, toolInput) =>
          toolName.startsWith("mcp__companion__")
            ? { behavior: "allow", updatedInput: toolInput }
            : { behavior: "deny", message: "Tool not available in the companion.", interrupt: false },
        // Bounds a runaway tool loop. 12 = enough for a long brain dump
        // (find + propose per actionable, ~5-6 items); when it IS hit, the
        // streamed-text fallback below still preserves the reply.
        maxTurns: 12,
      },
    });

    let sdkSessionId: string | null = input.resumeSessionId;
    let finalText = "";
    // Everything streamed so far. THE fallback for finalText: on a non-"success"
    // result (error_max_turns etc.) the SDK gives no result string, but the user
    // already watched this text - it must reach the transcript (review R2).
    let streamed = "";

    try {
      for await (const msg of q as AsyncIterable<SDKMessage>) {
        while (pending.length > 0) yield pending.shift()!;

        if (msg.type === "system" && msg.subtype === "init") {
          sdkSessionId = msg.session_id;
        } else if (msg.type === "stream_event") {
          // Partial-message stream: surface assistant text as it is generated.
          const ev = msg.event as {
            type?: string;
            delta?: { type?: string; text?: string };
          };
          if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) {
            streamed += ev.delta.text;
            yield { type: "text_delta", text: ev.delta.text };
          }
        } else if (msg.type === "result") {
          finalText = msg.subtype === "success" ? msg.result : streamed;
        }
      }
      while (pending.length > 0) yield pending.shift()!;
      yield { type: "done", sdkSessionId, text: finalText || streamed };
    } catch (err) {
      while (pending.length > 0) yield pending.shift()!;
      const message = err instanceof Error ? err.message : String(err);
      // Self-heal a stale resume cursor: if the SDK no longer recognizes the
      // stored session id (cleaned storage, invalid id), rerun the turn fresh
      // instead of bricking the day's session. The new id is saved on `done`.
      // Matched narrowly against the SDK's actual unknown-session wording
      // (review R17): a transient error merely containing "session" must NOT
      // discard the day's conversation memory by re-running fresh.
      if (
        input.resumeSessionId &&
        /--resume requires|not a UUID|No conversation found with session/i.test(message)
      ) {
        yield* this.runTurn({ ...input, resumeSessionId: null });
        return;
      }
      yield { type: "error", message, partialText: streamed || undefined };
    }
  }
}
