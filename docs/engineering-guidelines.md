# Tasklog Engineering Guidelines

This document describes how the codebase is currently structured and why.
It is not a rulebook - it is context. When something deviates from these patterns,
that is worth a conversation, not necessarily a blocker.

Read `docs/architecture.md` first to understand the system structure.

---

## Core principle

**Right-sized, not over-engineered.**

Add abstraction when it removes real duplication or makes something genuinely clearer.
The codebase should be understandable by reading it top to bottom.
When in doubt, prefer the simpler approach and evolve later.

---

## Backend (ASP.NET Core Web API)

### Current patterns

- Controllers handle HTTP concerns: routing, input validation, response codes.
- Controllers call `DbContext` directly - no repository or service layer yet.
- Request bodies use C# `record` types (immutable, concise).
- All database operations are `async`/`await`.
- Route constraints enforce types at the URL level (e.g. `{id:int}`).
- Timestamps are stored in UTC (`DateTime.UtcNow`).

### Current patterns - additions from v2.4

- **EF Core eager loading with `.Include()`** - used in `TasksController` to load `Labels` alongside tasks. All task queries use `.Include(t => t.Labels)` so callers always receive a populated `labels` array. Use the same pattern for any future navigation property that is always needed with the parent entity.
- **Many-to-many via implicit join table** - `TaskModel` and `Label` use EF Core's `HasMany/WithMany` to configure a join table (`LabelTaskModel`) without an explicit join entity. Cascade deletes on the join table are handled automatically by the database.

### Current patterns - additions from v2.10.2

- **`JsonElement` partial PATCH (present-key detection)** - `TasksController.Update` (`PATCH /api/tasks/{id}`) binds the body to `[FromBody] JsonElement` and inspects each field with `TryGetProperty`, rather than binding to a typed record. This is the only way to distinguish "field omitted" (keep the current value) from "field set to `null`" (clear it). A typed record with nullable properties collapses both cases to `null`, so it cannot express a clear-vs-keep difference. Reach for this whenever a PATCH needs nullable-clear semantics. Unlike query-string array binding, the present-key logic is directly unit-testable: build a `JsonElement` from a JSON string with `JsonDocument.Parse(json).RootElement.Clone()` and pass it to the action, which exercises the same branching the HTTP body would.

### Current patterns - additions from v2.12.0

- **Midnight = "date-only" sentinel for deadlines** - `Deadline` is a single `DateTime`, but a value at exactly `00:00:00` is treated as a date-only deadline (no specific time), while any non-midnight time is a real moment. `ComputeDueStatus` branches on `deadline.TimeOfDay != TimeSpan.Zero` for the "overdue" rule (timed = past the instant; date-only = past the calendar day). This avoids a separate `HasTime` column. Trade-off: a literal midnight deadline behaves as date-only - acceptable since "due at exactly 00:00" is rare and "end of day" is the sensible reading. The frontend mirrors this with `hasTimeComponent(iso)` (checks the `HH:mm` substring, timezone-safe).

### Current patterns - additions from v2.10.5

- **Non-zero column defaults go in `OnModelCreating`, not just the property initializer** - `TaskModel.Priority` defaults to 4 (P4 = none). EF Core derives a migration column's SQL default from the CLR default of the type (0 for `int`), NOT from a C# property initializer (`= 4`). Setting only the initializer means existing rows migrate to 0 (an invalid out-of-range value here). Configure the DB default explicitly: `modelBuilder.Entity<TaskModel>().Property(t => t.Priority).HasDefaultValue(4)`, then generate the migration - it emits `defaultValue: 4` and existing rows migrate correctly. Always verify the generated migration's `defaultValue` for any non-zero default. (See [learnings/orm-migration-default-values.md](learnings/orm-migration-default-values.md).)

### Current patterns - additions from v2.10.3

- **Computed response field via `[NotMapped]` getter** - `TaskModel.DueStatus` is a read-only property (`[NotMapped] public string DueStatus => ComputeDueStatus(Deadline, DateTime.Today);`) rather than a stored column or a DTO field. `[NotMapped]` (from `System.ComponentModel.DataAnnotations.Schema`) tells EF Core to ignore it for mapping/migrations, while System.Text.Json still serializes the getter. The effect: the field appears on every response that returns the model, with zero per-action wiring and no schema change, and it is always computed fresh (so a value relative to "now" never goes stale). Use this for derived, response-only fields that have no business being persisted. Pair it with a **pure static helper** that takes its time-dependency as a parameter (`ComputeDueStatus(deadline, today)`) so the logic is unit-testable without freezing the clock - the instance getter just wires in `DateTime.Today`. Keeps the project's no-DTO convention intact.

