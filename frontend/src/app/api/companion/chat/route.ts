import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { localIso } from "@/lib/time";
import {
  ClaudeCodeProvider,
  type CompanionTool,
  type CompanionTurnEvent,
} from "@/lib/companion/provider";

// The companion turn endpoint (#87). One POST = one conversational turn:
//
//   1. get-or-create TODAY's session (server-owned; one session per day)
//   2. append the user's message and SAVE - before any AI runs, so words are
//      never lost even when the model is unreachable (degradability rule)
//   3. stream the Sage turn as NDJSON events (text deltas, proposal cards)
//   4. on completion, save the assistant reply + the SDK session id for resume
//
// Runs on the user's own Claude subscription via the Agent SDK - PC/LAN only in
// v4.0 (P87 Decision 8); this route must not ship to the public OCI instance.
export const dynamic = "force-dynamic";

// Server-to-server base URL: the house convention (lib/api.ts getApiUrl) is the
// private API_URL for server-side code - NEXT_PUBLIC_* is the browser value and
// would loop through the public hostname in a deployed environment (review R14).
const API = process.env.API_URL ?? "http://localhost:5115";

// One chat message is a thought, not a document (review R8). The UI can show
// this limit as a friendly error; the transcript endpoint enforces its own caps.
const MAX_MESSAGE_CHARS = 4000;

// Per-session turn coordination (#91): the Agent SDK allows ONE active turn per
// conversation (a second concurrent resume fails), and a turn is 5-12s on the
// PC and ~50s on the phone brain - so crossing messages are normal, not edge.
// The texting model: the in-flight reply lands as composed; everything sent
// meanwhile queues and drains as ONE combined follow-up turn (each message
// keeps its own time tag), so Sage catches up like a person reading their
// texts. Module-level state is correct here: one Node process per host.
type QueuedTurn = { decorated: string };
const runningSessions = new Set<number>();
const pendingBySession = new Map<number, QueuedTurn[]>();
const MAX_QUEUED_TURNS = 3;

