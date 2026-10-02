# Tasklog Product Design

This document describes what Tasklog is today and the principles behind it.
It is a reference point, not a constraint. If a proposed feature or direction
differs from what is written here, that is a signal to have a conversation
and update this document - not to automatically reject the idea.

---

## What Tasklog is

Tasklog is a personal, self-hosted task management tool that, as of v3.0, grew
into a broader **day-tracking system**: tasks, time, habits, and a daily journal
share one data layer, so the day's plan, its execution, and its reflection live
on the same surface. Since v4.x the primary way in is **Sage, a conversational
companion**: narrate the day and the structure (tasks, time, moods, expenses,
notes, people) falls out - autonomously since v4.1, with undo instead of
approval.

It exists to replace subscription-based task apps for a single user who wants
full ownership of their data and a system they can understand end to end.

The current focus is simplicity and personal usability. The system is designed
to be useful to one person, run on their own machine, and stay small enough
to reason about completely.

---

## The user

A single user accessing the app from multiple devices.

Two access paths exist as of v2.10:

- **Direct web UI** on the same local network (phone, desktop): no authentication, browse to `http://<phone-ip>:3000`. Web UI and API stay LAN-bound; if you are not on the home network, you cannot reach them.
- **claude.ai connector** from anywhere on the internet: gated by OAuth 2.1 with a GitHub upstream allow-list of exactly one username. Authentication is at the MCP server, not the underlying API.

This shapes decisions like data storage (local SQLite on the phone, never replicated to a cloud) and the public surface area (one tightly-scoped MCP endpoint, not the full web UI). If the user profile changes - sharing with a partner, opening the web UI publicly - the allow-list, auth scheme, and CORS policy would all need to be revisited.

---

## Product principles

These guide feature decisions. They are not laws - but deviating from them
is worth being deliberate about.

**Add only what solves a real problem.**
Features come from actual usage needs, not speculation. A missing feature
is often better than one that adds complexity without clear value.

**Minimal by default.**
Each screen and interaction should do one thing clearly.
If something can be left out without losing usefulness, that is a good sign it should be.

**Owned and understandable.**
The user should be able to understand what the app does and where their data lives.
Dependencies that obscure this are worth questioning.

**Persistent and reliable.**
Data should not be lost unexpectedly. The app should behave the same way every time it runs.

---

## Current scope

This is what Tasklog does today. Items listed here are not permanent limits -
they reflect where the product is right now and what assumptions the code makes.

**Single user** - no multi-user accounts, roles, or sharing. The allow-list of one GitHub username is enforced at the MCP authorization server.
If multi-user or sharing becomes a real need, authentication on the web UI (currently absent) and data isolation in the DB would need to be added before anything else.

**Web UI is local-network only** - no cloud hosting of the UI, no public web access. Exposing the web UI publicly would require adding authentication to the .NET API and re-thinking the CORS policy.

**MCP endpoint is public** (as of v2.10) - `https://mcp-tasklog.manudubey.in` exposes Tasklog as a Model Context Protocol server for the claude.ai custom connector. The MCP endpoint is the ONLY public surface; it gates access via OAuth 2.1 + GitHub upstream + a one-name allow-list. The .NET API remains LAN-only and unauthenticated.

**No notifications** - deadlines are informational. The app shows them; it does not act on them.
A reminder or alert system would be a meaningful scope addition.

**No calendar integration** - deadlines exist on tasks but do not sync to external calendars.

**Single data file** - all task data lives in one SQLite file. A second small SQLite file (`mcp/data/auth.db`) holds OAuth state for the MCP server; this is operational state, not user data, and is safe to wipe at any time to force re-consent.

**AI companion is opt-in and host-bound** (v4.0) - Sage runs only where `COMPANION_ENABLED=1` is set AND a Claude Code subscription login exists on that machine. It is deliberately absent from the public VM (no app auth exists). Two AI doors, one brain: the in-app companion (owns the transcript; writes autonomously with undo since v4.1) and the public MCP connector (claude.ai, direct writes) both operate on the same API.