### Current patterns - additions from v2.14.0

- **Pure domain helper in `Services/` (not a DI service layer)** - recurrence logic lives in `Services/RecurrenceRule.cs`: a static class that parses/validates an RRULE-shaped string and computes the next deadline (`NextDeadline(current)`). It is the first file under `Services/`, but it is deliberately NOT the "service layer" pattern below - no DI, no injected `DbContext`, no instance state. It is the same shape as `TaskModel.ComputeDueStatus`: a pure, parameterized function the controller wires in (`Complete` calls `RecurrenceRule.TryParse(...).NextDeadline(deadline)`). Because it is clock-free (it advances from the passed-in deadline, never `DateTime.Now`), it sidesteps the `DateTime.Now`/`UtcNow` deviation (#18) and is trivially unit-testable. Reach for this - a static helper under `Services/` - when logic is non-trivial and non-HTTP but still stateless and pure; reserve a true injected service (below) for when it needs the `DbContext` or other dependencies.

### Current patterns - additions from v2.20.0 (#78)

- **Optional-`Include` on a list endpoint driven by a query flag** - `GET /api/tasks?includeSubtasks=true` conditionally `.Include(t => t.Subtasks.OrderBy(...))` so the web gets the full rows for its inline checklist, while the default (MCP) path stays lean and only stitches on two grouped-count fields (`subtaskCount`/`completedSubtaskCount`). The counts are `[NotMapped]` settable properties the controller fills (from the loaded collection when included, from a grouped query otherwise) - the same "computed response field" idea as `DueStatus`, but populated by the controller rather than a pure getter because the source isn't always loaded. Reach for a flag-gated `Include` when one caller needs a heavy nav and another does not, rather than always loading it or splitting the endpoint.
- **One shared inline component across three layouts** - `SubtaskChecklist` renders the same clubbed, tickable list under a task on the mobile card, the desktop table (as a full-width sub-row via a keyed `Fragment` + `colSpan`), and the board card. Keeping it one component (with a `max` + "+N more" prop) meant the "tick a step" gesture reads identically everywhere and there is one place to change. When the same affordance must appear in structurally different containers (a `div` card vs a `<td>`), lift it into a layout-agnostic component and let each host wrap it.
- **`@dnd-kit` for drag-reorder (first drag-and-drop dependency)** - `SubtaskSection` uses `@dnd-kit/core` + `/sortable` + `/utilities` for touch-friendly subtask reordering (a `PointerSensor` with a small activation distance + a `KeyboardSensor`). Admitted under the same "clear-benefit dependency" rule that allowed `chrono-node`: reorder-on-touch is fiddly and error-prone hand-rolled, and the phone is a first-class client. Reorder is optimistic - `arrayMove` locally, POST the new id order, revert to the pre-drag snapshot on failure.
- **`DateTime.Now` (not `UtcNow`) followed deliberately** - subtask timestamps/comparisons use `DateTime.Now` to match the surrounding controllers (the open #18 deviation), so a subtask's dates behave identically to its parent's rather than introducing a mixed-clock inconsistency inside one feature.

### Current patterns - additions from v3.0 (#79)

- **JSON-as-TEXT columns** - `JournalTemplate.SectionsJson`, `JournalEntry.ContentJson`, and `MoodCheckin.WordsJson` store JSON as plain `TEXT`, serialized with `System.Text.Json` (NOT EF Core's `ToJson` owned-entity mapping). Deliberate: the content is opaque to SQL by design, and this is the simplest understandable form for the codebase's first JSON columns. The rule that keeps it honest: anything you need to QUERY (energy, MoC level, dates) gets a real column; the JSON blob is for shape-flexible content only.
- **Paired cross-language contract** - the journal's content shapes exist twice on purpose: `frontend/src/lib/journal.ts` (the client contract) and `Services/JournalMarkdown.cs` (the renderer mirror). Plan bucket keys and evening field keys are duplicated verbatim in both. When touching either side, change both together - the files reference each other in comments.
- **Startup upsert for code-defined rows** - journal templates are constants in `Services/JournalTemplates.cs`, upserted into their table by `Key` in Program.cs after `Database.Migrate()`. Editing a definition updates the row on next run with no migration. Reach for this when data is code-owned but tables/FKs still want real rows.
- **Page-scoped theme tokens** - the journal ships its own identity as `--color-j-*` variables beside the app tokens in `globals.css` (light + `html.dark` overrides). Components use `bg-j-card` / `text-j-ink` etc. This scopes a distinct look to one section without forking the theming mechanism; promoting it app-wide later is a token swap, not a rewrite.
- **`react-markdown` for display-only markdown** - admitted under the clear-benefit dependency rule. Markdown is GENERATED backend-side (`Services/JournalMarkdown.cs`, a pure static helper - the RecurrenceRule shape); the frontend never parses or round-trips it. No Markdig: we only write markdown, never read it.

### Current patterns - additions from v3.2.0 (#86)

- **`DeleteBehavior.SetNull` to preserve history across a delete** - `TimeEntry.TaskId`/`.ProjectId` and `Project.ClientId` are `SET NULL` on delete, not cascade. A deleted task/project/client leaves its time intervals (and a client's projects) alive but un-linked, because logged actuals are history that should never vanish. Reach for SET NULL when the dependent row has standalone value; keep cascade (like Project -> Tasks) when the dependent is meaningless without its parent. Note: the EF **InMemory** test provider does NOT model relational SET NULL, so that guarantee is verified at the migration level, not in unit tests.
- **Snapshot-before-delete** - deleting a task first copies its title into its description-less time entries (`TasksController.SnapshotTaskTitlesIntoEntries`, shared by the single + project-cascade delete paths) so a SET-NULL'd interval stays legible instead of reading "Untitled". Pattern: when SET NULL will strip a displayed field, denormalize it onto the dependent just before the delete.
- **Domain tidy-rules applied to STORED data on a state transition** - when a timer closes (`CloseEntry`), the entry is discarded if under 2.5 min, else both edges snap to the 5-min grid. Deliberately NOT a display-time transform: rounding the stored value keeps the data honest so future metrics can't diverge from what's shown. Snapping a *shared boundary* (a transition instant) with the same function on both sides keeps consecutive entries contiguous - which is why we round both edges, not just the end, and only on close (so no future-dated starts).
- **Pure layout pass in `lib/time.ts` (`layoutDay`)** - push-down positioning (each block starts no higher than the previous one's bottom) is computed as a pure function of the day's entries, keeping `TimelineView` a thin renderer. Same "pure geometry in lib/time" precedent as `daySegment`.
- **`position: fixed` breaks inside a transformed ancestor** - the mobile nav drawer uses a `translate-x` transform, which re-bases `position: fixed` to the drawer (not the viewport), cramming "centered" modals into it. Fix: render overlays through a `createPortal(..., document.body)` helper (mounted-guarded for SSR) so they escape the transform. Applied to the sidebar's edit/delete dialogs and the row "..." menu. The `/time` sheet does NOT need this (no transformed ancestor there), so it uses plain `fixed`.
- **Cross-device freshness via `usePolling`** - the running timer was the one piece not polled; `TimeTrackingContext` now polls `GET /api/time-entries/active` every 15 s (skipping while a local op is in flight) and reconciles. Reuse `usePolling` for any shared state that another device can change out from under the client.

### Current patterns - additions from v4.0.0 (#87)

- **First true DI service: `EmbeddingService`** - unlike the pure static helpers beside it, it needs an HttpClient (typed-client registration in Program.cs) and the DbContext. The line drawn in v2.14.0 ("reserve a true injected service for when it needs dependencies") is now exercised. Its whole contract is BEST-EFFORT: every method returns null / no-ops on failure, because embeddings are enrichment - a task write must never fail because Ollama is down.
- **Optional service parameter for test compatibility** - `TasksController(context, EmbeddingService? embeddings = null)`: DI supplies the service in the app; the 100+ existing direct controller constructions in tests compile unchanged and correctly skip the enrichment. Reach for an optional ctor param when adding a cross-cutting dependency to a heavily-tested controller.
- **Embeddings as BLOB + brute-force cosine - deliberately NO native vector extension** - float32[] as little-endian bytes in a generic `Embeddings` table (EntityType/EntityId/Model unique), ranked by a pure static `RankBySimilarity` (the ComputeDueStatus shape - unit-testable without Ollama). Sub-ms at personal scale; `sqlite-vec` is the later optimization, avoided now because native binaries would re-open the arm64/x64 build matrix.
- **Staging inbox -> typed homes (the Capture pattern)** - AI proposals land in a generic `Captures` table as `proposed`; a human confirm MATERIALIZES the typed row (Tasks today) and records `ConfirmedType/Id`. Types are strings against a registry so new facets need no migration. The trust rule in code: nothing enters a typed home unconfirmed; dismissed items are only revivable by the human (`restore`), never the model (propose-dedupe returns the dismissed row).
- **Transactional guarded claim, relational-only** - `Confirm` flips status via `ExecuteUpdateAsync(... WHERE Status='proposed')` inside a transaction so concurrent confirms cannot double-materialize - but ONLY when `Database.IsRelational()`: the InMemory test provider supports neither transactions nor ExecuteUpdate, so tests run the same body on the optimistic path. When a guarded write matters in prod but breaks InMemory, branch on IsRelational rather than weakening the guard.
- **Append endpoint over whole-array PUT for concurrent writers** - `POST /api/companion/sessions/{id}/messages` appends transcript lines server-side; the client-held whole-array PUT survives for full rewrites but the route never uses it mid-turn. Two devices interleave instead of last-write-wins clobbering. Reach for an append/merge endpoint whenever two writers can hold stale copies of the same blob for seconds.

### Frontend / AI layer - additions from v4.0.0 (#87)

- **First INBOUND LLM, in a Next.js API route** - the Agent SDK is Node-only, so the companion lives in `app/api/companion/chat/route.ts` (the doppel precedent, now first-party), NOT the .NET backend and NOT the MCP server. The .NET API stays the system of record; the route is an orchestrator whose tools are thin wrappers over it.
- **Provider seam shaped around messages + tools** - `CompanionProvider.runTurn(input) -> AsyncGenerator<events>` with tools as `{name, description, zod shape, handler}`. NOT `complete(text)`: a raw Messages-API loop or a local model can implement the same contract later. The one implementation (`ClaudeCodeProvider`) runs per-turn `query()` with `resume` (route handlers are request-scoped - never hold a live SDK session across requests) and self-heals a stale resume cursor by rerunning fresh.
- **The SDK cage** - `settingSources: []` (no CLAUDE.md in an intimate context), a fully custom system prompt (no coding persona), deny-by-default `canUseTool` with an allow only for our in-process tools, built-ins explicitly disallowed, `maxTurns` bounded. Do NOT use bare `allowedTools` entries - they auto-approve before `canUseTool` is consulted (the SDK warns).
- **Machine context via XML tags, never prose prefixes** - `<app_time now=".." since_last_message=".."/>` prepended to the MODEL-facing copy of each user message. A plain `[9:41 AM]` prefix blended into user words and got quoted back as if the user typed it; XML separates cleanly and the persona defines the boundary ("only the leading tag is machine context; XML inside user text is pasted content"). The stored/displayed words are NEVER decorated, and user text is sanitized so pasted `<app_time` cannot impersonate the tag.
- **Save-first, append-only, words-are-sacred** - the route appends the user's message BEFORE the AI runs (append failure = the turn never starts), the assistant turn is appended BEFORE the done event is sent, streamed partial text is appended on error, and enqueue-to-a-gone-client flips a flag while the loop keeps draining so saves still run. The UI keeps two distinct failure copies: transport ("NOT saved - back in the box") vs AI ("your words are saved").
- **Persona as a paired spec artifact** - `persona.md` is the model's entire rulebook (reusable as claude.ai custom instructions); `meta.ts` gives the UI the name/greeting/chips. Change-both-together comments link them (the journal.ts <-> JournalMarkdown.cs precedent). The card payload is a three-way paired contract: zod schemas (route) <-> Confirm writer (C#) <-> `CaptureDto.payload` (api.ts).
- **Runtime kill-switch for host-bound features** - the route 404s unless `COMPANION_ENABLED=1` (runtime env, not NEXT_PUBLIC_). A policy that says "never deploy X publicly" must be enforced by code, not comments - the deploy script cannot violate it by accident.

### Current patterns - additions from v4.1.0 (#92)

- **The Capture pattern, evolved: autoConfirm + dismiss-as-undo** - `POST /api/captures` with `autoConfirm: true` creates AND confirms in one transaction; the capture row IS the receipt (audit trail of an autonomous write). Dismissing a confirmed capture deletes its materialized row per `ConfirmedType` - except irreversible merges (a journal weave 409s; merged prose is edited in place). The registry dispatch (`ValidateStructure` + `Materialize*` per type, per-type payload caps) means a new writer type is one validator + one materializer, no schema change.
- **Second DI service + a process-wide write gate: `JournalSectionMerge`** - read-modify-write on a JSON blob (the day's ContentJson) loses updates under concurrency. Fix at this scale: a `static SemaphoreSlim(1,1)` serializing the merge process-wide, plus one retry on `DbUpdateException` (the create-vs-create race on the unique index). A DB-level optimistic-concurrency token is the bigger hammer; reach for it only if a second process ever writes the same blobs.
- **Boundary invariants enforced at write time** - "timers never overlap" lives in the writers, not the UI: starting a new entry seals a running one at the NEW start; a retro interval trims any running timer it crosses. The lesson (learned live, 12 Sep): an all-night runaway timer is not a display bug - the WRITE should have been impossible.
- **Idempotent ingestion by natural key** - `ActivitySamples` is unique on (Machine, Ts); the batch endpoint skips existing pairs, so the shipping agent can resend everything after any failure. Pair it with the agent-side spool+cursor (`watchman.py`): the cursor advances only past acknowledged batches, and the spool absorbs server sleep. Reach for this shape for ANY at-least-once feed.
- **Get-or-create with fill-blanks-never-overwrite** - `POST /api/persons` by name: a later mention adds missing fields but never replaces known ones (an AI writer repeating a name must not erase human-curated detail). Same get-or-create shape (without the fill rule) in Areas and project `newAreaName`.
- **Append-only JSON histories** - `Project.NowHistoryJson` and `Goal.ExpectationsJson` archive the outgoing value as a dated entry on change instead of overwriting. Reach for this when the HISTORY of a field is part of its meaning (what a project was about; what success used to mean).
- **The Agent SDK tool cage, revised (four stacked causes, all required)** - exposing in-process MCP tools needs: `createSdkMcpServer({ alwaysLoad: true })` (else tools defer behind ToolSearch and never load); `options.tools: []` to disable ALL built-ins (a deny-list cannot keep up with new built-in names); `strictMcpConfig: true` (else the logged-in CLI's claude.ai connectors leak into the session); and NO `z.record()` anywhere in tool schemas (zod v4 records make the SDK silently drop the whole tool batch - use described `z.any()` for open shapes). REVISION of the v4.0 rule: `allowedTools` is now generated from the tool list on purpose - auto-approve is CORRECT under autonomy; `canUseTool` stays as the belt. Also: the SDK + zod must be `serverExternalPackages` in next.config.ts, and a RESUMED SDK session keeps its original options - reset the stored `SdkSessionId` after any provider config change.
- **Debug hooks that bisect, then leave** - the four-cause tool bug was found with a `COMPANION_TOOL_FILTER` env hook (expose tool subsets), a standalone `probe.mjs`, and an init-debug dump of what the SDK actually loaded. The hooks were removed after; the lesson stays: when a black box misbehaves, build the bisection instrument instead of guessing.

### Patterns not yet in use - and when to consider them

**Repository pattern** - not used currently. DbContext is injected directly into controllers.
Worth considering if the data access layer needs to be swapped out or tested in isolation.

**Service layer** - not used currently. Business logic (minimal right now) lives in the controller.
Worth introducing when controller actions contain logic that is not HTTP-specific
and is shared across more than one action.

**AutoMapper / object mapping** - not used. Models are simple enough to map by hand.
Worth considering if the gap between API response shapes and database models grows significantly.

**Global exception handling middleware** - not used. Controllers return explicit error responses.
Worth adding when error handling becomes repetitive across many endpoints.

### Response codes

| Situation | Code |
|-----------|------|
| Success with data | 200 OK |
| Created | 201 Created (with `CreatedAtAction`) |
| Success, nothing to return | 204 No Content |
| Invalid input | 400 Bad Request |
| Not found | 404 Not Found |

---

## Frontend (Next.js App Router)

### Server Components vs Client Components

Default to Server Components. Add `"use client"` when the component needs:
- `useState` or `useEffect`
- Browser event handlers (onClick, onChange, onSubmit)
- Browser-only APIs

Current component breakdown:

| Component | Type | Reason |
|-----------|------|--------|
| `layout.tsx` | Server | Static shell, no interaction |
| `page.tsx` | Server | Renders client component, no state |
| `tasks/[id]/page.tsx` | Server | Fetches task and projects, no interaction |
| `ProjectLayout.tsx` | Client | Owns activeView and projects state, handles project CRUD |
| `ProjectSidebar.tsx` | Client | Project nav with create/rename/delete interactions |
| `TasksClient.tsx` | Client | Owns task list state, handles mutations, filters by activeView |
| `AddTaskForm.tsx` | Client | Controlled inputs, form submission, project dropdown |
| `AssignProjectButton.tsx` | Client | Select element, PATCH on change, router.refresh() |
| `DeleteTaskButton.tsx` | Client | Click handler, redirect |
| `CompleteTaskButton.tsx` | Client | Click handler, router.refresh() (no redirect) |

### API calls

Fetch calls currently live in `src/lib/api.ts`. This keeps the API contract
in one place and makes it easy to see what the frontend depends on.
If a new pattern is needed (e.g. React Query, SWR), that is a good conversation
to have before adding ad-hoc fetch calls elsewhere.

### Component responsibilities

- One component, one job as a starting point.
- Components that manage data should not also own complex layout - but use judgement.
- Error and loading states should always be handled. A blank screen is never intentional.

### Styling

- Tailwind utility classes are the current approach.
- The default Tailwind colour scale maps to the UI spec - see `UI-SPEC.md`.
- Arbitrary values (e.g. `w-[137px]`) are a signal to check if a scale value would work instead.
- Responsive: mobile-first. `sm:` prefix for desktop variants.

### Custom hooks

Reusable hooks live in `src/hooks/`. Current hooks:

| Hook | Purpose |
|------|---------|
| `usePolling(fetchFn, intervalMs, enabled)` | Background data refresh on a timer. Pauses when the tab is hidden (Page Visibility API) and when `enabled` is false (e.g. during in-flight operations). Fires an immediate fetch when the tab becomes visible again. Used in TasksClient, ProjectLayout, and LabelsClient. |

When adding a new hook, place it in `src/hooks/` and follow the same pattern: accept a callback, an interval or config, and an `enabled` flag for conditional execution.

### Shared utilities

When the same logic appears in more than one place, extracting it to `src/lib/`
is worth considering. Current candidates: `formatDate`, `deadlineColorClass` (issue #5).

### Additions from v2.15.0

- **First frontend runtime dependency: `chrono-node`** (MIT) for natural-language date parsing in quick-add (`lib/quickAdd.ts`). The project's "avoid unnecessary frameworks" rule explicitly allows a *clear-benefit* dependency, and free-form date NL ("next friday", "jan 27", "in 3 days") is the textbook don't-reinvent case - chrono also returns the matched span, which the highlight overlay and title-stripping need. Recurrence and the `#`/`@`/`pN` tokens are still hand-rolled (bounded grammar we control), so the dependency is scoped to dates only. `quickAdd.ts` itself is a pure function, mirroring the `format.ts` precedent.
- **Backdrop-overlay highlighting over a normal `<input>`** (`QuickAddInput.tsx`) - a transparent-text-aware backdrop `div` renders tint rectangles behind recognized token spans while the real `<input>` sits on top (scroll synced). This gives inline highlighting without a `contenteditable` rewrite (which true padded inline pills would require). "Unlink a wrong token" is offered as a removable-chips row below the field rather than in-place click, for the same reason. Reach for this overlay pattern when you need to decorate input text without giving up the native input/caret/a11y.

---

## MCP server (Node/TypeScript, v2.10+)

The MCP server is the first Node.js service in the repository. Different patterns
from the .NET backend and Next.js frontend; documented here so the precedent is explicit.

### Current patterns

- **Hono with `@hono/node-server`** as the HTTP framework. Chosen over Express for modern TypeScript-native types, smaller dep tree, equivalent capability for this scope.
- **TypeScript strict mode + NodeNext module resolution.** All imports use explicit `.js` extensions (NodeNext requires this, even when importing from TypeScript source).
- **Hand-rolled OAuth 2.1** rather than a library. Visibility into every spec requirement was prioritized over ergonomics, given this was the project's first OAuth implementation.
- **Opaque tokens (not JWT).** Random 32-byte hex strings stored in SQLite with metadata. Simpler than JWT (no key management) and trivially revocable.
- **Zod schemas inlined** per tool file (not centralized in a `schemas.ts`). With 16 small tools across 3 files, the indirection of a separate schemas file would not pay back.
- **`node:test` for unit tests** (not Jest or Vitest). Built into Node 20+, no extra dependency. Test files are `*.test.ts` next to the code they test; excluded from production build via tsconfig.
- **`better-sqlite3` for the auth DB.** Synchronous API matches the rest of the request-handler shape; performance is microsecond-scale for the kinds of lookups we do (single token, single client).

### Patterns not yet in use - and when to consider them

**Refactor `store.ts` to accept an injected DB path / in-memory mode** - currently it opens the configured file at module load. Worth doing if we ever want to add DB-backed unit tests (currently we rely on end-to-end smoke testing for rotation, audience, expiry).

**ESLint / Prettier** - skipped in the initial scaffold. TypeScript strict mode catches most issues; editor-side formatting handles consistency. Worth adding if collaborators join, or if drift becomes a problem.

**A library-based OAuth server** (e.g. `mcp-auth`) - hand-rolled was correct for learning, but if requirements grow (refresh token chains, multiple upstream IdPs, scoped consent), a library may be worth migrating to.

### Response codes (MCP server specific)

| Situation | Code |
|-----------|------|
| Missing or bad Bearer token on `/mcp` | 401 + RFC 9728 `WWW-Authenticate` |
| Wrong Origin on `/mcp` | 403 |
| Unsupported MCP-Protocol-Version | 400 |
| Bad OAuth request (missing params, bad PKCE, etc.) | 400 with RFC 6749 error code in JSON body |
| `GET /mcp` (no server-initiated push) | 405 with `Allow: POST` |

---

## Known deviations from these patterns

These are open issues - areas where the current code does not yet match the patterns above.
They are tracked rather than hidden so they can be addressed deliberately.

| Issue | What's not yet in place |
|-------|------------------------|
| [#1](https://github.com/hydraInsurgent/Tasklog/issues/1) | CORS not applied outside dev; server-side fetch uses localhost |
| [#2](https://github.com/hydraInsurgent/Tasklog/issues/2) | Feedback timer not cleared; optimistic delete before API confirms |
| [#3](https://github.com/hydraInsurgent/Tasklog/issues/3) | Database path is relative; API URL has no startup validation |
| [#4](https://github.com/hydraInsurgent/Tasklog/issues/4) | Contrast and focus indicators below WCAG AA in places |
| [#5](https://github.com/hydraInsurgent/Tasklog/issues/5) | Utility functions duplicated; DateTime.Now instead of UtcNow |
| [#6](https://github.com/hydraInsurgent/Tasklog/issues/6) | CORS policy too broad; AllowedHosts is wildcard |
| [#17](https://github.com/hydraInsurgent/Tasklog/issues/17) | ProjectsController CreatedAtAction points to wrong route |
| [#18](https://github.com/hydraInsurgent/Tasklog/issues/18) | Inconsistent DateTime.Now vs UtcNow across controllers |
| [#19](https://github.com/hydraInsurgent/Tasklog/issues/19) | Assigning task to non-existent project returns 500 not 400 |

---

## When adding a feature

A useful checklist - not a gate:

1. Read `docs/architecture.md` to understand where the change fits.
2. Glance at `docs/product-design.md` - if the feature shifts the product scope, that is worth noting before building.
3. Add an API endpoint if new data operations are needed.
4. Add a typed function in `src/lib/api.ts` for any new endpoint.
5. Build UI in the right component type (Server if read-only, Client if interactive).
6. If logic is shared across components, extract it to `src/lib/` rather than copying.