// A one-line NDJSON response for queued / rejected sends: the words are already
// appended by the time this is returned, so closing immediately is safe.
function ndjsonOnce(event: Record<string, unknown>): Response {
  return new Response(JSON.stringify(event) + "\n", {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

// The persona spec is the single authored source of Sage's behavior (and name).
// A file, not inline code, so the same text can serve as claude.ai custom
// instructions later (behavior parity across the two AI doors).
let personaCache: string | null = null;
async function readPersona(): Promise<string> {
  if (personaCache === null) {
    personaCache = await readFile(
      path.join(process.cwd(), "src", "lib", "companion", "persona.md"),
      "utf8",
    );
  }
  return personaCache;
}

interface SessionRow {
  id: number;
  sessionDate: string;
  messages: Array<{ role: string; content: string; at: string }>;
  sdkSessionId: string | null;
}

// localIso comes from lib/time (shared with the client - review R23) so the
// storage format cannot drift between the two writers.

// Sage is a companion, not an oracle: it must know the user's "now" (this
// server IS the user's machine, so server-local time is user-local time).
// Injected per turn - found the hard way when "first thing" cost three turns
// of tonight-vs-tomorrow confusion in the first real conversation.
function nowContext(): string {
  const now = new Date();
  const day = now.toLocaleDateString([], { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const time = now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return `\n\n## Right now\nIt is ${day}, ${time} (the user's local time). Ground words like today, tonight, this morning, and "first thing" in this.\n`;
}

// Time context prepended to the MODEL-facing copy of each user message (#87).
// An XML tag, NOT prose: a plain "[Sat 9:41 AM] ..." prefix blended into the
// user's words and Sage quoted it back as if the user had typed it ("Two hours
// became 'back after ~2h'"). Claude treats XML tags as structure, so machine
// context and human words stay separable. The tag is stored in the SDK
// transcript, so on resume every past message self-describes its clock time
// and any gap is derivable. The DB transcript and the UI always keep the raw
// words; only the model sees this.
function timeContextTag(prevAt: string | undefined): string {
  const now = new Date();
  const stamp = `${now.toLocaleDateString([], { weekday: "short" })} ${now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`;
  let since = "";
  if (prevAt) {
    const prev = new Date(prevAt).getTime();
    const gapMin = Math.round((now.getTime() - prev) / 60000);
    // Salience attribute only for a real break; small gaps are derivable from
    // the absolute stamps anyway and noting each would be noise.
    if (!isNaN(gapMin) && gapMin >= 30) {
      const human = gapMin >= 60 ? `~${Math.round(gapMin / 60)}h` : `~${gapMin}m`;
      since = ` since_last_message="${human}"`;
    }
  }
  return `<app_time now="${stamp}"${since}/>`;
}

async function getOrCreateTodaySession(): Promise<SessionRow> {
  const res = await fetch(`${API}/api/companion/sessions`, { method: "POST" });
  if (!res.ok) throw new Error(`session create failed: ${res.status}`);
  return (await res.json()) as SessionRow;
}

// APPENDS the new turn's lines server-side (review R4): concurrent turns from
// two devices interleave instead of last-write-wins clobbering each other.
// Throws on a non-ok response (review R3) - "your words are saved" must never
// be claimed unverified.
async function appendMessages(
  id: number,
  messages: SessionRow["messages"],
  sdkSessionId?: string | null,
): Promise<void> {
  const res = await fetch(`${API}/api/companion/sessions/${id}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages,
      ...(sdkSessionId ? { sdkSessionId } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`transcript append failed: ${res.status} ${body.slice(0, 200)}`);
  }
}

// Card outcomes, injected per turn: Sage proposes cards but is never told what
// the user did with them - found when it could not answer "is the procureflow
// task created?". This closes that loop (and stops it re-raising kept things).
async function cardContext(sessionId: number): Promise<string> {
  try {
    const res = await fetch(`${API}/api/captures?sessionId=${sessionId}`);
    if (!res.ok) return "";
    const captures = (await res.json()) as Array<{
      id: number;
      status: string;
      payload: { title?: string };
    }>;
    if (captures.length === 0) return "";
    const label = (s: string) =>
      s === "confirmed" ? "KEPT (task created)" : s === "dismissed" ? "TOSSED by the user" : "still pending";
    const lines = captures.map((c) => `- card #${c.id} "${c.payload.title}": ${label(c.status)}`);
    return `\n\n## Your proposal cards this session (live status)\n${lines.join("\n")}\nIf they say a toss was an accident, point them at the Restore button on that card - you cannot restore it yourself.\n`;
  } catch {
    return "";
  }
}

// Grounding context: the real projects/clients list, injected into the system
// prompt so Sage's projectId guesses on task cards are actual ids, not inventions.
async function projectContext(): Promise<string> {
  try {
    const res = await fetch(`${API}/api/projects`);
    if (!res.ok) return "";
    const projects = (await res.json()) as Array<{
      id: number;
      name: string;
      client?: { name: string } | null;
    }>;
    if (projects.length === 0) return "";
    const lines = projects.map(
      (p) => `- ${p.name} (projectId ${p.id}${p.client ? `, area: ${p.client.name}` : ""})`,
    );
    return `\n\n## Current projects (use these ids for projectId guesses)\n${lines.join("\n")}\n`;
  } catch {
    return "";
  }
}

// Today's live ledger, compact (#92 Step 4): what the morning brief and the
// evening's What Moved narrate from. Defaults to no-op on any fetch failure -
// a missing summary degrades the conduct, never the turn.
async function todayContext(): Promise<string> {
  try {
    const [entriesRes, activeRes] = await Promise.all([
      fetch(`${API}/api/time-entries`),
      fetch(`${API}/api/time-entries/active`),
    ]);
    if (!entriesRes.ok) return "";
    const entries = (await entriesRes.json()) as Array<{
      id: number; taskTitle?: string; description?: string;
      startedAt: string; endedAt?: string | null; durationSeconds: number;
    }>;
    const active = activeRes.ok ? await activeRes.json().catch(() => null) : null;
    if (entries.length === 0 && !active) return "";
    const hm = (s: number) => `${Math.floor(s / 3600)}h${String(Math.round((s % 3600) / 60)).padStart(2, "0")}m`;
    const lines = entries.map((e) =>
      `- ${e.startedAt.slice(11, 16)}-${e.endedAt ? e.endedAt.slice(11, 16) : "now"} ${e.taskTitle || e.description || "(untitled)"} (${hm(e.durationSeconds)})`,
    );
    return `\n\n## Today's ledger so far (times are the record - narrate from these, never invent)\n${lines.join("\n")}\n`;
  } catch {
    return "";
  }
}

// The worn knowledge layer (#92 Step 4): Sage's own distilled note sheet,
// loaded into every conversation. Small by contract - one line per pattern.
async function profileNotesContext(): Promise<string> {
  try {
    const res = await fetch(`${API}/api/profile-notes`);
    if (!res.ok) return "";
    const notes = (await res.json()) as Array<{ text: string; kind: string }>;
    if (notes.length === 0) return "";
    const lines = notes.map((n) => `- (${n.kind}) ${n.text}`);
    return `\n\n## What you know about him (your own note sheet - correctable by him)\n${lines.join("\n")}\n`;
  } catch {
    return "";
  }
}

// Sage's in-process tools (#92, plan D1): AUTONOMOUS writers. Each log_* tool
// creates AND confirms a capture in one backend call (autoConfirm) - the entity
// lands immediately, the capture row is the receipt, and the client renders a
// receipt chip (event type "receipt") the user can open to edit/undo. There is
// no propose/approve step anywhere anymore.
function buildTools(sessionId: number): CompanionTool[] {
  // Shared POST /api/captures?autoConfirm helper - one shape for every writer.
  async function logCapture(
    type: string,
    payload: Record<string, unknown>,
    span?: string,
  ): Promise<{ result: Record<string, unknown>; event?: import("@/lib/companion/provider").CompanionTurnEvent }> {
    const res = await fetch(`${API}/api/captures`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, payload, sessionId, span, source: "companion", autoConfirm: true }),
    });
    if (!res.ok) {
      const err = await res.text();
      return { result: { logged: false, error: err } };
    }
    const data = (await res.json()) as { capture?: { id: number }; entity?: unknown; id?: number; status?: string };
    // A deduped task echo returns the bare capture row (already handled once).
    if (data.status === "dismissed")
      return { result: { logged: false, note: "The user already dismissed this exact item. Do not raise it again." } };
    if (!data.capture)
      return { result: { logged: true, note: "Already existed - no duplicate was created." } };
    return {
      result: { logged: true, captureId: data.capture.id, entity: data.entity },
      event: { type: "receipt", capture: data.capture, entity: data.entity },
    };
  }

  const findRelevantTasks: CompanionTool<{ query: z.ZodString }> = {
    name: "find_relevant_tasks",
    description:
      "Semantic search over the user's OPEN tasks. Call this BEFORE logging a task " +
      "to check whether it already exists (paraphrases match: 'the tax thing' finds " +
      "'File ITR'). Returns top candidates with scores - judge them yourself.",
    schema: { query: z.string().min(1).describe("Short description of the task to look for") },
    handler: async ({ query: text }) => {
      const res = await fetch(`${API}/api/search/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: text, limit: 6 }),
      });
      if (!res.ok) return { result: { error: `search failed: ${res.status}` } };
      return { result: await res.json() };
    },
  };

  const logTask: CompanionTool<{
    title: z.ZodString;
    projectId: z.ZodOptional<z.ZodNumber>;
    newProjectName: z.ZodOptional<z.ZodString>;
    deadline: z.ZodOptional<z.ZodString>;
    span: z.ZodOptional<z.ZodString>;
  }> = {
    name: "log_task",
    description:
      "Create ONE task the user asked for or clearly stated. It is created " +
      "immediately (no approval card) and the user sees a small receipt they can " +
      "edit or undo. Use find_relevant_tasks first to avoid duplicates.",
    schema: {
      title: z.string().min(1).describe("Crisp verb-first task title, e.g. 'File the ITR'"),
      projectId: z.number().int().positive().optional()
        .describe("Best-guess project id from the current-projects list; omit if unsure"),
      newProjectName: z.string().min(1).optional()
        .describe("ONLY when the user explicitly asked for a NEW project. Never invent projects."),
      deadline: z.string().optional()
        .describe("ISO date (yyyy-MM-dd) only when the user stated or clearly implied one"),
      span: z.string().optional().describe("The user's exact words (short quote)"),
    },
    handler: async ({ title, projectId, newProjectName, deadline, span }) =>
      logCapture("task", {
        title,
        ...(projectId ? { projectId } : {}),
        ...(newProjectName ? { newProjectName } : {}),
        ...(deadline ? { deadline } : {}),
      }, span),
  };

  const logMood: CompanionTool<{
    words: z.ZodArray<z.ZodString>;
    energy: z.ZodOptional<z.ZodNumber>;
    checkinAt: z.ZodOptional<z.ZodString>;
    span: z.ZodOptional<z.ZodString>;
  }> = {
    name: "log_mood",
    description:
      "Record a mood check-in when the user names a feeling ('now i feel guilty', " +
      "'feels good to connect'). Their own words, never your labels. Energy only " +
      "if they said a number - never guess one.",
    schema: {
      words: z.array(z.string().min(1)).min(1).describe("The user's own feeling words"),
      energy: z.number().int().min(0).max(10).optional()
        .describe("ONLY when the user stated a number"),
      checkinAt: z.string().optional().describe("ISO datetime when it was felt, if retro"),
      span: z.string().optional().describe("The user's exact words (short quote)"),
    },
    handler: async ({ words, energy, checkinAt, span }) =>
      logCapture("mood", {
        words,
        ...(energy !== undefined ? { energy } : {}),
        ...(checkinAt ? { checkinAt } : {}),
      }, span),
  };

  const logThought: CompanionTool<{
    title: z.ZodString;
    bodyMd: z.ZodOptional<z.ZodString>;
    kind: z.ZodEnum<{ memory: "memory"; idea: "idea"; reflection: "reflection"; quote: "quote"; wish: "wish"; note: "note" }>;
    about: z.ZodOptional<z.ZodArray<z.ZodAny>>;
    source: z.ZodOptional<z.ZodString>;
    span: z.ZodOptional<z.ZodString>;
  }> = {
    name: "log_thought",
    description:
      "Save a thought as its typed note: memory (notable, worth never losing), idea, " +
      "reflection (carries a source), quote, or wish (the someday shelf). Title is the " +
      "link phrase; bodyMd is the CLEANED version in the user's voice - keep their tone " +
      "('lol', deadpan), fix only dictation garble. The verbatim stays on the receipt.",
    schema: {
      title: z.string().min(1).describe("Short link phrase, e.g. 'Nov 2 marks six years at the job'"),
      bodyMd: z.string().optional().describe("Cleaned markdown body, the user's voice intact"),
      kind: z.enum(["memory", "idea", "reflection", "quote", "wish", "note"]),
      // z.any over z.record: zod v4 record schemas break the SDK's converter
      // and silently drop the WHOLE tool batch (#92 bisect). Backend validates.
      about: z.array(z.any()).optional()
        .describe('About-links, e.g. [{"type":"project","id":2},{"type":"person","name":"Deepika"}]'),
      source: z.string().optional().describe("For reflections/quotes: the book, URL, or person"),
      span: z.string().optional().describe("The user's exact words (short quote)"),
    },
    handler: async ({ title, bodyMd, kind, about, source, span }) =>
      logCapture("thought", {
        title,
        kind,
        ...(bodyMd ? { bodyMd } : {}),
        ...(about ? { about } : {}),
        ...(source ? { source } : {}),
      }, span),
  };

  const logExpense: CompanionTool<{
    amount: z.ZodNumber;
    note: z.ZodString;
    direction: z.ZodOptional<z.ZodEnum<{ out: "out"; in: "in" }>>;
    occurredOn: z.ZodOptional<z.ZodString>;
    split: z.ZodOptional<z.ZodAny>;
    projectId: z.ZodOptional<z.ZodNumber>;
    span: z.ZodOptional<z.ZodString>;
  }> = {
    name: "log_expense",
    description:
      "Record money that moved. Day-matched: use the day the money moved, not today " +
      "('tickets on the 4th' -> occurredOn that date). Splits are first-class: who " +
      "owes what, settled later.",
    schema: {
      amount: z.number().positive().describe("Positive amount; direction signs it"),
      note: z.string().min(1).describe("What it was, in the user's words"),
      direction: z.enum(["out", "in"]).optional().describe("Default out (spent)"),
      occurredOn: z.string().optional().describe("ISO date the money moved; default today"),
      split: z.any().optional()
        .describe('Split object, e.g. {"with":"Manish","share":1290,"settled":false}'),
      projectId: z.number().int().positive().optional().describe("The trip/project it belongs to"),
      span: z.string().optional().describe("The user's exact words (short quote)"),
    },
    handler: async ({ amount, note, direction, occurredOn, split, projectId, span }) =>
      logCapture("expense", {
        amount,
        note,
        ...(direction ? { direction } : {}),
        ...(occurredOn ? { occurredOn } : {}),
        ...(split ? { split } : {}),
        ...(projectId ? { projectId } : {}),
      }, span),
  };

  const logTime: CompanionTool<{
    op: z.ZodEnum<{ start: "start"; stop: "stop"; manual: "manual"; edit: "edit" }>;
    taskId: z.ZodOptional<z.ZodNumber>;
    description: z.ZodOptional<z.ZodString>;
    startedAt: z.ZodOptional<z.ZodString>;
    endedAt: z.ZodOptional<z.ZodString>;
    entryId: z.ZodOptional<z.ZodNumber>;
    span: z.ZodOptional<z.ZodString>;
  }> = {
    name: "log_time",
    description:
      "The timer follows the user's narration. start (auto-stops the running timer), " +
      "stop, manual (a closed retro interval: 'that idle time was brunch'), edit " +
      "(fix an entry: 'ended rise and shine 10 mins ago'). Times are local ISO.",
    schema: {
      op: z.enum(["start", "stop", "manual", "edit"]),
      taskId: z.number().int().positive().optional().describe("Task to attach, when named"),
      description: z.string().optional().describe("Label for taskless entries, emoji style welcome"),
      startedAt: z.string().optional().describe("Local ISO datetime; op=start may backdate"),
      endedAt: z.string().optional().describe("Local ISO datetime"),
      entryId: z.number().int().positive().optional().describe("For op=edit/stop on a known entry"),
      span: z.string().optional().describe("The user's exact words (short quote)"),
    },
    handler: async ({ op, taskId, description, startedAt, endedAt, entryId, span }) =>
      logCapture("time", {
        op,
        ...(taskId ? { taskId } : {}),
        ...(description ? { description } : {}),
        ...(startedAt ? { startedAt } : {}),
        ...(endedAt ? { endedAt } : {}),
        ...(entryId ? { entryId } : {}),
      }, span),
  };

  const weaveJournal: CompanionTool<{
    date: z.ZodOptional<z.ZodString>;
    sections: z.ZodAny;
    span: z.ZodOptional<z.ZodString>;
  }> = {
    name: "weave_journal",
    description:
      "Merge content into the day's journal sections (server-side merge - never " +
      "clobbers what is already there). prose sections append; front/back_of_mind " +
      "append items {text, cleared:false}; todays_plan replaces {buckets}. Write " +
      "cleaned prose in the user's voice. Never write the checkins section.",
    schema: {
      date: z.string().optional().describe("ISO date; default today"),
      sections: z.any()
        .describe('REQUIRED object keyed by section, e.g. {"mind_dump":"...", "front_of_mind":[{"text":"...","cleared":false}]}'),
      span: z.string().optional().describe("The user's exact words (short quote)"),
    },
    handler: async ({ date, sections, span }) =>
      logCapture("note", { ...(date ? { date } : {}), sections }, span),
  };

  const undoCapture: CompanionTool<{ captureId: z.ZodNumber }> = {
    name: "undo_capture",
    description:
      "Undo one of your own logged captures when the user corrects you ('no, that " +
      "wasn't lunch'): deletes the entity it created and marks the receipt dismissed. " +
      "Journal weaves cannot be undone wholesale - re-weave a correction instead.",
    schema: { captureId: z.number().int().positive().describe("The receipt id you logged earlier") },
    handler: async ({ captureId }) => {
      const res = await fetch(`${API}/api/captures/${captureId}/dismiss`, { method: "POST" });
      if (!res.ok) return { result: { undone: false, error: await res.text() } };
      const capture = (await res.json()) as { id: number };
      return { result: { undone: true }, event: { type: "receipt", capture } };
    },
  };

  const writeProfileNote: CompanionTool<{
    text: z.ZodString;
    kind: z.ZodOptional<z.ZodEnum<{ routine: "routine"; preference: "preference"; lexicon: "lexicon"; fact: "fact" }>>;
  }> = {
    name: "write_profile_note",
    description:
      "Add ONE distilled line to your own note sheet about the user (loads into every " +
      "future conversation). For durable patterns only - routines, preferences, their " +
      "personal lexicon - never day-to-day events (those belong in the journal). The " +
      "user sees and can remove every line.",
    schema: {
      text: z.string().min(1).max(400).describe("One line, e.g. 'Wakes 06:35-06:45 every day'"),
      kind: z.enum(["routine", "preference", "lexicon", "fact"]).optional(),
    },
    handler: async ({ text, kind }) => {
      const res = await fetch(`${API}/api/profile-notes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, ...(kind ? { kind } : {}) }),
      });
      if (!res.ok) return { result: { saved: false, error: await res.text() } };
      return { result: { saved: true } };
    },
  };

  // Erase the per-tool arg generics at this one boundary: the provider re-narrows
  // when the SDK hands back schema-validated args (see provider.ts).
  return [
    findRelevantTasks, logTask, logMood, logThought, logExpense, logTime,
    weaveJournal, undoCapture, writeProfileNote,
  ] as unknown as CompanionTool[];
}