**Screen activity stays home** (v4.1) - the tape (window titles + idle state) is the most sensitive stream after journal prose. It is LAN-only, titles-only, and is not exposed over the MCP surface.

---

## How features currently work

**Tasks**
- A task has a title (required) and an optional deadline.
- A task can have an optional free-text description (v2.11.0) - notes, context, a link - editable on the add/edit forms and shown on the task detail page. Keeps the title clean instead of stuffing metadata into it.
- A task can have timestamped comments (v2.13.0) - add/delete them on the task detail page or add via Claude. The first step toward richer task detail. (Habit check-ins, v2.16.0, ended up in their own per-day table rather than as comments.)
- A task can have **subtasks** (v2.20.0, #78) - a checklist of one-line items under it, each with a done state, a manual order, and an optional deadline. They are deliberately lightweight (no per-subtask priority/labels), modeled as a small dedicated table rather than full child tasks. Subtasks show **inline, clubbed under their parent** on every surface (desktop table sub-row, mobile card, board card) as tickable circles with a "2/5" progress badge; a dated subtask shows its date inline. They never appear as their own separate rows - the checklist always stays visually under its task. The detail modal + `/tasks/:id` page have the full editor (add/tick/set-deadline/delete/drag-reorder). **Completing a parent** with open subtasks prompts: complete them all, or pull the open ones out as standalone tasks (in the parent's project, with a back-reference) - the only way a subtask "graduates" into a real task. Recurring tasks show the same prompt, then the next occurrence spawns with the checklist reset to unchecked (title + order carried, per-occurrence deadlines dropped). Claude manages subtasks via 6 MCP tools. Deferred: per-subtask priority/labels, surfacing a dated subtask in the due list, and an event/notification log built on completion events.
- A task can repeat (v2.14.0) - set a recurrence (daily, every N days, weekly on chosen weekdays, or monthly on a day-of-month) on the add/edit forms or via Claude. A recurring task needs a deadline to repeat from. Completing it keeps the finished one as history and immediately creates the next occurrence with its deadline advanced, logging a completion comment on the one just done.
- Recurrence also supports the richer Todoist-style patterns (v2.14.1): "the 3rd Thursday" / "the last Friday" of the month, "the last day" / a day counted from month-end, "every other week / every 2 months" (intervals), and an end condition - repeat until a date or for a set number of times, after which the series stops.
- Natural-language quick-add (v2.15.0): the add-task title field parses one line of natural language - a due date ("friday", "tomorrow at 4pm", "jan 27"), a repeat ("every weekday", "every 3rd thursday"), `#project`, `@label`, and `p1`-`p4` - highlighting each token inline, listing them as removable chips, autosuggesting `#`/`@`, and filling the structured controls to match. A bare multi-weekday list ("friday and saturday") means those specific days once each (a weekly repeat with an end date), not an endless repeat. This is web-only (Claude already parses such phrases over the MCP).
- A task can be tracked as a daily habit (v2.16.0) - tick "Track as a daily habit" on the add/edit forms (or set `isHabit` via Claude). A habit is **never completed/closed** - its action is a daily **check-in** (#73): in the task list a habit row shows a flame + a check-in toggle (not the complete checkbox), and a right-side Habits panel + the `/habits` page let you check in and see the streak, last-7-days dots, and schedule. Checking in is one tap and idempotent; Claude checks in with `log_habit_checkin`. A habit's **schedule** is one of two modes (#75): **specific days** via a recurrence rule (e.g. "every Tue & Thu") - the streak counts only scheduled days, so skipping a non-scheduled day doesn't break it; or **x times a week** - a weekly target ("gym 3x a week"), checkable any day, where the card shows "n/x this week", a week-based streak, and a green/yellow/grey strip of recent weeks (target met / showed up / missed). A habit's schedule needs **no deadline** - the Due chip is hidden for habits (a deadline only matters for finish-once recurring *tasks*, which a habit is not). A habit is decoupled from recurring tasks (which are finish-once-and-respawn). Deferred: a combined "x times among chosen days" mode, an "x times a month" period, and a calendar heatmap.
- Tasks can be viewed as a **list** or a **board** (#73). The board groups tasks into horizontally-scrollable columns by due bucket / project / priority (a group-by control); each view remembers its own list/board + group-by choice. The "view mode" (how tasks are shown) is a separate axis from scope/filter (which tasks) - so calendar/today views can slot in later.
- Adding and editing a task uses one **chip-driven sheet** (#73): a quick-add title field plus chips for due date / priority / project / label / recurrence. Replaces the old inline add form + edit modal.
- Title and deadline are editable after creation (v2.10.2): an Edit action on each task opens a modal for title, deadline, project, and labels, and the deadline pill has a quick-set popover with presets (Today, Tomorrow, This weekend, Next week, None). The deadline can be cleared. Editing preserves the task's created date and completion history (unlike delete-and-recreate).
- A task exists until it is deleted.
- Tasks can be marked complete via a checkbox. Completed tasks hide from the default view with a brief animation.
- A "Show completed" toggle reveals all completed tasks. Completion can be undone.
- CompletedAt timestamp is recorded when a task is marked done and cleared if un-completed.
- Deadlines are visible to the user but the app does not enforce or act on them.
- A deadline can optionally include a time of day (v2.12.0) - "due Friday at 3pm". A timed deadline shows as overdue the moment it passes; a date-only deadline stays due all that calendar day. Set the time via an optional field beside the date; leave it blank for date-only.
- Every task carries a server-computed \`dueStatus\` (overdue / today / this_week / later / none), derived from the deadline relative to today (v2.10.3). It centralizes the due-bucket logic so Claude and any future client get a consistent answer without recomputing it.
- A task can belong to a project (optional). Tasks with no project are in Inbox.
- Bulk actions (v2.10.4): a "Select" mode on the task list lets you pick several tasks and, from a bulk-actions bar, complete/reopen them, move them to a project (or Inbox), or set/clear their deadline in one step. The same operations are available to Claude via bulk MCP tools, with bulk priority added in v2.10.7. There is no bulk delete - deletion stays one task at a time.
- Priority (v2.10.5): each task has a priority on the Todoist P1-P4 scale (P1 = Urgent, P2 = High, P3 = Medium, P4 = None, the default). It is set on the add/edit forms, shown as a small colored dot (P1-P3), filterable, and editable/queryable via Claude. P4 tasks show no dot, keeping the default view clean.

**Time tracking** (v2.19.0; decoupled from tasks in v3.2.0/#86)
- Time entries are **first-class actuals, not bound to a task** (#86). An entry carries its own free-text description and its own project; the task link is optional. So you can track **task work AND non-task life** (sleep, chores, gaming) on one timeline. A Task (planned intent) and a TimeEntry (executed interval) are distinct - one task can have many entries, and most life entries have no task - but they share the same Client -> Project tree.
- At most one timer runs at a time (server-enforced); starting a new one auto-stops the previous.
- A **persistent tracking bar**: idle opens a composer (bottom sheet on mobile, card on desktop) with a description field, **autocomplete** (past entry descriptions - which pre-fill their last project - plus matching open tasks), and a project picker. Start tracks it with **no phantom Inbox task**. Running shows the entry label, project dot, live clock, and Stop; tapping the label edits the running entry in place.
- A per-task **timer control** (play/stop) still appears on each task row.
- A **timeline view** (`/time`) renders a Toggl-style hour grid (defaults to Day). Blocks are project-colored, labelled by task title or description. Click an empty slot to log a past entry; click a block to edit it - the add/edit form is a bottom sheet on mobile / centered modal on desktop, with description + optional task + project + start/end (a **radial clock-dial** time picker), and clicking away saves. Click the **running block** to fix its start/description/project ("Set start to last stop" chains it to the previous entry).
- **Tidy-on-stop:** an entry under 2.5 min is discarded (accidental tap); a kept entry has both edges snapped to the nearest 5 min, so the calendar stays clean and contiguous. The grid renders on **5-minute boxes** so short entries always fit, and colliding blocks push down rather than overlap.
- A per-activity totals breakdown shows below the grid; the running timer + timeline poll so devices stay in sync (~15 s).
- Time entries are never merged automatically - the user has full control over the log.

**Journaling** (v3.0, #79)
- A **Journal** section (`/journal`) holds one structured note per day, built from three fixed templates: **Daily** (check-ins, What's going on, Mind dump, Projects today, Today's plan, Front/Back of mind, Daily review, Evening review, Journal), **Gratitude**, and **Affirmations** (a daily list, meant to be revisited at the evening close to celebrate wins). Templates are code-defined; there is no template editor.
- Entries are **structured data rendered to markdown**, never stored as markdown. Preview mode and the export download both show the same backend-rendered, Obsidian-compatible note. Export = one day as `.md` or all days as a zip; sync to a vault is a later phase, Tasklog stays the source of truth.
- **Mood check-ins** are timestamped moments (several per day). Logging opens a **drill-down feelings wheel** (v3.1, #85): one level fills the whole circle at a time - seven cores, then a tapped feeling's finer shades - because the right word may not land at first. Every feeling below the cores carries a short **differentiating gloss** under its name ("infuriated: boiled over, seeing red" vs "annoyed: small irritation, still in control"); the center shows the word you're standing on with its meaning, and tapping the center (or a deepest slice) **picks the word, logs it, and resets the wheel to the cores** for the next feeling. Own words always allowed. The **Map of Consciousness score is derived from the picked feelings, never self-tagged**; an **info button beside the score opens a reference ladder** (log-scaled, major anchors labeled, courage line marked, current position shown) captioned "a lens, not a measurement" - the scale is a personal ordinal lens, not a validated instrument. The rail shows the day as a "mood arc" chart colored by MoC band with the courage-200 reference line. Emotion shift and energy-at-EOD are derived from the first and last check-ins, never typed.
- **Plan items open their task** (v3.1, #85): tapping a task title in Today's Plan or the Unplanned bucket opens the full task detail (due, priority, project, labels, subtasks, comments) right in the journal, chaining to the edit sheet - the payoff of plan items being real task references.
- **Today's plan references real tasks** - a combobox searches open tasks; creating is always an explicit "+ Create task" row (born due-today, Inbox). Rolled-over state comes from live task data. An **"Unplanned, got done"** bucket is derived automatically: tasks completed that day that were never planned.
- **Front of mind / Back of mind** are transient rail lists meant to be **cleared by the end of day**; anything uncleared resurfaces tomorrow as a "rolled over - keep?" candidate that must be consciously re-adopted.
- Empty sections stay quietly collapsed ("earned depth only" - the Journal section is not prompted for daily). After 6pm, opening today's journal lands on the evening cluster - the evening close is designed to be the cheapest ritual of the day.
- The **"Today so far"** widget shows a **Client/Project time breakdown** of the day's tracked time (v3.2.0/#86) - proportion bars beside the single total - so task and non-task time unite in the day's actuals. The plan stays intent-only (tasks/habits); actuals live here.
- The journal page carries its **own scoped visual identity** (fog paper / plum accent / serif prose voice, with a soft dark mode) via `--color-j-*` tokens; the rest of the app is unchanged. Journal prose is bilingual-friendly (Hinglish + Devanagari fall through to system fonts).
- **Sensitivity note:** journal prose and mood history are the most sensitive data the app holds. They stay LAN-only; the MCP surface does NOT expose journal endpoints yet, and minimal auth (v3.1) is planned before it ever does.
- **The day page was redone in v4.1 (#92)** around the companion: a **morning brief** (last night's sleep + yesterday's rollovers), derived **day tiles**, a structured **expenses section** (split chips + daily total), **note popups**, **mind verdicts** (each front/back-of-mind item closes, rolls over, or is let go), and **evening auto-lines** for what moved. Sage **weaves prose into sections** through a server-side merge, so talking to Sage and typing in the journal coexist without clobbering. Manual editing remains for no-talk days.

**Sage, the companion** (v4.0 #87; autonomous since v4.1 #92)
- A conversational companion on its own tab (`/companion`), with a warm scoped identity (`--color-c-*`, rose/cream - "a refuge, not a dashboard") and a name defined in one spec file (`persona.md`, paired with `meta.ts`).
- **The first law (v4.1): engage with the content first, capture invisibly.** Sage is a companion who happens to keep records, not a logger who happens to chat. He never announces "logged!" or "filed!" - he responds to what was SAID, and the writing happens quietly.
- **Sage acts, the human can undo** (v4.1 - the trust loop moved from pre-approval to post-hoc). Narration becomes real rows directly: tasks, moods (energy only when a number is said), thoughts, expenses with informal splits, notes, journal prose, time entries. Every write leaves a small receipt chip with one-tap undo. The v4.0 propose-then-Keep cards remain only as a fallback shape. Every autonomous write is also an audit row (the capture), so trust stays inspectable.
- **Honest time:** Sage starts, stops, backdates, and edits timers from narration. The **tape rule**: before backdating any boundary, Sage must consult the screen-activity tape (`check_screen`) - evidence over guessed times. Timers can never overlap (starts seal the previous entry; retro intervals trim what they cross).
- **Grounded, not naive:** before creating, Sage semantically searches open tasks (local Ollama embeddings; "the tax thing" matches "File the income tax return") and touches the existing row instead of duplicating. Projects are never invented without the user naming one.
- **Knows the day already:** each turn carries today's journal state, time entries, and expenses, plus the durable **profile notes** ledger (facts Sage has learned; stale ones retire, never delete) - so the user never re-explains their own day.
- **Time-aware:** each turn carries the current date/time, and each message carries an invisible timestamp marker on the model's copy only - so "first thing", "tonight", and returning after a 2h gap all read correctly. The user's stored words are never decorated.
- **One conversation per day** (the daily-note rhythm), with a history calendar - dots on days you talked, past days read-only. The transcript saves BEFORE the AI runs and is append-only; words are never lost to an AI failure or a second device.
- Runs on the user's own Claude subscription (Claude Agent SDK), gated by `COMPANION_ENABLED=1` per host. The provider is a seam: an API-key or local-model implementation can replace Claude Code later without changing the product.
- **Deferred by design**: freeform long-form notes authored by Sage (memoirs, event writeups), backdated task completion, recall over history, richer facets. See `docs/ideas/living-profile.md` and `docs/ideas/design-principles-v4.md`.

**The tape** (v4.1, #92)
- A tiny per-machine agent (`watchman/`) samples the active window TITLE + idle state every 30s, spools locally, and ships to the server in idempotent batches (the spool absorbs server sleep; nothing leaves the LAN; titles only, never contents or keystrokes).
- Exists so time boundaries come from **evidence, not memory**: "the PC went idle at 22:05" beats a guessed "around 22:45". Sage reads coalesced segments via `check_screen`.
- v1 alerts: a desktop popup when an alertable pattern (YouTube) exceeds its minutes budget within a rolling window - "just a mirror, not a judgment". Future: more patterns, server-driven rules, site blocking.

**Projects tab & Profile tab** (v4.1, #92)
- `/projects` shows every project as a **home**, grouped by **life areas** (each area carries a *why*). A project home has a status (active / on-hold), an About, and a **Now** chapter - what it's about right now - whose past versions archive as dated history, never overwritten. **Goals** live on projects: a timespan tier (10Y..1M), a why, nudgeable progress (0-100), dated expectation revisions, and **the door** - the smallest next physical action.
- `/profile` is the mirror: **people as entities** (relation, who they are, contact rhythm, birthday, open threads, "next time bring up X") and the **profile notes** ledger Sage maintains. People are get-or-create by name; a later mention fills blanks but never overwrites what is known.
- Areas (v4.1) and Clients (v3.2) coexist for now: Clients group projects for time-tracking breakdowns (the Toggl concept); Areas group project homes by life meaning. Whether they merge is an open product question.

**Projects & Clients**
- Projects let the user categorize tasks (and time entries).
- **Clients** (v3.2.0/#86) are a grouping level *above* projects - a "life area" like Work, Family, Self (the user's Toggl "client" concept). A project optionally belongs to a client; both share the same Client -> Project tree used by tasks and time. Manage clients in a collapsible sidebar section (create/rename/recolor/delete). **Deleting a client keeps its projects** - they become Ungrouped - unlike deleting a project, which cascade-deletes its tasks.
- Assign a project to a client from the project's edit dialog. In the sidebar each project row shows its client, and projects can be **drag-reordered** (a manual order; Inbox and All Tasks stay pinned). Row edit/delete live in a "..." menu.
- Each project can have an optional **hex color** (set on create or rename). The color appears as a left border on timeline blocks and as a swatch in the sidebar and project edit modal.
- The sidebar shows All Tasks, Inbox, and each project as separate views.
- Tasks can be assigned to a project at creation, reassigned from the task detail page, or changed in the edit modal.
- Deleting a project also deletes all its tasks (cascade delete, always confirmed first).
- Project names (and color) can be updated after creation.

**Labels**
- Labels are user-created tags that can be applied to any task, regardless of project.
- A task can have multiple labels. Labels are global - not scoped to a project.
- Labels are created and managed from the Labels dashboard (sidebar nav link).
- Each label has a name and a color (one of 10 pre-defined VIBGYOR shades).
- Labels can be applied when creating a task or from the task detail page.
- Deleting a label removes it from all tasks but does not delete those tasks.

**Filtering**
- A filter panel is available in the task list header (three-dot button).
- Filters can be applied to any view: All Tasks, Inbox, or a specific project.
- Available filter dimensions: by label (OR logic), by project, by deadline (today / this week / overdue).
- Filters stack on top of the sidebar view selection.
- Active filters are indicated by a count badge on the filter button.

**Data**
- All data is stored locally in `backend/Tasklog.Api/TasklogDatabase.db`.
- Nothing is sent to external services.

**Interface**
- The app works on phone and desktop through the same codebase.
- Every action produces visible feedback.
- Errors are shown clearly rather than silently ignored.

**AI integration (v2.10+)**
- Tasklog is reachable from claude.ai via a Model Context Protocol custom connector.
- The Tasklog API is exposed as **45 MCP tools** across six families:
  - *Tasks (20)*: list (rich filters), get, find, create, update, delete, set-completion, assign-project, set-labels, add/list/delete comments, bulk complete/assign/deadline/priority, log/undo/list habit check-ins, get habits dashboard.
  - *Subtasks (6)*, *Labels (4)*.
  - *Projects (4)*: list, create/rename (optional hex color + `clientId`), delete.
  - *Clients (4, v3.2.0/#86)*: list, create, rename, delete (the grouping level above projects).
  - *Time tracking (7, v2.19.0; task-optional in v3.2.0/#86)*: start/stop/get-active timer and log/edit a closed interval - all accept an optional task + free-text description + project (so Claude can track task-free life too); delete; get time summary grouped by client/project for a date range.
- `list_tasks` accepts optional filters (project, inbox, labels, deadline range, creation-date range, completion, title substring, priority) plus sort + order + limit. `update_task` renames / reschedules / reprioritizes / sets recurrence without delete-and-recreate. `get_habits` returns per-habit streak, done-today, and weekly progress. `get_time_summary(from, to)` returns totals by client/project.
- The connector works on claude.ai web and mobile (Pro / Max plan).
- Connecting requires logging in with GitHub once; only the allow-listed username is permitted.
- All tool calls execute against the same SQLite database the web UI reads from. Tasks created via Claude appear instantly in the web UI on next refresh.
