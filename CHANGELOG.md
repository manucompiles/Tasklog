# Changelog

---

## v4.1.1 - The tape survives unclean shutdowns
*October 2026*

### Fixed

- **Watchman no longer crash-loops on a corrupt spool line** (#93) - an unclean
  shutdown mid-append (a power cut, a hard reset) could leave a NUL-damaged line in
  the spool; the shipper then crashed on it, restarted, and crashed again forever,
  shipping nothing. Found live after the laptop's dead-charger week, exactly as
  review finding R9 predicted. Undecodable lines are now skipped and counted, a
  server REJECTION (4xx) parks the chunk in a quarantine file instead of retrying
  it forever, and the spool rotates once fully acknowledged so it stops growing
  without bound.

---

## v4.1.0 - The companion days
*September 2026*

Sage graduates from proposing to DOING. Born from a two-day live dogfood (the corpus of
everything one person actually throws at a companion), built around one law: engage with
the content first, capture invisibly. Plan: `docs/plans/P92-companion-days.md` (#92).

### Added

- **Sage acts on what he hears** - no more approval cards. Narration becomes real rows
  directly: tasks, moods, thoughts, expenses (with informal splits like "Manish owes
  1,369"), notes, journal prose, and time entries. Every write shows a small **receipt
  chip** with one-tap **undo** (the trust loop moved from pre-approval to post-hoc undo).
  Mood energy is logged ONLY when you say a number - Sage never invents one.
- **Honest time from narration** - "dinner routine now", "that was from 22:05", "I napped
  after brunch": Sage starts, stops, backdates, and edits timers. Timers can never
  overlap: starting a new one seals the running one at the NEW start, and a retro
  interval trims any running timer it crosses.
- **The tape** - a tiny `watchman` agent per machine ships active-window titles + idle
  state to the server (titles only, never contents; nothing leaves the LAN; the local
  spool absorbs server sleep). Sage's `check_screen` tool reads coalesced segments and
  MUST consult them before backdating any boundary - evidence over guessed times. v1
  alerts: a desktop popup when YouTube exceeds its budget in a rolling window.
- **The journal day page, redone** - morning brief (sleep + yesterday's rollovers), day
  tiles, a structured expenses section with split chips and a daily total, note popups,
  mind verdicts (closed / rolled over / let go), and evening auto-lines for what moved.
  Sage weaves prose into sections through a server-side merge that never loses concurrent
  writes.
- **Projects tab** - projects grouped by **life areas** (each with its why), status
  active/on-hold, an About, and an append-only **Now** chapter history. **Goals** live on
  projects: a timespan tier (10Y..1M), a why, nudgeable progress, dated expectation
  revisions, and **the door** - the smallest next physical action.
- **Profile tab** - **people as entities**: relation, who they are, contact rhythm,
  birthday, open threads ("owes ~2,738"), and "next time, bring up X". Plus the ledger of
  **profile notes** - durable facts Sage learns about you, injected into every
  conversation; stale facts retire, never delete.
- **Sage knows your day before the first word** - today's journal state, time entries,
  and expenses ride along in his context, alongside the profile notes.

### Fixed

- **Sage had no tools in production** - four stacked causes in the Agent SDK wiring
  (deferred tool loading, built-in tool leakage, claude.ai connector leakage, and a zod
  v4 `z.record()` schema silently dropping the whole tool batch). Sage's tool cage is now
  explicit and allow-listed.
- **Concurrent journal writes lost sections** - the merge endpoint is serialized with a
  retry; three simultaneous writers all survive.

### Notes

- New tables: `Notes`, `Expenses`, `ProfileNotes`, `Areas`, `Goals`, `Persons`,
  `ActivitySamples` (unique per machine+timestamp - reshipping is always safe).
  `Projects` gains status/area/about/now-history; `MoodCheckins.Energy` is now nullable.
  Five migrations, applied on startup.
- `POST /api/captures` gains `autoConfirm` (create + confirm in one transaction - the
  capture row is the receipt); dismiss on a confirmed capture = undo (journal weaves
  refuse: merged prose is edited in the Journal instead).
- New endpoint families: `/api/notes`, `/api/expenses`, `/api/profile-notes`,
  `/api/areas`, `/api/goals`, `/api/persons`, `/api/activity` (batch + segments), and
  `PATCH /api/journal/entries/{key}/{date}/sections` (per-kind section merge).
- The `watchman/` folder holds the agent + its systemd user service and README.

---

## v4.0.2 - Crossing messages: the texting model
*September 2026*

### Fixed

- **Sending while Sage thinks no longer errors** (#91) - messages now queue like texts. The
  in-flight reply lands as composed; everything sent meanwhile drains as ONE combined
  follow-up turn (each message keeps its time tag), so Sage catches up like a person reading
  their texts - and can self-correct against its own prior reply. The composer never blocks.
  Applies to every brain (the window is ~50s on the phone, 5-12s on the PC). Queue depth is
  capped honestly; provider errors now leave a server-side trace. Graduates review item R20
  from #88.

---

## v4.0.1 - Phone companion fixes
*September 2026*

### Fixed

- **Dead air until Sage's first token** (#90) - the chat stream now flushes an immediate
  `ping`, so the connection resolves in under a second and "Sage is thinking..." shows right
  away. Previously the fetch hung silently (~50s on the phone brain) and browsers gave up,
  showing a false "NOT saved" while the turn actually completed and saved server-side.
- **Phone Sage told UTC time** - `deploy-phone.sh` now sets `TZ` on the web service too
  (it said "12:51 AM" at 6:21 AM IST).
- **Phone service env is config-as-code** - `COMPANION_ENABLED=1` and `Ollama__Url` moved
  into the deploy script's service templates, so a redeploy can no longer wipe the phone's
  Sage wiring.

---

## v4.0.0 - Sage, the journaling companion
*September 2026*

Opens the v4.x "Living Profile" line: talk to the app, structure falls out. Full vision in
`docs/ideas/living-profile.md`.

### Added

- **Sage** (#87) - a conversational companion on its own tab. Talk about your day; when
  something actionable comes up, Sage proposes a **task card** you can **Keep / Edit / Toss**
  (an accidental toss has **Restore**). Kept cards become real tasks in your list - Sage never
  writes anything without your tap. Runs on your own Claude subscription via the Claude Agent
  SDK (no API key), with a persona defined in one editable spec file.
- **Semantic grounding** - before proposing, Sage searches your open tasks by *meaning*
  (local Ollama embeddings, `nomic-embed-text`): "the tax thing" finds "File the income tax
  return", so it says "already on your list" instead of duplicating. Degrades to keyword
  search when Ollama is absent - nothing breaks.
- **Conversational card edits** - "put that in its own project called ProcureFlow" morphs the
  existing card in place; one Keep then creates the new project AND the task together.
- **Time-aware** - Sage knows the current date/time each turn and when each message was sent
  (invisible `<app_time>` markers on the model's copy only), so "first thing", "tonight", and
  "back after ~2h" all mean what you mean.
- **One conversation per day** + a **history calendar** (desktop rail / mobile pull-out
  drawer): dots mark days you talked; past days open read-only, but their cards stay
  actionable. A **Cards panel** keeps pending cards in reach while the chat scrolls.
- **Never loses your words** - the transcript saves before the AI runs, append-only (two
  devices can't clobber each other), and streamed replies persist even when a turn errors.

### Changed

- **Header**: new Sage tab; the tab row swipes on narrow phones instead of widening the page;
  the logo shrinks to "T" on mobile; logo click no longer resets dark mode.
- **Timer pill** moved to the bottom-RIGHT on desktop (all pages, one consistent home) and
  hides on the companion tab below desktop width, where Sage's composer owns the bottom edge.

### Notes

- New tables `Captures` (the staged-proposal inbox: proposed/confirmed/dismissed, source-aware
  for future MCP parity), `CompanionSessions` (one per day, unique date, append-only
  transcript), `Embeddings` (generic per-entity vectors as BLOBs; brute-force cosine, no
  native vector extension). Migration `AddCompanionCapturesAndEmbeddings`.
- New endpoints: `/api/captures` (CRUD + confirm/dismiss/restore), `/api/companion/sessions`
  (get-or-create today, by-date, dates, save, append), `POST /api/search/tasks` (semantic with
  keyword fallback). New Next.js route `/api/companion/chat` (NDJSON streaming turn).
- **The companion is gated**: the chat route is a 404 unless `COMPANION_ENABLED=1` is in the
  runtime env - set on the PC (and optionally the phone), deliberately NOT on the public VM
  (no app auth exists; see #88 for the remaining public-exposure hardening, #89 for polish).
- New frontend dependency: `@anthropic-ai/claude-agent-sdk` + `zod`. Optional host dependency:
  Ollama with `nomic-embed-text` for semantic search (verified on PC ~40-80ms/embed and on the
  phone ~3.6s/embed).
- Code-reviewed (3-agent) with 31 findings fixed pre-ship; backend suite 389/389.

---

## v3.2.0 - Flexible time tracking + Clients
*September 2026*

### Added

- **Clients** (#86) - a grouping level above projects (a life area like Work, Family, Self). Manage them in a collapsible sidebar section; assign a project to a client from the project's edit dialog. Deleting a client keeps its projects - they just become Ungrouped.
- **Task-free time tracking** - start a timer with just a description (and an optional project); no more phantom Inbox task. Time entries are first-class now: each carries its own description and project, and the task link is optional - so you can log life (sleep, chores, gaming) alongside task work.
- **Edit the running entry from the timeline** - click the live block to fix its start / description / project (the end stays "running"), with a "Set start to last stop" button for gap-free chaining.
- **Radial time picker** - a clock-dial 12-hour AM/PM picker for entry start/end, replacing the native dropdown.
- **Journal "Today so far" breakdown** - the day's tracked time split by Client / Project with proportion bars.
- MCP gains a **client** tool family and **task-optional** timers/logs; `get_time_summary` now groups by client/project. 45 tools total.

### Changed

- **Drag-reorder projects** in the sidebar; each row shows its client, and the edit/delete actions moved into a "..." menu so names aren't truncated. The rail is a touch wider.
- **Timeline** opens in Day view and renders on a **5-minute-box grid** so short entries always fit; blocks that would collide **push down** instead of overlapping. The add/edit form is a **bottom sheet on mobile / centered modal on desktop** with a pinned Save - and clicking away saves.
- **Timer entries are tidied on stop** - anything under 2.5 min is discarded (accidental taps), and kept entries snap both edges to the nearest 5 min, so the calendar stays clean and contiguous.
- The running timer and timeline now **poll**, so a start/stop on one device shows on another within ~15s.

### Notes

- New `Clients` table; `Project` gains `ClientId` + `Position`; `TimeEntry.TaskId` is now nullable with its own `Description` + `ProjectId`. Deleting a task / project / client SET-NULLs the link on time entries (logged time is never lost; a deleted task's title is snapshotted into its entries first). Migration `AddClientsAndDecoupleTimeEntries`.
- New endpoints: `/api/clients` CRUD, `POST /api/projects/reorder`, `GET /api/time-entries/suggestions`; time-entry start/log/edit accept an optional task + description + project.
- No new runtime dependencies. Not yet deployed - ship, then deploy backend first and restart the phone MCP.

---

## v3.1.0 - Journal QoL: drill-down feelings wheel
*July 2026*

### Changed

- **The feelings wheel now drills down** (#85) - instead of all 130 feelings at once (unreadable slivers on a phone), one level fills the whole circle at a time: the seven cores first, then a tapped feeling's finer shades, with a zoom in/out animation. **Picking a word logs it and resets the wheel to the cores**, ready for the next feeling; deepest slices pick on tap, the center picks the word you're standing on. Back and "all" navigate without picking.
- **Every feeling explains itself** - all 130 wheel entries carry a short differentiating gloss ("infuriated: boiled over, seeing red" vs "annoyed: small irritation, still in control"), shown under slice names and in the wheel's center to ease finding the right word.
- **Map of Consciousness reference ladder** - an info button beside the derived score opens a full-spectrum, log-scaled ladder (major Hawkins anchors labeled, courage line marked, your current picks-average positioned). Captioned honestly: "a lens, not a measurement".
- **Plan tasks open their sheet in the journal** - tap a task title in Today's Plan or the Unplanned bucket to open the full task detail (subtasks, comments, pickers) and edit sheet without leaving the page.
- The check-in modal is bigger on desktop (640px).

### Notes

- Wheel dataset (`feelingsWheel.ts`) gains a `hint` field on every core, secondary, and tertiary, pinned by a dataset test. New `MocLadder` component; the rail gained no widget - the ladder lives inside the check-in popup where tagging happens. 7 new component tests cover the drill-down interaction.

---

## v3.0.0 - Journaling
*July 2026*

### Added

- **Journal** (#79) - a new top-level section (`/journal`): one structured note per day, with a calendar (entry dots) to browse any date.
  - **Three templates**: Daily (check-ins, What's going on, Mind dump, Projects today, Today's plan, Front/Back of mind, Daily review, Evening review, Journal), Gratitude, and Affirmations (revisited at the evening close to celebrate wins). Empty sections stay quietly collapsed; the optional Journal section is "earned depth only".
  - **Mood check-ins** - timestamped, several per day, logged through a **feelings wheel** (7 cores / 41 secondaries / 82 tertiaries, multi-select, own words welcome). The **Map of Consciousness score is derived from your picks, never self-tagged**; the rail shows the day as a **mood arc** colored red-to-green by level with a courage-200 reference line. Emotion shift and energy-at-EOD derive from your first and last check-ins.
  - **Task-linked plan** - three buckets (Non-negotiable / If energy allows / Easy wins); the combobox finds open tasks or creates one via an explicit "+ Create task" row (due today, Inbox). **"Unplanned, got done"** fills itself from tasks completed that day that were never planned.
  - **Front/Back of mind** - transient rail lists designed to be cleared by close of day; uncleared items resurface tomorrow as "rolled over - keep?" candidates.
  - **Today so far** widget (plan progress, time logged, habits, check-ins) + a jump-to-evening shortcut; after 6pm the page opens on the evening cluster.
  - **Edit / Preview toggle** and **export** - preview and download show the same backend-rendered, Obsidian-compatible markdown; export one day as `.md` or everything as a zip.
  - The journal carries its own scoped look (fog paper / plum / serif prose, soft dark mode) via new `--color-j-*` tokens; the rest of the app is untouched.

### Notes

- New tables: `JournalTemplates` (code-defined, upserted by key at startup), `JournalEntries` (one per template per date, unique-indexed, content as JSON TEXT), `MoodCheckins` (first table with no Task FK). New `completedOn=` filter on `GET /api/tasks`. Markdown is generated by a pure `Services/JournalMarkdown` helper - stored data is structured JSON, markdown is only ever a render.
- New frontend dependency: `react-markdown` (preview display only). Feelings-wheel dataset + Hawkins scale mapping sourced in `docs/research/feelings-wheel-moc.md`.
- Journal endpoints are LAN-only and NOT exposed over the MCP connector yet - deliberately deferred until minimal auth (planned v3.1).

---

## v2.20.0 - Subtasks
*July 2026*

### Added

- **Subtasks** (#78) - break a task into a checklist of one-line items, each with a done state, a manual order, and an optional deadline.
  - Subtasks show **inline, clubbed under their parent** on every surface - the desktop table (a full-width sub-row beneath the task), the mobile card, and the board card - as tickable circles with a **"2/5" progress** badge. Tap a circle to tick a step without opening anything. A subtask with a deadline shows that date inline next to it.
  - The **task detail** (modal + `/tasks/:id` page) has a full subtask editor: add inline, tick, set/clear a per-subtask deadline, delete, and **drag-reorder**.
  - **Completing a parent** that still has open subtasks asks what to do: **complete them all**, or **move them out** as their own standalone tasks (kept in the parent's project, with a back-reference). Recurring tasks get the same prompt, then the next occurrence spawns with a fresh, all-unchecked copy of the checklist.
- **MCP: 7 new tools** bringing total to 36: 6 subtask tools (`add_subtask`, `list_subtasks`, `set_subtask_completion`, `update_subtask`, `delete_subtask`, `reorder_subtasks`) plus **`find`** - one by-name search over both tasks and subtasks that tags each hit `task` or `subtask` (subtasks carry their parent), so "I finished wire up the waitlist form" resolves in a single call without knowing which task it's under.

### Notes

- New `Subtasks` table (`Tasks` 1-to-many, cascade delete) mirroring the `TaskComment`/`CheckIn` pattern. Tasks gain response-only `subtaskCount` / `completedSubtaskCount` (always present) and a `subtasks[]` array (loaded on the detail, and on the list only when the web passes `?includeSubtasks=true` for the inline checklist; MCP's `list_tasks` stays lean with counts only).
- New frontend components: `SubtaskChecklist` (the inline clubbed list, shared by card + table + board), `SubtaskSection` (full editor with @dnd-kit drag-reorder), `CompleteWithSubtasksDialog` (the complete-all vs pull-out prompt). First drag-and-drop dependency: `@dnd-kit`.

---

## v2.19.0 - Time tracking + project colors
*June 2026*

### Added

- **Time tracking** (#77) - track how long you spend on tasks, Toggl-style.
  - A **persistent tracking bar** sits at the bottom-left on desktop, full-width on mobile. Type a task name and hit Start to quick-create an Inbox task and begin tracking immediately - or start a timer on any existing task from its row in the task list. The bar shows the running task title and a live H:MM:SS clock; one tap stops it.
  - A **Toggl-style timeline** at `/time` renders a vertical hour grid with day columns (day or week view). Each tracked interval is a project-colored block - click an empty slot to log an entry, click a block to edit or delete it. Running entries grow live off the 1 s tick.
  - **Snap-to-5-min / exact** granularity setting on the timeline page.
  - **Inbox color picker** on the timeline page - Inbox tasks have no project color, so you can assign one that persists in localStorage.
  - At most one timer runs at a time (server-enforced). Starting a new one auto-stops the previous.
- **Project colors** - each project can have a hex color set when creating or editing it. The color appears as a left border on timeline blocks and as a swatch in the sidebar/modal.
- **MCP: 9 new tools** bringing total to 29:
  - Time tracking (7): `start_timer`, `stop_timer`, `get_active_timer`, `log_time`, `edit_time_entry`, `delete_time_entry`, `get_time_summary`
  - Habits (2): `get_habits` (full dashboard - streak, done-today, weekly progress), `undo_habit_checkin`, `get_habit_checkins`
  - Comments (2): `list_task_comments`, `delete_task_comment`
  - Projects: `create_project` and `rename_project` now accept an optional `color` hex param

### Notes

- New `TimeEntries` table (`Tasks` 1-to-many). `Projects` table gains a nullable `Color` column.
- `ColorPickerButton` component replaces the legacy inline `ColorPicker.tsx` - a swatch button that opens a floating popover; used in the sidebar, edit modal, and timeline settings. `LabelColorButton` is the label-specific equivalent.
- `TimeTrackingContext` (React context) owns the single running entry and a 1 s tick that only fires while a timer is active, so live elapsed seconds render across the bar, the task row timer control, and the timeline without a separate polling loop.

---

## v2.18.1 - Fix: frequency habit check-in progress
*June 2026*

### Fixed

- Checking in an "x times a week" habit now updates its **"n/x this week"** count and the current-week strip cell immediately. Previously the streak flame moved but the weekly progress stayed stale (and the week cell stayed grey) until the next background refresh - and a second check-in in the same week could briefly show the wrong streak. The optimistic update is now frequency-aware (#76).

---

## v2.18.0 - Habits v2 Step 2 (frequency + deadline-free schedules)
*May 2026*

### Added

- **"X times a week" habits** (#75) - a habit's schedule can now be a weekly **frequency** ("go to the gym 3x a week") instead of fixed days. Pick the mode in the habit's Schedule chip: **Specific days** (the existing "every Tue & Thu") or **x times a week** (a 1-7 stepper). A frequency habit is checkable any day; its card shows **"n/x this week"**, a **week-based streak**, and a strip of recent weeks coloured green (target met), yellow (showed up but under target), or grey (missed). The streak counts consecutive weeks you showed up at least once - hitting the full target turns the week green, but a yellow week still keeps the streak alive; only a fully missed week breaks it.
- Claude can set the frequency over the connector: `create_task` / `update_task` accept a `weeklyTarget` (1-7).

### Changed

- **Habits no longer need a deadline to have a schedule** (#75). A habit's recurrence is its check-in pattern, not a due date, so the **Due chip is hidden for habits** and you can set a schedule with no deadline. (Ordinary recurring *tasks* still need a deadline - it's the anchor they advance from on completion.)

### Notes

- Small database migration: one nullable `WeeklyTarget` column; existing habits are untouched and stay on the specific-days/daily model. A habit is one mode or the other (specific-days OR a weekly target), never both. Deferred to a later pass: a combined "x times among chosen days" mode, an "x times a month" period, and the calendar heatmap.

---

## v2.17.0 - UI uplift (tokens + chip sheet + board) + Habits v2
*May 2026*

### Added

- **Design-token foundation** - all colors now come from semantic CSS variables (surface, text, border, accent, success/warning/danger), so the look is consistent and a dark theme later is a drop-in. Focus rings are unified to one accent color (an accessibility improvement).
- **Chip-driven task sheet** - adding and editing a task now happens in one sheet (a centered dialog on desktop, a keyboard-aware bottom-sheet on mobile). The title is a quick-add field (type `friday #Work @urgent p1` / `!urgent`); recognized bits highlight and become chips you can adjust, **Escape** (or tapping a highlight on mobile) turns a recognized bit back into plain text, and `#project` / `@label` auto-create. Replaces the old inline add form + edit modal.
- **Board view** - a List | Board toggle with a Group-by control (due bucket / project / priority). The board shows horizontally-scrollable columns of rich cards (shadow, due-colour tint, priority pill). Each view remembers its own layout.
- **Habits, reworked** - a habit is now **never completed/closed**; its control is a daily **check-in** (an amber ring that fills green when done today). Habit rows are marked with a flame so they stand out, a **right-side Habits panel** lets you check in without leaving your task list, and a habit can carry a **schedule** (e.g. "every Tue & Thu") - the streak counts only the scheduled days, so skipping a non-scheduled day never breaks it.

### Fixed

- A habit could previously be "completed" from the task list (closing it) while still showing on the Habits page - two disconnected "done" states. Habits are no longer completable; daily check-in is the only "done."

### Notes

- Frontend-only; no database migration. The "x times a week" habit frequency model is intentionally deferred to a later pass.

---

## v2.16.0 - Habit tracking
*May 2026*

### Added

- Any task can now be tracked as a **daily habit** (#74). Tick "Track as a daily habit" when adding or editing a task, and it shows up on a new **Habits** view (sidebar link).
- Each habit on the Habits view shows:
  - a **current streak** - the number of consecutive days you've checked it in (counting back from today; not checking in *today* yet doesn't break the run until tomorrow)
  - a **last-7-days dot row** - one filled dot per day you checked in
  - a big **"Mark done today"** toggle - one tap logs today's check-in (tap again to undo). Checking in is idempotent: doing it twice in a day doesn't double-count.
- Claude can check a habit in for you over the MCP connector: a new **`log_habit_checkin`** tool ("I meditated today", "mark my workout done"), and `create_task` / `update_task` accept an `isHabit` flag.

Habits are decoupled from recurring tasks: a habit is an ongoing daily check-in, not a finish-once task. Check-ins are stored per day in a new table (a small database migration; existing tasks are untouched and default to not-a-habit). A GitHub-style calendar heatmap is a deliberate later addition - the check-in data already supports it.

This is the finale of the recurring + habits program (v2.13.0 comments -> v2.14.0 recurrence -> v2.14.1 advanced grammar -> v2.15.0 quick-add -> v2.16.0 habits).

---

## v2.15.0 - Natural-language quick-add
*May 2026*

### Added

- The add-task title field is now a Todoist-style quick-add (#72). Type one line and it recognizes, inline, as you type:
  - a **due date** in natural language - "tomorrow", "friday", "jan 27", "in 3 days", "next week at 4pm"
  - a **repeat** - "every day", "every weekday", "every other monday", "every 3rd thursday", "monthly on the 1st"
  - **`#project`**, **`@label`** (auto-created if new), and **`p1`-`p4`** priority
- Recognized tokens are highlighted in the field and listed as removable chips below it (click the ✕ to unlink a wrong match). Typing `#` or `@` opens an autosuggest dropdown (arrow keys + Enter, or click). The parsed values also fill the Deadline / Project / Priority / Repeat controls live, so you can confirm or adjust.
- A bare multi-weekday list like "friday and saturday" (no "every") is treated as those specific days once each - modeled as a weekly repeat ending on the last day - rather than an endless repeat. "every friday and saturday" stays ongoing.

Frontend-only, no migration. Uses `chrono-node` for the free-form date parsing; recurrence and the symbol tokens are parsed in-house onto the existing recurrence grammar. Claude already understood these phrases via the MCP tool descriptions, so this closes the gap for the web UI (where there's no LLM to translate).

---

## v2.14.1 - Advanced recurrence
*May 2026*

### Added

- Recurrence now supports the richer Todoist-style patterns (#71):
  - "the 3rd Thursday" / "the last Friday" of the month (nth-weekday)
  - "the last day" of the month, or a day counted from the end
  - intervals: "every other week", "every 2 months"
  - end conditions: repeat **until** a date, or **for** a set number of times - after which the series stops (and logs a "series complete" note)
- The recurrence picker on the add/edit forms gained controls for all of these (monthly day-of-month / nth-weekday / last-day, an interval input, and an "Ends" option). Claude can use them too via the same `recurrence` rule string on `create_task`/`update_task`

No database migration - end conditions live in the recurrence rule itself, and "for N times" is tracked from the existing series history. This is a patch (it extends the v2.14.0 recurrence feature rather than adding a new one).

---

## v2.14.0 - Recurring tasks
*May 2026*

### Added

- Tasks can now repeat. Set a recurrence on the add/edit forms - daily, every N days, weekly on chosen weekdays, or monthly on a day-of-month - and a recurring badge shows the schedule on the list, cards, and the task detail page (#70)
- Completing a recurring task keeps the finished one as a completed history row and immediately creates the next occurrence with its deadline advanced per the rule (title, project, labels, priority, description, and recurrence carried over, linked by a shared series id). A completion comment ("Completed X, next due Y") is logged on the one just finished
- A recurring task needs a deadline to repeat from; recurrence advances from the scheduled date (not when you tick it off) and preserves the time of day
- MCP: `create_task` and `update_task` accept an RRULE-shaped `recurrence` string (e.g. `FREQ=WEEKLY;BYDAY=MO,WE,FR`), so Claude can "make this repeat every weekday"; completing via `set_task_completion` spawns the next occurrence. Tasks now carry `recurrence` / `seriesId` / `isRecurring`
- New `Recurrence` + `SeriesId` columns on the task (DB migration)

Recurrence is stored RRULE-shaped (RFC 5545) so the grammar can grow. This core supports daily / every-N-days / weekly-on-weekdays / monthly-on-day; advanced patterns ("3rd Thursday", end conditions), natural-language entry, and habit streaks are planned follow-ups. Bulk-complete does not spawn next occurrences (complete recurring tasks individually).

---

## v2.13.0 - Task comments
*May 2026*

### Added

- Tasks can now have timestamped comments - notes, progress, context. Add and delete them in a comments section on the task detail page. Stored in a new `Comments` table (DB migration; cascade-deleted with the task) (#69)
- `GET /api/tasks/{id}` now returns the task's `comments[]` (newest first); new `POST`/`GET`/`DELETE` endpoints under `/api/tasks/{id}/comments`
- MCP: `add_task_comment(taskId, body)` so Claude can "add a note to task N"; comments are read back via `get_task`. MCP tool count: 20 → 21

Comments are capped at 2000 characters. This is the first slice of the planned recurring + habit-tracking program (it's the substrate the per-completion log will use).

---

## v2.12.0 - Deadline time-of-day
*May 2026*

### Added

- Deadlines can now include an optional time of day ("due Friday at 3pm"), set via a time field beside the date on the add-task form and the edit modal. Leave it blank for a date-only deadline, exactly as before (#68)
- `dueStatus` reflects the time: a timed deadline becomes `overdue` the moment it passes, while a date-only deadline stays due all that calendar day (then overdue the next). today / this_week / later are still calendar-based
- The deadline shows its time wherever it's displayed (list pill, task detail). MCP `create_task`/`update_task` already accepted a datetime; their descriptions now spell out the date-vs-datetime distinction

No DB migration (the deadline column already stored a datetime). Interpreted in the server's local time.

---

## v2.11.0 - Task description field
*May 2026*

### Added

- Tasks now have an optional free-text `description` - notes, context, a link - so titles stop doubling as metadata storage. Stored as a new nullable `Description` column (DB migration; existing tasks get null) (#67)
- Editable via an optional multiline field on the add-task form and the edit modal, and shown on the task detail page (line breaks preserved). Cleared by blanking it
- MCP: `create_task` and `update_task` accept a `description` (pass null on update to clear), and it is included in returned task objects - so Claude can "add a note to task N" or read a task's context

Capped at 2000 characters. Plain text (no markdown rendering this release).

---

## v2.10.7 - Agent ergonomics (bulk priority + name resolution)
*May 2026*

### Added

- `bulk_set_priority` - set the priority on many tasks at once, closing the bulk asymmetry (complete/move/deadline already had bulk variants). Available as a `setPriority` operation on `POST /api/tasks/bulk`, a `bulk_set_priority` MCP tool, and a "Set priority" action on the web bulk-actions bar. MCP tool count: 19 → 20 (#66)
- Name-based resolution: `assign_task_to_project` / `bulk_assign_to_project` accept a `projectName`, and `set_task_labels` accepts `labelNames`, resolved server-side (case-insensitive, exact). So Claude can "move these to Work" or "tag these urgent" without a `list_projects`/`list_labels` lookup first. Ids still work; an ambiguous or unknown name returns a clear 400

No DB migration. The web UI gains the bulk priority action; the rest is MCP/API surface.

---

## v2.10.6 - list_tasks query completeness
*May 2026*

### Added

- `GET /api/tasks` (and the MCP `list_tasks` tool) gained `createdAfter` / `createdBefore` filters on a task's creation date - so "what did I add today" is a single filtered call instead of fetching everything and eyeballing dates (#65)
- Sorting: `sort` (`created` / `deadline` / `priority`) + `order` (`asc` / `desc`), default `created` / `desc` (unchanged from before). Deadline sort lists tasks with no deadline last; priority ascending lists P1 first
- `limit` caps the result to the first N tasks after sorting (e.g. "top 5 by priority"); omit for all, `limit < 1` returns 400

MCP-only surface growth - the web UI is unaffected. No DB migration.

---

## v2.10.5 - Task priority (P1-P4)
*May 2026*

### Added

- Tasks now have a priority on the Todoist P1-P4 scale: P1 = Urgent (red), P2 = High (orange), P3 = Medium (blue), P4 = None (the default). Stored as a new `Priority` column (DB migration; existing tasks default to P4) (#64)
- Set priority on the add-task form and the edit modal; a small colored dot appears next to the title for P1-P3 (P4 shows nothing). A priority filter row on the filter panel narrows the list by one or more priorities
- MCP: `create_task` and `update_task` accept a `priority` param (1-4), `list_tasks` accepts a `priorities` filter, and the priority is included in returned task objects - so Claude can "make this P1" or answer "what's P1 and due this week?" in one call

---

## v2.10.4 - Bulk task operations
*May 2026*

### Added

- `POST /api/tasks/bulk` - apply one operation to many tasks in a single transaction: `complete` (complete/reopen), `assignProject` (move to a project or Inbox), or `setDeadline` (set or clear). Returns the affected tasks; unknown ids are skipped. There is intentionally no bulk delete (#63)
- Three MCP tools - `bulk_set_completion`, `bulk_assign_to_project`, `bulk_set_deadline` - so Claude can reorganize many tasks in one call (e.g. "move these 5 to Work", "push all of these to Friday") instead of one call per task. MCP tool count: 16 → 19
- Web UI multi-select: a "Select" toggle on the task list reveals selection checkboxes (desktop column with select-all, mobile card checkboxes) and a sticky bulk-actions bar with Complete, Reopen, Move to project, and Set deadline

---

## v2.10.3 - Computed dueStatus field + MCP tool-description shape hints
*May 2026*

### Added

- Every task now carries a server-computed, read-only `dueStatus` field alongside `deadline`: one of `overdue`, `today`, `this_week` (through the upcoming Sunday), `later`, or `none`. Computed in the API layer relative to today (no DB column, always current), so Claude and the web UI get consistent due buckets without each recomputing them (#61)
- The MCP `Task` shape and the web UI `Task` type both expose `dueStatus`. The web UI keeps its own deadline-pill colors (a 3-day threshold, intentionally distinct from the calendar-week `dueStatus` buckets)

### Changed

- All 16 MCP tool descriptions now end with a "Returns: ..." sentence describing their output shape, so LLM clients can reason about results before calling. The task-returning tools document the full task shape including the new `dueStatus`

---

## v2.10.2 - Editable task title and deadline
*May 2026*

### Added

- `PATCH /api/tasks/{id}` - partial update of a task's `title` and/or `deadline`. Present-key detection: an omitted field is left unchanged, `deadline: null` clears the deadline, and a value sets it. Returns 400 on an empty/whitespace title or an unparseable date, 404 if the task does not exist. Until now title and deadline could only be set at creation (#59)
- MCP `update_task(id, title?, deadline?)` tool wrapping the new endpoint, so Claude can rename a task or change/clear its deadline without delete-and-recreate (which lost `createdAt` and completion history). MCP tool count: 15 → 16
- Web UI edit modal (`EditTaskModal`) on the task three-dot menu and a desktop table edit action - edits title, deadline, project, and labels in one place, firing only the fields that changed
- Web UI quick-deadline popover (`DeadlinePopover`) on the deadline pill: Today, Tomorrow, This weekend (upcoming Saturday), Next week (upcoming Monday), or None to clear

---

## v2.10.1 - MCP task filtering + tool consolidation
*May 2026*

### Added

- `GET /api/tasks` now accepts optional filter query params: `projectIds`, `inbox`, `labelIds`, `dueBefore`, `dueAfter`, `completed`, and `text` (case-insensitive title substring). Filters AND together across dimensions; within `projectIds`/`labelIds` the semantics are OR. No params returns all tasks as before (#57)
- The MCP `list_tasks` tool surfaces all of those filters, so Claude can answer "what's due this week in the Work project?" or "tasks tagged urgent" with a single server-side filtered call instead of fetching everything
- Text-search box on the web UI's filter panel (client-side title substring match)

### Changed

- MCP `complete_task` and `uncomplete_task` merged into a single `set_task_completion(id, isCompleted)` tool. MCP tool count: 16 → 15
- Tasks with no deadline are excluded from `dueBefore`/`dueAfter` filters. Sending `inbox=true` together with a non-empty `projectIds` returns 400 (contradictory)

---

## v2.10 - MCP server for claude.ai custom connector
*May 2026*

### Added

- Tasklog now speaks the [Model Context Protocol](https://modelcontextprotocol.io/specification/2025-06-18). A new Node/TS service (`mcp/`) exposes all Tasklog operations as MCP tools so claude.ai can manage tasks on your behalf (#50)
- 16 MCP tools: list/get/create/delete/complete/uncomplete tasks, assign tasks to projects, set task labels, list/create/rename/delete projects, list/create/update/delete labels
- OAuth 2.1 authorization server with Dynamic Client Registration (RFC 7591), PKCE S256 (RFC 7636), Authorization Server Metadata (RFC 8414), Protected Resource Metadata (RFC 9728), and Resource Indicators (RFC 8707) - the full spec stack claude.ai's connector requires
- GitHub OAuth upstream for user authentication: log in with GitHub, allow-listed by username (env var `ALLOWED_GH_USERS`), zero passwords managed by the server
- Cloudflare Tunnel integration so the MCP endpoint is publicly reachable at `https://mcp-tasklog.manudubey.in` without exposing the phone's IP or opening any inbound ports
- `scripts/deploy-phone.sh` extended to build, transfer, and supervise the new `tasklog-mcp` and `tasklog-tunnel` services via runit
- `guides/mcp-server-setup.md` - top-level end-to-end walkthrough
- `guides/cloudflare-tunnel-dns-setup.md` - prerequisite: migrating a domain to Cloudflare DNS
- `guides/github-oauth-app-setup.md` - prerequisite: registering the upstream OAuth App
- `docs/learnings/{mcp-protocol,oauth-2-1-for-mcp,cloudflare-tunnel,dns-and-nameservers,github-oauth-vs-github-apps}.md` - five new study docs covering the concepts behind this feature
- `docs/research/{mcp-spec-2025-06-18,claude-ai-connector-oauth,cloudflare-tunnel}.md` - verified excerpts from canonical specs and vendor docs
- `docs/workflow-notes.md` - new living doc for tracking workflow experiments and deviations across features

### Changed

- `manudubey.in` DNS migrated from Porkbun's nameservers to Cloudflare's (required for Tunnel; existing GCP + GitHub Pages records preserved)

### Security notes

- The Tasklog .NET API remains LAN-only with no authentication. The MCP server is the ONLY public surface; it gates access with OAuth + GitHub upstream + a one-name allow-list before forwarding any request to the API.
- Access tokens are short-lived (1 hour) and audience-bound; refresh tokens (30 days) rotate on every use per OAuth 2.1 for public clients.
- OAuth state lives in a separate SQLite file (`mcp/data/auth.db`); the Tasklog task DB is unchanged.

---

## v2.9 - Deploy Tasklog to GCP
*April 2026*

### Added

- Tasklog is now publicly hosted at `https://tasklog.manudubey.in` - a live demo on a GCP Compute Engine e2-micro VM (always-free tier) (#48)
- `scripts/deploy-gcp.ps1` - one-command deploy script: builds locally, transfers to VM, restarts services
- `guides/gcp-server-setup.md` - full one-time VM setup walkthrough (nginx, systemd, certbot, cron)
- `guides/gcp-deploying-updates.md` - guide for pushing future releases using the deploy script
- Demo database resets every 6 hours from a seed copy so the live demo stays clean

### Changed

- `api.ts` URL resolution now splits SSR and browser paths - server-side uses `API_URL` (private, direct to backend), browser uses `NEXT_PUBLIC_API_URL` (through nginx). Local dev behaviour unchanged.

---

## v2.8.1 - Bug Fix
*April 2026*

### Fixed

- Labels column missing from desktop task table - labels were only rendered in the mobile card view. Added a Labels column between Created and Completed in the desktop table. (#46)

---

## v2.8 - README Overhaul and MIT License
*April 2026*

### Added

- MIT license file (`LICENSE`) added to the repo root (#47)
- README rewritten as a proper GitHub project landing page: badges, screenshots placeholder, scannable feature list, all-platform download links, Windows first-run notes, Quick Start for users, and Run from Source for contributors (#47)
- Dark mode and custom themes added to the roadmap

### Changed

- API endpoints table removed from README - it lives in `docs/architecture.md`
- `Readme.md` renamed to `README.md` (standard casing)

---

## v2.7.1 - Bug Fix
*April 2026*

### Fixed

- Frontend fails to start in downloaded package - the inner `.next/` directory inside the Next.js standalone output was silently excluded from the CI artifact because `upload-artifact@v4` skips hidden directories by default. Added `include-hidden-files: true` to the upload step. (#45)

---

## v2.7 - CI and Cross-Platform Distribution
*March 2026*

### What changed

**CI / Build**
- GitHub Actions release workflow builds all 4 platform packages automatically when a version tag is pushed
- Packages are uploaded directly to the GitHub Release: `Tasklog-win-x64.zip`, `Tasklog-mac-arm64.tar.gz`, `Tasklog-mac-x64.tar.gz`, `Tasklog-linux-x64.tar.gz`
- `workflow_dispatch` trigger allows manual test builds without creating a tag
- Frontend built once on Ubuntu (platform-independent); backend and launcher compiled per platform
- Node.js portable binary verified against official SHA-256 checksums before bundling

**Cross-platform**
- Launcher now detects the OS at runtime - no hardcoded `.exe` extensions on Mac/Linux
- New publish profiles for `osx-arm64`, `osx-x64`, and `linux-x64` (backend and launcher)
- Mac packages include Gatekeeper workaround instructions in README.txt
- `run.sh` added for Mac/Linux contributors as a bash equivalent of `run.ps1`

**Fixed**
- `usePolling` hook was referenced in components but missing from git - committed and verified
- Mac Intel (`osx-x64`) cross-compiled from Ubuntu after `macos-13` runner was discontinued

**Issues resolved**
- #44 - CI with GitHub Actions and cross-platform distribution

---

## v2.6 - Background Auto-Refresh
*March 2026*

### What changed

**Frontend**
- The app now silently polls for changes every 30 seconds, keeping tasks, projects, and labels in sync across devices
- New `usePolling` custom hook with `setInterval` and the Visibility API - pauses polling when the tab is hidden, fires an immediate fetch when the tab becomes visible again
- Tasks page (`TasksClient`) polls tasks and labels together, skipping poll cycles during in-flight deletes or completions to avoid disrupting animations
- Projects sidebar (`ProjectLayout`) polls for project list changes in the background
- Labels management page (`LabelsClient`) polls for label changes, pausing during create/edit/delete operations
- Open forms, active filters, and scroll position are preserved across polls

**Documentation**
- `usePolling` hook pattern documented in engineering guidelines

**Issues resolved**
- #42 - Background Auto-Refresh

---

## v2.5 - Downloadable Package
*March 2026*

### What changed

**Distributable package**
- Tasklog can now be downloaded as a single zip and run on any Windows machine with no prerequisites
- PowerShell build script (`build.ps1`) produces the distributable zip
- C# launcher (`Tasklog.exe`) starts both backend and frontend, displays browser and LAN URLs, handles clean shutdown
- .NET backend published as self-contained single-file exe (no .NET SDK needed on target)
- Next.js frontend built in standalone mode with bundled portable Node.js binary
- Sample database with 3 projects, 4 labels, and 12 tasks pre-loaded for demo purposes
- README.txt with quick-start and troubleshooting instructions included in the zip

**Backend**
- CORS now works in all environments: `FrontendDev` policy for development, `Distributable` policy (any origin) for production
- Database path resolves relative to the exe directory in production, fixing issue #3
- HTTPS redirection disabled in production (distributable runs over HTTP on local network)

**Frontend**
- Dynamic API URL detection: uses `NEXT_PUBLIC_API_URL` if set (dev mode), otherwise derives from `window.location.hostname` (distributable mode)
- This fixes issue #1 - the app now works on any device without hardcoded IPs
- Next.js standalone output configured for self-contained builds

**Issues resolved**
- #1 - CORS and server-side fetch break outside localhost
- #3 - Fragile database path

---

## v2.4 - Labels and Filtering
*March 2026*

### What changed

**Backend**
- New `Labels` table with many-to-many relationship to Tasks (implicit join table via EF Core)
- New endpoints: `GET /api/labels`, `POST /api/labels`, `PATCH /api/labels/{id}`, `DELETE /api/labels/{id}`
- New endpoint: `PATCH /api/tasks/{id}/labels` - replaces the full label set on a task
- Label name uniqueness enforced (case-insensitive, returns 409 Conflict)
- Label ID validation on assignment (returns 400 with invalid IDs)
- Task queries now eager-load labels via `.Include(t => t.Labels)`

**Frontend**
- Labels dashboard page (`/labels`) accessible from the sidebar - full CRUD with inline rename, color picker, and delete with confirmation
- 10-color VIBGYOR palette for label colors, auto-cycling on creation
- Labels field in AddTaskForm with autocomplete, multi-select, and auto-create on Enter
- Labels row on task detail page with add/remove via AssignLabelsButton (optimistic updates)
- Label chips (`#labelname`) shown on mobile task cards
- Filter panel popover (three-dot menu in task list header) with label, project, and date filters
- Filter state persists across navigation via sessionStorage
- New components: `LabelsClient`, `FilterPanel`, `ColorPicker`, `LabelChip`, `AssignLabelsButton`

**Tests**
- 15 new tests for `LabelsController` (CRUD, validation, uniqueness, color range)

---

## v2.3 - Mobile Task Cards
*March 2026*

### What changed

**Frontend**
- Task list now shows as compact cards on mobile (below 768px) instead of a horizontal-scrolling table
- Each card shows a circle checkbox, task title (links to detail page), project name, deadline with proximity colour, and a three-dot menu with a Delete action
- Desktop table layout is unchanged
- Shared date formatting utilities extracted to `src/lib/format.ts` (closes backlog item #20)

---

## v2.2 - Projects and Inbox
*March 2026*

### What changed

**Backend**
- New `Projects` table: `Id`, `Name`, `CreatedAt`
- `Tasks` table: added nullable `ProjectId` foreign key
- New endpoints: `GET /api/projects`, `POST /api/projects`, `PATCH /api/projects/{id}`, `DELETE /api/projects/{id}` (cascade deletes all tasks in the project)
- New endpoint: `PATCH /api/tasks/{id}/project` - reassigns a task to a project or Inbox (null)

**Frontend**
- Left sidebar with "All Tasks", "Inbox", and named project views
- Sidebar hidden on mobile - opens as a drawer via hamburger button
- Create, rename, and delete projects from the sidebar
- Delete project shows a confirmation dialog warning that all tasks will also be deleted
- Task list filters by the active view (client-side)
- Add task form includes a project dropdown, pre-selected to the current view
- Task detail page includes a project selector to reassign after creation
- Error feedback banner for project create/rename/delete failures
- New components: `ProjectLayout`, `ProjectSidebar`, `AssignProjectButton`

---

## v2.1 - Task Completion
*March 2026*

### What changed

**Backend**
- Added `IsCompleted` (boolean) and `CompletedAt` (nullable datetime) to the Tasks table
- New endpoint: `PATCH /api/tasks/{id}/complete` - marks a task complete or incomplete, records timestamp

**Frontend**
- Checkbox on each task row to mark complete/incomplete
- Completed tasks animate out and hide from the default view after 1.5s
- "Show completed" toggle in the task list header reveals all completed tasks
- Completed date shown in list and detail page
- "Mark complete" / "Mark incomplete" button on the task detail page
- New `CompleteTaskButton` component (mirrors `DeleteTaskButton` pattern)

---

## v2.0 - Architecture Migration
*March 2026*

### What changed

The entire application was restructured from a monolithic ASP.NET MVC app into
two separate projects: a .NET Web API backend and a Next.js frontend.

**Backend**
- Replaced ASP.NET MVC + Razor Views with ASP.NET Core Web API
- Controllers now return JSON instead of rendered HTML
- Same EF Core + SQLite stack, same data model, same database file
- Namespace updated from `Tasklog` to `Tasklog.Api`

**Frontend**
- New Next.js 16 app (App Router) in `frontend/`
- Tailwind CSS v4 for styling
- Space Grotesk + DM Sans font pairing
- Client-side state management replaces server-side TempData flash messages
- Deadline colour coding: red (overdue), yellow (due within 3 days)

**Repository**
- `Tasklog/` (v1 MVC project) moved to `legacy/` during migration, then removed
- `backend/` and `frontend/` folders replace the single project layout
- `Tasklog.sln` removed

### What stayed the same

- All v1 features: create task, view list, view detail, delete task, optional deadline
- SQLite database - existing data preserved, no schema changes
- No new features added during migration (by design)

### Known issues at release

See GitHub issues [#1](https://github.com/hydraInsurgent/Tasklog/issues/1) through
[#6](https://github.com/hydraInsurgent/Tasklog/issues/6) for limitations identified
during code review.

---

## v1.0 - Initial Release
*January 2026*

First working version. Single ASP.NET MVC app with server-rendered Razor views.

- Create tasks with title and optional deadline
- View all tasks
- View single task detail
- Delete tasks (delete = done in v1)
- SQLite persistence via EF Core
- Accessible over local network from phone and desktop