export async function POST(request: Request): Promise<Response> {
  // Kill-switch (#88 R1): the companion runs ONLY where explicitly enabled -
  // COMPANION_ENABLED=1 in the RUNTIME env (PC .env.local; phone service env).
  // Anywhere else (the public OCI VM included) this route is an inert 404, so
  // a routine deploy can never violate the PC/LAN-only stance by accident.
  if (process.env.COMPANION_ENABLED !== "1") {
    return new Response(null, { status: 404 });
  }

  let message: string;
  try {
    const body = (await request.json()) as { message?: string };
    message = (body.message ?? "").trim();
  } catch {
    return Response.json({ message: "Body must be JSON." }, { status: 400 });
  }
  if (!message) {
    return Response.json({ message: "message is required." }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return Response.json(
      { message: `A message can be at most ${MAX_MESSAGE_CHARS} characters - split the long one up.` },
      { status: 400 },
    );
  }

  // Save-first: the user's words reach the DB before the AI is even attempted.
  let session: SessionRow;
  try {
    session = await getOrCreateTodaySession();
  } catch {
    return Response.json(
      { message: "Tasklog API is unreachable - cannot save the conversation." },
      { status: 502 },
    );
  }
  const prior = Array.isArray(session.messages) ? session.messages : [];
  // Tag computed from the previous exchange's last message.
  const timeTag = timeContextTag(prior.length > 0 ? prior[prior.length - 1].at : undefined);
  try {
    await appendMessages(session.id, [{ role: "user", content: message, at: localIso() }]);
  } catch {
    // If the words cannot be persisted, the turn must not run at all - the
    // client's "NOT saved" copy depends on this being honest (review R3).
    return Response.json(
      { message: "Could not save your message - the turn was not started." },
      { status: 502 },
    );
  }

  // Neutralize any <app_time-shaped text inside the USER's words before the
  // genuine tag is prepended (review R6): pasted content must never be able to
  // masquerade as the app's own machine context.
  const safeMessage = message.replace(/<app_time/gi, "&lt;app_time");
  const decorated = `${timeTag}\n${safeMessage}`;

  // Crossing-message handling (#91): if this session's brain is mid-thought,
  // the words are already saved - queue the decorated copy for the running
  // request's drain loop and answer immediately. No collisions, no errors.
  if (runningSessions.has(session.id)) {
    const pending = pendingBySession.get(session.id) ?? [];
    if (pending.length >= MAX_QUEUED_TURNS) {
      return ndjsonOnce({
        type: "error",
        message: "Sage already has a queue of your messages - your words are saved; give it a moment to catch up.",
      });
    }
    pending.push({ decorated });
    pendingBySession.set(session.id, pending);
    return ndjsonOnce({ type: "queued" });
  }
  runningSessions.add(session.id);

  const [persona, projects, cards, profileNotes, today] = await Promise.all([
    readPersona(),
    projectContext(),
    cardContext(session.id),
    profileNotesContext(),
    todayContext(),
  ]);
  const provider = new ClaudeCodeProvider();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // The consumer can vanish mid-stream (tab closed, phone locked). The
      // provider loop must keep draining so the done-save still runs (review
      // R12) - enqueue failures just flip `closed` instead of aborting.
      let closed = false;
      const send = (event: CompanionTurnEvent & { sessionId?: number }) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {
          closed = true;
        }
      };

      // Flush a ping IMMEDIATELY (#90): until the first byte, fetch() hangs
      // pending - ~50s on the phone brain (CLI spawn) - and browsers/users give
      // up, showing a false "NOT saved" while the turn completes server-side.
      // One early line = headers sent, the thinking indicator renders, the
      // connection looks alive.
      send({ type: "ping" } as unknown as CompanionTurnEvent);

      // Runs ONE provider turn on this stream and returns the resume cursor to
      // chain the next turn on. Shared by the first turn and the drain loop.
      const runOneTurn = async (
        turnMessage: string,
        resumeSessionId: string | null,
      ): Promise<string | null> => {
        let cursor = resumeSessionId;
        try {
          for await (const event of provider.runTurn({
            message: turnMessage,
            resumeSessionId,
            systemPrompt: persona + profileNotes + projects + cards + today + nowContext(),
            tools: buildTools(session.id),
          })) {
            if (event.type === "done") {
              cursor = event.sdkSessionId ?? cursor;
              // Persist the assistant turn + resume cursor BEFORE telling the
              // client the turn is done. Empty turns save nothing (review R2);
              // the sessionId on the event lets the client detect a midnight
              // rollover and reconcile (review R10/R22).
              try {
                await appendMessages(
                  session.id,
                  event.text
                    ? [{ role: "assistant", content: event.text, at: localIso() }]
                    : [],
                  event.sdkSessionId,
                );
                send({ ...event, sessionId: session.id });
              } catch (saveErr) {
                console.error("[companion] reply save failed:", saveErr);
                send({
                  type: "error",
                  message: "Sage replied, but the reply could not be saved to the transcript.",
                });
              }
            } else if (event.type === "error") {
              // Words the user already watched stream must survive a failure
              // (review R2): persist the partial text, and leave a server-side
              // trace (#91 - the exact error used to evaporate client-side).
              console.error("[companion] turn error:", event.message);
              if (event.partialText) {
                try {
                  await appendMessages(session.id, [
                    { role: "assistant", content: event.partialText, at: localIso() },
                  ]);
                } catch {
                  // the error event below already tells the user things went wrong
                }
              }
              send(event);
            } else {
              send(event);
            }
          }
        } catch (err) {
          console.error("[companion] turn threw:", err);
          send({
            type: "error",
            message: err instanceof Error ? err.message : String(err),
          });
        }
        return cursor;
      };

      try {
        let cursor = await runOneTurn(decorated, session.sdkSessionId);

        // Drain the crossing-message queue (#91): everything that arrived while
        // the turn above was thinking becomes ONE combined follow-up turn -
        // Sage catches up on all of it together, with its own prior reply in
        // view (so it can self-correct). Bounded so a stuck brain cannot loop.
        for (let drained = 0; drained < 5; drained++) {
          const pending = pendingBySession.get(session.id) ?? [];
          if (pending.length === 0) break;
          const batch = pending.splice(0, pending.length);
          const combined = batch.map((b) => b.decorated).join("\n\n");
          cursor = await runOneTurn(combined, cursor);
        }
      } finally {
        runningSessions.delete(session.id);
        pendingBySession.delete(session.id);
        try {
          controller.close();
        } catch {
          // already closed/cancelled by the consumer
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
