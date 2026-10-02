# Tasklog Architecture

This document describes the current system structure.
It is the primary reference for any AI assistant or contributor working in this repo.

---

## System Overview

Tasklog is a three-process application as of v2.10. The backend, frontend, and MCP server
run as separate processes. They share no code; communication is HTTP.

```
Browser (LAN-only)
  │
  ├── GET http://localhost:3000        Next.js frontend (React, Tailwind)
  │     │
  │     └── fetch http://localhost:5115/api/...    .NET Web API (ASP.NET Core, EF Core)
  │                                                        │
  │                                                   SQLite database
  │                                               (TasklogDatabase.db)
  └── GET http://localhost:3000/tasks/[id]
        └── Server Component fetches from API on the server, returns rendered HTML

claude.ai (public, web + mobile)
  │
  └── HTTPS https://mcp-tasklog.manudubey.in/mcp
        │
        └── Cloudflare Tunnel  →  cloudflared (Termux)
                                       │
                                       └── localhost:5180  →  tasklog-mcp (Node, proot)
                                                                  │
                                                                  ├── OAuth 2.1 endpoints
                                                                  │   (/authorize, /token,
                                                                  │    /register, /.well-known/*)
                                                                  │   backed by mcp/data/auth.db
                                                                  │
                                                                  └── GET localhost:5115/api/...
                                                                      (Tasklog API, LAN-only)
```

The MCP server is the only public surface. The `/api` and frontend remain LAN-only.

---

## Repository Layout

```
Tasklog/
├── backend/
│   └── Tasklog.Api/               .NET Web API project
│       ├── Controllers/           HTTP endpoint handlers
│       ├── Data/                  EF Core DbContext
│       ├── Migrations/            EF Core schema migrations
│       ├── Models/                Data model classes
│       ├── Services/              Pure domain helpers (RecurrenceRule - parse/validate/advance RRULE + OccursOn schedule membership, v2.14.0/#73; HabitStreak - schedule-aware day streak from check-in dates, v2.16.0/#73; HabitFrequency - "x times a week" weekly count/streak/week-status, v2.18.0/#75; JournalMarkdown - render a day's journal to an Obsidian-compatible markdown note, v3.0/#79; JournalTemplates - code-defined journal template definitions upserted at startup, v3.0/#79) + EmbeddingService (v4.0/#87 - the first true DI service: Ollama embed calls, vector BLOB upserts, brute-force cosine + RankBySimilarity, bounded startup backfill; everything best-effort) + JournalSectionMerge (v4.1/#92 - per-section-kind merge of a partial journal update into the stored day; serialized process-wide + one retry, shared by the PATCH sections endpoint and the capture weave writer)
│       ├── Properties/            Launch settings (ports)
│       ├── Program.cs             App startup and service registration
│       ├── appsettings.json       Config (connection string, logging)
│       └── TasklogDatabase.db     SQLite data file
│
├── mcp/                           Node/TypeScript MCP server (v2.10+)
│   ├── package.json               Dependencies, build/test scripts
│   ├── tsconfig.json              strict, NodeNext, target ES2022
│   ├── src/
│   │   ├── server.ts              Hono HTTP entry, middleware wiring
│   │   ├── config.ts              Env var loading + production validation
│   │   ├── api-client.ts          Typed client for the Tasklog .NET API
│   │   ├── tools/                 29 MCP tools wrapping every API endpoint
│   │   │   ├── tasks.ts           18 task tools (list[+filters]/get/create/update/
│   │   │   │                      delete/set-completion/assign-project/set-labels/
│   │   │   │                      add-comment/list-comments/delete-comment +
│   │   │   │                      log-habit-checkin/undo-habit-checkin/get-habit-checkins/get-habits +
│   │   │   │                      bulk-set-completion/bulk-assign-to-project/bulk-set-deadline/bulk-set-priority)
│   │   │   ├── projects.ts        4 project tools (create/rename accept optional color)
│   │   │   ├── labels.ts          4 label tools
│   │   │   ├── time.ts            7 time tools (start/stop/active/log/edit/delete/summary) (v2.19.0)
│   │   │   ├── registry.ts        Aggregates and registers all tools
│   │   │   └── result.ts          runTool() helper for error mapping
│   │   └── oauth/                 OAuth 2.1 authorization server
│   │       ├── store.ts           SQLite-backed: clients/codes/access/refresh
│   │       ├── crypto.ts          opaqueToken(), pkceVerify()
│   │       ├── crypto.test.ts     node:test unit tests for crypto layer
│   │       ├── well-known.ts      RFC 9728 + RFC 8414 discovery endpoints
│   │       ├── register.ts        RFC 7591 Dynamic Client Registration
│   │       ├── authorize.ts       /authorize HTML page + signed flow cookie
│   │       ├── github.ts          GitHub OAuth upstream callback
│   │       ├── token.ts           /token (auth_code + refresh_token grants)
│   │       └── middleware.ts      Origin / Protocol-Version / Bearer auth
│   └── data/                      Runtime state (auth.db); gitignored
│
├── frontend/
│   └── src/
│       ├── app/                   Next.js App Router pages and layout
│       │   ├── layout.tsx         Root layout (header, fonts, body wrapper)
│       │   ├── page.tsx           Home route /
│       │   ├── globals.css        Tailwind import + font tokens
│       │   └── tasks/[id]/
│       │       └── page.tsx       Task detail route /tasks/:id
│       ├── components/            Reusable UI components
│       │   ├── ProjectLayout.tsx  Sidebar + task list wrapper, owns activeView (Client Component)
│       │   ├── ProjectSidebar.tsx Project navigation and management (Client Component)
│       │   ├── TasksClient.tsx    Task list + add form, filters by activeView (Client Component)
│       │   ├── AddTaskForm.tsx    Add task form with optional project dropdown (Client Component)
│       │   ├── AssignProjectButton.tsx  Project reassignment on detail page (Client Component)
│       │   ├── DeleteTaskButton.tsx  Delete action on detail page (Client Component)
│       │   ├── CompleteTaskButton.tsx  Complete/incomplete toggle on detail page (Client Component)
│       │   ├── EditTaskModal.tsx   Full task edit (title/deadline/project/labels), diff-and-fan-out save (Client Component, v2.10.2)
│       │   ├── DeadlinePopover.tsx Quick deadline preset picker on the deadline pill (Client Component, v2.10.2)
│       │   ├── BulkActionsBar.tsx  Sticky bulk-actions bar for multi-select mode (Client Component, v2.10.4)
│       │   ├── PriorityDot.tsx    Small colored priority dot (P1-P3) next to a task title (v2.10.5)
│       │   ├── RecurrencePicker.tsx  Recurrence builder (none/daily/weekly/monthly + nth-weekday/interval/Ends) on the add/edit forms; `isHabit` prop un-gates it with no deadline (v2.14.0+, #75)
│       │   ├── RecurringBadge.tsx Repeat glyph + human label for recurring tasks (v2.14.0)
│       │   ├── QuickAddInput.tsx  Quick-add title field: inline token highlight overlay + #/@/! autosuggest; Escape/tap un-recognizes a token (#73). v2.15.0+
│       │   ├── TaskSheet.tsx      Chip-driven create+edit sheet (modal/bottom-sheet); chips derived from the title, Escape-to-dismiss; replaces AddTaskForm+EditTaskModal (#73). For habits: Due chip hidden + the Schedule chip is a two-mode picker (specific days OR x-times-a-week stepper), saving recurrence XOR weeklyTarget (#75)
│       │   ├── BoardView/BoardCard.tsx  Board renderer: columns from groupTasksForBoard (lib/board.ts) + the rich card (#73)
│       │   ├── TaskDoneControl.tsx One done-control for list+card+board: complete checkbox, or a daily check-in toggle for a habit (habits are never completed) (#73)
│       │   ├── HabitsPanel.tsx    Right-side habits panel beside the task list, shares habit state with ProjectLayout (#73)
│       │   ├── HabitsClient.tsx   Full /habits view: fetch + poll habits, optimistic done-today toggle (Client Component, v2.16.0)
│       │   └── HabitCard.tsx      One habit: specific-days view (schedule label, day streak, 7-day dot row) OR frequency view (n/x this week, week streak, coloured recent-week strip) keyed on weeklyTarget; shared CheckInButton (v2.16.0/#73/#75)
│       │   ├── SubtaskChecklist.tsx  Inline tickable subtask circles clubbed under a parent (card + table sub-row + board), cap + "+N more" (#78)
│       │   ├── SubtaskSection.tsx  Full subtask editor (detail modal + /tasks/:id): add/tick/deadline/delete + @dnd-kit drag-reorder (#78)
│       │   ├── CompleteWithSubtasksDialog.tsx  Complete-all vs pull-out prompt when completing a parent with open subtasks (#78)
│       │   ├── NavTabs.tsx        Header section tabs Tasks / Time / Journal, active by pathname -
│       │   │                      the first cross-section nav available on every page (v3.0/#79)
│       │   ├── journal/           The /journal page (v3.0/#79): JournalClient (orchestrator: date,
│       │   │                      contents, debounced autosave), note sections (Checkins/Prose/
│       │   │                      Projects/Plan/Evening/List + shared SectionCard), rail widgets
│       │   │                      (Calendar, MoodArc, Mind x2, TodaySoFar), FeelingsWheelModal
│       │   │                      (drill-down wheel #85: one level per screen, pick logs +
│       │   │                      resets to cores, hints under names + in center, ⓘ opens
│       │   │                      MocLadder - log-scaled Hawkins reference with today marker),
│       │   │                      (3-ring SVG picker, derived MoC), JournalPreview (react-markdown)
│       │   ├── companion/         Sage, the v4.0 companion tab (#87): CompanionClient
│       │   │                      (orchestrator: daily session, NDJSON stream consumption,
│       │   │                      timeline merge, history browsing, acting lock),
│       │   │                      ProposalCard (keep/quick-edit/toss/restore),
│       │   │                      CardsPanel (rail/drawer triage), CompanionCalendar
│       │   │                      (c-token twin of the journal CalendarWidget),
│       │   │                      ReceiptChip (v4.1/#92: compact receipt for an autonomous
│       │   │                      write + one-tap undo; weaves say "edit in Journal")
│       │   │                      (v4.1 journal additions: DayTiles, MorningBrief,
│       │   │                      DailyExpensesSection, NotesTodaySection, Mind verdicts,
│       │   │                      Evening auto-lines - see the journal/ folder)
│       │   ├── projects/          The /projects tab (v4.1/#92): ProjectsClient (area-grouped
│       │   │                      project homes: status active/onhold, About, the Now chapter
│       │   │                      with append-only history, per-project expenses), GoalPopup
│       │   │                      (goal editor: timespan tier, why, progress nudge, dated
│       │   │                      expectation revisions, the door)
│       │   ├── profile/           The /profile tab (v4.1/#92): ProfileClient (persons with
│       │   │                      relation/rhythm/birthday/threads/next-time; profile notes
│       │   │                      ledger with retire)
│       │   (list is representative - other components: TaskCard, FilterPanel, LabelsClient, etc.)
│       └── lib/
│           ├── api.ts             Typed API call functions (used by both server and client)
│           ├── time.ts            Pure time-tracking geometry: PX_PER_MIN (3.6 = 5-min box, #86),
│           │                      daySegment(), layoutDay() (push-down so short blocks don't overlap),
│           │                      dayColumns(), dayTotalSeconds(), perActivityTotals(), perProjectTotals()
│           │                      (client/project breakdown), entryLabel(), clockLabel(), dateKey(), addDays() (v2.19.0; #86)
│           ├── quickAdd.ts        Pure parseQuickAdd(): NL title -> {deadline, recurrence, project, labels, priority} + token spans (chrono-node for dates; recurrence/tokens hand-rolled) (v2.15.0)
│           ├── deadlinePresets.ts Pure resolvePreset() for the quick-deadline popover (v2.10.2)
│           ├── journal.ts         Journal content shapes (per-section-kind contracts, mirrored by
│           │                      Services/JournalMarkdown.cs) + derived helpers: moodShift(),
│           │                      energyEod(), rolloverCandidates() (v3.0/#79)
│           ├── feelingsWheel.ts   Curated feelings-wheel dataset: 7 cores / 41 secondaries /
│           │                      (+ per-feeling differentiating `hint` glosses on all 130, #85)
│           │                      82 tertiaries, each with a Hawkins MoC level + deriveMoc()/
│           │                      mocBand(). Sourced in docs/research/feelings-wheel-moc.md (v3.0/#79)
│           └── companion/         The companion's AI layer (v4.0/#87):
│                                  provider.ts (CompanionProvider seam - messages+tools shape -
│                                  + ClaudeCodeProvider: per-turn Agent SDK query() with resume,
│                                  stale-cursor self-heal, streamed-text preservation),
│                                  persona.md (Sage's entire identity/rulebook - a reusable spec
│                                  that can double as claude.ai custom instructions; PAIRED with
│                                  meta.ts which gives the UI the name/greeting/chips)
│       (app/api/companion/chat/route.ts is the turn endpoint - see "Companion AI layer" below)
│
├── watchman/                      The tape's sensor (v4.1/#92): watchman.py - a tiny
│   │                              per-machine agent (X11: libXss idle + xdotool window title,
│   │                              30s poll) that spools samples locally and ships them to
│   │                              POST /api/activity/batch (idempotent; the spool absorbs
│   │                              server sleep). v1 alerts: notify-send popup when a pattern
│   │                              (YouTube) exceeds its minutes budget in a rolling window.
│   │                              Runs as a systemd user service (tasklog-watchman.service);
│   │                              config at ~/.config/tasklog-watchman/config.json
│
├── docs/
│   ├── architecture.md            This file
│   └── plans/                     Implementation plans from planning sessions
│
├── CLAUDE.md                      Instructions for AI assistants
├── LESSONS.md                     Session learnings log
├── UI-SPEC.md                     Design tokens and UX rules for v2 frontend
└── Readme.md                      Human-facing project overview
```

---

## Backend

**Runtime:** .NET 10 / ASP.NET Core Web API
**Database:** SQLite via Entity Framework Core 9
**Default ports:** HTTP `5115`, HTTPS `7243` (see `launchSettings.json`)

### Layers

```
HTTP request
    │
    ▼
Controllers              Tasks / Projects / Labels / Comments / CheckIns / Habits /
                         Subtasks / TimeEntries / Journal / MoodCheckins /
                         Captures / CompanionSessions / Search (v4.0/#87) /
                         Notes / Expenses / ProfileNotes / Areas / Goals / Persons /
                         Activity (v4.1/#92).
                         Handle routing, validation, HTTP response codes; no business
                         logic beyond input checking (pure helpers like RecurrenceRule
                         and HabitStreak live in Services/; EmbeddingService (v4.0) is
                         the first true DI service - needs HttpClient + DbContext;
                         JournalSectionMerge (v4.1) is the second).
    │
    ▼
TasklogDbContext         EF Core context. Direct DbSet access - no repository layer.
    │
    ▼
TasklogDatabase.db       SQLite file. Tables: Tasks, Projects, Clients, Labels, LabelTaskModel,
                         Comments, CheckIns, TimeEntries, Subtasks, JournalTemplates,
                         JournalEntries, MoodCheckins, CompanionSessions, Captures,
                         Embeddings (v4.0), Notes, Expenses, ProfileNotes, Areas, Goals,
                         Persons, ActivitySamples (v4.1).
```

### Data model

```
Projects
  Id          INTEGER  primary key, autoincrement
  Name        TEXT     not null
  Color       TEXT     nullable  ("#RRGGBB" hex string; null = no color. v2.19.0)
  ClientId    INTEGER  nullable  foreign key -> Clients.Id (null = Ungrouped. SET NULL on client delete. v3.2.0/#86)
  Position    INTEGER  not null  default 0  (manual sidebar order; max+1 on create, rewritten by /reorder. v3.2.0/#86)
  Status      TEXT     not null  default "active"  ("active" | "onhold" - the Projects tab groups by it. v4.1/#92)
  AreaId      INTEGER  nullable  foreign key -> Areas.Id (the project's life area; SET NULL on area delete. v4.1/#92)
  About       TEXT     nullable  (what this project IS - the home page blurb. v4.1/#92)
  NowText     TEXT     nullable  (the current "Now" chapter - what the project is about right now. v4.1/#92)
  NowHistoryJson TEXT  not null  default "[]"  (append-only past chapters as [{ at, text }] - setting a
                       new Now archives the old one; never edited in place. v4.1/#92)
  CreatedAt   TEXT     not null  (ISO 8601 datetime string)

Clients  (v3.2.0/#86 - the grouping level above Project; a "life area" like Work/Family/Self)
  Id          INTEGER  primary key, autoincrement
  Name        TEXT     not null
  Color       TEXT     nullable  ("#RRGGBB" hex; same convention as Project.Color)
  CreatedAt   TEXT     not null
  Deleting a client SET-NULLs its projects' ClientId (projects + their tasks survive, Ungrouped) -
  it does NOT cascade, unlike Project delete which cascades to its tasks.

Tasks
  Id          INTEGER  primary key, autoincrement
  Title       TEXT     not null
  Description TEXT     nullable  (optional free-text notes, <= 2000 chars; null = none) (v2.11.0)
  Deadline    TEXT     nullable  (ISO 8601 datetime. Midnight = date-only (due end of day); a non-midnight time = a specific moment. v2.12.0)
  CreatedAt   TEXT     not null  (ISO 8601 datetime string)
  IsCompleted INTEGER  not null  default 0  (boolean: 0 = pending, 1 = complete)
  CompletedAt TEXT     nullable  (ISO 8601 datetime string, set when marked complete, cleared on un-complete)
  ProjectId   INTEGER  nullable  foreign key -> Projects.Id (null = Inbox)
  Priority    INTEGER  not null  default 4  (Todoist P1-P4: 1=urgent .. 4=none; existing rows migrated to 4) (v2.10.5)
  Recurrence  TEXT     nullable  (RRULE-shaped rule; null = does not repeat. v2.14.0: daily/every-N/weekly-on-weekdays/monthly-on-day. v2.14.1 adds nth-weekday "BYDAY=3TH", last/from-end "BYMONTHDAY=-1", weekly/monthly INTERVAL>1, and end conditions UNTIL/COUNT)
  SeriesId    TEXT     nullable  (Guid linking all occurrences of a repeating task; null for one-offs) (v2.14.0)
  IsHabit     INTEGER  not null  default 0  (boolean: 1 = tracked as a daily habit. Existing rows migrate to 0 = false, the CLR zero, so NO HasDefaultValue is needed - contrast Priority's non-zero default) (v2.16.0)
  WeeklyTarget INTEGER nullable  ("x times a week" habit frequency, 1-7; null = not a frequency habit. A habit is scheduled on specific days (Recurrence) OR by a WeeklyTarget, never both - the controller clears one when the other is set. Nullable int -> existing rows migrate to null, no HasDefaultValue) (v2.18.0)

  (response-only) isRecurring  bool  Recurrence != null. NOT a column; [NotMapped] getter on TaskModel. (v2.14.0)
  (response-only) dueStatus  string  computed from Deadline vs now. A timed deadline goes
                  "overdue" once its instant passes; a midnight/date-only one stays "today"
                  all day then overdue next day. NOT a column. [NotMapped] getter on TaskModel,
                  derived from Deadline relative to DateTime.Today at serialization time.
                  One of: overdue / today / this_week (through upcoming Sunday) / later / none. (v2.10.3)

Labels
  Id          INTEGER  primary key, autoincrement
  Name        TEXT     not null
  ColorIndex  INTEGER  not null  (0-9, maps to VIBGYOR palette in frontend)
  CreatedAt   TEXT     not null  (ISO 8601 datetime string)

LabelTaskModel  (join table - implicit many-to-many)
  LabelsId    INTEGER  not null  foreign key -> Labels.Id  (cascade delete)
  TasksId     INTEGER  not null  foreign key -> Tasks.Id   (cascade delete)

Comments  (v2.13.0)
  Id          INTEGER  primary key, autoincrement
  Body        TEXT     not null  (free text, <= 2000 chars)
  CreatedAt   TEXT     not null  (ISO 8601 datetime string)
  TaskId      INTEGER  not null  foreign key -> Tasks.Id  (cascade delete)

Subtasks  (v2.20.0 - a task's checklist items, #78)
  Id          INTEGER  primary key, autoincrement
  Title       TEXT     not null  (<= 500 chars)
  IsCompleted INTEGER  not null  default 0  (boolean)
  Position    INTEGER  not null  (manual order within the parent; assigned max+1 on create)
  Deadline    TEXT     nullable  (ISO 8601 datetime; shown inline next to the subtask.
                       Midnight = date-only, mirroring Tasks.Deadline)
  CreatedAt   TEXT     not null  (ISO 8601 datetime string)
  TaskId      INTEGER  not null  foreign key -> Tasks.Id  (cascade delete; indexed)

  (task response fields, v2.20.0) subtaskCount / completedSubtaskCount  int  always present
                  (drive the "2/5" badge). subtasks[]  full rows, [NotMapped] nav - serialized
                  on GetById, and on GetAll only when includeSubtasks=true (the web loads them
                  to render the inline checklist; MCP's list_tasks gets counts only).

CheckIns  (v2.16.0 - one per habit per day)
  Id          INTEGER  primary key, autoincrement
  CheckInDate TEXT     not null  (date-only, local midnight - the day the habit was done)
  CreatedAt   TEXT     not null  (ISO 8601 datetime string)
  TaskId      INTEGER  not null  foreign key -> Tasks.Id  (cascade delete)
  UNIQUE (TaskId, CheckInDate)   (makes "done today" idempotent - one row per habit per day)

TimeEntries  (v2.19.0; decoupled from tasks in v3.2.0/#86 - one interval per start+stop cycle)
  Id          INTEGER  primary key, autoincrement
  TaskId      INTEGER  nullable  foreign key -> Tasks.Id (null = a task-free entry, e.g. "Sleep".
                       SET NULL on task delete - the interval survives. v3.2.0. Was NOT NULL/cascade)
  Description TEXT     nullable  (free-text label for the entry, e.g. "Rise and Shine"; <= 500. Null
                       for a task-linked entry that just uses the task title. v3.2.0)
  ProjectId   INTEGER  nullable  foreign key -> Projects.Id (the entry's OWN project - defaulted from
                       the task's project when started on one, but independently editable; null = Inbox.
                       SET NULL on project delete. v3.2.0)
  StartedAt   TEXT     not null  (local ISO datetime; no timezone suffix)
  EndedAt     TEXT     nullable  (null = currently running; set on stop or next-timer-start)
  CreatedAt   TEXT     not null  (ISO 8601 datetime string)
  (response-only) DurationSeconds  int  (EndedAt - StartedAt) in seconds; 0 while running. NOT a column.
  (response-only) TaskTitle  string   denormalized from Task.Title (""  when task-free). NOT a column.
  (response-only) ProjectColor / ClientId / ClientName / ClientColor  denormalized from the effective
                       project (the entry's own, else the linked task's) + its client. NOT columns.
  Single-timer invariant: at most one row has EndedAt == null at any time. POST /start auto-stops
  any running entry before opening the new one (StopAllRunning helper).
  On close (stop / auto-stop), tidy rules are applied to the STORED row (v3.2.0/#86): an entry under
  2.5 min is discarded (accidental tap); otherwise both edges snap to the nearest 5-min grid (so the
  calendar is contiguous - a shared transition rounds identically on both sides). Manual add/edit
  keep the user's exact times.

JournalTemplates  (v3.0/#79 - a journal note type: Daily, Gratitude, Affirmations)
  Id           INTEGER  primary key, autoincrement
  Key          TEXT     not null, UNIQUE ("daily" / "gratitude" / "affirmations")
  Name         TEXT     not null
  Periodicity  TEXT     not null ("daily"; leaves room for weekly later)
  SectionsJson TEXT     not null  (ordered section defs as a JSON array of
                        { key, title, kind, optional? }; kind: checkins / prose /
                        projects / plan / mind / evening / list. First JSON-as-TEXT
                        columns in the codebase - opaque to SQL by design.)
  SortOrder    INTEGER  not null  (display order)
  CreatedAt    TEXT     not null
  Definitions live in code (Services/JournalTemplates.cs) and are UPSERTED by Key at
  startup in Program.cs - editing a definition updates the row on next run, no migration.

JournalEntries  (v3.0/#79 - one template filled in for one calendar day)
  Id          INTEGER  primary key, autoincrement
  TemplateId  INTEGER  not null  foreign key -> JournalTemplates.Id (cascade delete)
  EntryDate   TEXT     not null  (date-only, local midnight - same convention as CheckIns)
  ContentJson TEXT     not null  (JSON object keyed by section key; value shape per
                       section kind - the client contract is frontend/src/lib/journal.ts
                       and the renderer mirror is Services/JournalMarkdown.cs)
  CreatedAt   TEXT     not null
  UpdatedAt   TEXT     not null
  UNIQUE (TemplateId, EntryDate)  (one note per template per day - the API upserts,
                       never duplicates)

MoodCheckins  (v3.0/#79 - timestamped mood check-ins, several per day)
  Id          INTEGER  primary key, autoincrement
  CheckinAt   TEXT     not null, indexed  (local ISO datetime, TimeEntry convention)
  WordsJson   TEXT     not null  (the user's mood words as a JSON string array)
  Energy      INTEGER  nullable  (0-10; null = not stated. Made nullable in v4.1/#92 - Sage logs
                       energy ONLY when the user says a number, never invents one)
  MocLevel    INTEGER  nullable  (Map of Consciousness level, DERIVED client-side from
                       feelings-wheel picks - never self-tagged; null = free words only)
  CreatedAt   TEXT     not null
  First table with no Task FK - mood belongs to the day, not to a task.

CompanionSessions  (v4.0/#87 - one Sage conversation per calendar day)
  Id          INTEGER  primary key, autoincrement
  SessionDate TEXT     not null, UNIQUE  (date-only, local midnight - one thread per day
                       is a DB guarantee; the API get-or-creates, and a create race on the
                       unique index is caught and returns the winner's row)
  MessagesJson TEXT    not null  (full transcript as a JSON array of { role, content, at };
                       APPEND-ONLY via POST .../{id}/messages so concurrent turns from two
                       devices interleave instead of clobbering. Caps: 8k chars/message,
                       2000 messages/day, ~1MB/day)
  SdkSessionId TEXT    nullable  (the Claude Agent SDK's session id; passed back as
                       `resume` each turn so per-request route handlers continue one
                       coherent conversation)
  CreatedAt / UpdatedAt TEXT not null

Captures  (v4.0/#87 - the staged-proposal inbox of the Living Profile; v4.1/#92 turns it
  into the AUDIT TRAIL of autonomous writes: POST with autoConfirm=true creates AND
  confirms transactionally, so the capture row IS the receipt and dismiss = undo)
  Id          INTEGER  primary key, autoincrement
  Type        TEXT     not null  (registry name; v4.0 wrote only "task" - the v4.1 registry
                       is task / mood / thought / note (journal weave) / expense / time)
  Status      TEXT     not null, indexed  ("proposed" -> "confirmed" | "dismissed";
                       restore flips dismissed back to proposed - user-only)
  Source      TEXT     not null  ("companion" today; anticipates mcp / claude.ai / manual)
  SessionId   INTEGER  nullable  FK -> CompanionSessions (SET NULL on session delete -
                       the audit row outlives its source), indexed
  PayloadJson TEXT     not null  (type-specific; for "task": { title, projectId?,
                       newProjectName?, deadline? } - paired contract with the route's zod
                       schemas and api.ts CaptureDto)
  Span        TEXT     nullable  (the user's words that triggered the proposal - shown on
                       the card so trust is inspectable)
  Confidence  REAL     nullable
  ConfirmedType TEXT / ConfirmedId INTEGER  nullable  (set on confirm: which typed home +
                       row id, e.g. "task"/123)
  CreatedAt / UpdatedAt TEXT not null
  Confirm is a transactional guarded claim on relational providers (two concurrent Keeps
  cannot both create a task); proposing a duplicate normalized title into the same session
  returns the existing row (dismissed stays dismissed - the model cannot resurrect a toss).
  v4.1 semantics: dismissing a CONFIRMED capture undoes it - the materialized row is deleted
  (task/mood/thought/note/expense/time), EXCEPT a journal weave, which refuses (prose already
  merged into the day's note is edited in the Journal, not deleted). Per-type payload caps:
  16384 chars for note/thought bodies, 4000 otherwise.

Notes  (v4.1/#92 - standalone notes; memories and wishes today, freeform kinds later)
  Id          INTEGER  primary key, autoincrement
  Title       TEXT     not null
  BodyMd      TEXT     not null  (markdown body, <= 16384)
  Kind        TEXT     not null  default "note"  (open vocabulary: "memory", "wish", ...)
  AboutJson   TEXT     not null  default "[]"  (free tags: people/places/topics)
  Source      TEXT     nullable  ("companion" when Sage wrote it)
  OriginDate  TEXT     nullable  (the day the note is ABOUT, not when it was written)
  CreatedAt / UpdatedAt TEXT not null

Expenses  (v4.1/#92 - money moments, first-class instead of prose)
  Id          INTEGER  primary key, autoincrement
  Amount      REAL     not null  (positive)
  Direction   TEXT     not null  default "out"  ("out" | "in")
  OccurredOn  TEXT     not null  (date-only - expenses belong to a day)
  Note        TEXT     not null  (what it was, e.g. "petrol", "swiggy dinner")
  SplitJson   TEXT     not null  default "{}"  (informal split chips, e.g. { "manish": 1369 })
  ProjectId   INTEGER  nullable  FK -> Projects.Id (SET NULL on delete; ties trip costs to
                       the trip project)
  CreatedAt / UpdatedAt TEXT not null

ProfileNotes  (v4.1/#92 - durable facts Sage learns about the user; injected into every turn)
  Id          INTEGER  primary key, autoincrement
  Text        TEXT     not null  (one fact, <= 500; POST dedupes by exact text)
  Kind        TEXT     not null  default "fact"  (fact / preference / pattern / boundary)
  SourceDate  TEXT     not null  (the day it was learned)
  Active      INTEGER  not null  default 1  (PATCH active=false retires a stale fact -
                       never deleted, the ledger keeps its history)
  CreatedAt / UpdatedAt TEXT not null

Areas  (v4.1/#92 - the life-area grouping ABOVE projects on the Projects tab; carries a why)
  Id          INTEGER  primary key, autoincrement
  Name        TEXT     not null  (POST get-or-creates by case-insensitive name)
  Why         TEXT     nullable  (why this area matters - shown under the header)
  Position    INTEGER  not null  (display order)
  CreatedAt / UpdatedAt TEXT not null
  Deleting an area SET-NULLs its projects' AreaId (projects survive, ungrouped).

Goals  (v4.1/#92 - a project's aim: rich enough to mean something, light enough to keep)
  Id          INTEGER  primary key, autoincrement
  ProjectId   INTEGER  not null  FK -> Projects.Id (cascade delete)
  Title       TEXT     not null
  Why         TEXT     nullable
  Timespan    TEXT     nullable  (tier: 10Y / 5Y / 3Y / 1Y / 6M / 3M / 1M)
  TargetDate  TEXT     nullable
  Progress    INTEGER  not null  default 0  (0-100, nudgeable; done forces 100)
  ExpectationsJson TEXT not null default "[]"  (dated expectation revisions [{ at, text }] -
                       appended on change, the history of what "success" meant)
  Door        TEXT     nullable  (the smallest next physical action, e.g. "5 minutes of
                       skill-gap research")
  Status      TEXT     not null  default "active"  (active / done / parked)
  CreatedAt / UpdatedAt TEXT not null

Persons  (v4.1/#92 - people as entities; the Profile tab's roster)
  Id          INTEGER  primary key, autoincrement
  Name        TEXT     not null  (POST get-or-creates by name; existing rows are
                       fill-blanks-only - a later mention never overwrites what is known)
  Relation    TEXT     nullable  (friend / family / colleague ...)
  WhoTheyAre  TEXT     nullable  (one-liner: who this person is to the user)
  RhythmDays  INTEGER  nullable  (desired contact cadence in days)
  LastContactAt TEXT   nullable
  Birthday    TEXT     nullable
  ThreadsJson TEXT     not null  default "[]"  (open threads with this person, replaced
                       wholesale on PATCH, e.g. "owes ~2,738")
  NextTime    TEXT     nullable  ("next time we talk, bring up X")
  CreatedAt / UpdatedAt TEXT not null

ActivitySamples  (v4.1/#92 - the tape: raw screen-activity samples shipped by watchman)
  Id          INTEGER  primary key, autoincrement (long - this table grows fastest)
  Ts          TEXT     not null  (sample time, machine-local)
  Machine     TEXT     not null  (short name like "pc"; <= 30)
  Win         TEXT     not null  (active window TITLE, <= 300; "" when idle - titles only,
                       never contents)
  IdleS       INTEGER  not null  (seconds since last input at sample time)
  State       TEXT     not null  ("active" | "idle")
  UNIQUE (Machine, Ts)  (batch insert skips existing pairs - reshipping is always safe)

Embeddings  (v4.0/#87 - generic per-entity semantic vectors)
  Id          INTEGER  primary key, autoincrement
  EntityType  TEXT     not null  ("task" today; people/notes later reuse the table)
  EntityId    INTEGER  not null
  Model       TEXT     not null  ("nomic-embed-text"; part of the unique key so a model
                       swap re-embeds into new rows)
  Vector      BLOB     not null  (float32[] little-endian; compared with brute-force
                       cosine in C# - deliberately NO native vector extension)
  UpdatedAt   TEXT     not null
  UNIQUE (EntityType, EntityId, Model). Rows are best-effort: written on task create /
  title change + a bounded startup backfill, all silently skipped when Ollama is absent.
```

### API endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/tasks` | Filtered/sorted task list. Filter params: `projectIds` (repeated key), `inbox`, `labelIds` (repeated key), `dueBefore`, `dueAfter`, `createdAfter`, `createdBefore`, `completed`, `text`, `priorities` (repeated key, P1-P4). Sort: `sort` (`created`/`deadline`/`priority`, default `created`) + `order` (`asc`/`desc`, default `desc`; deadline sorts nulls-last, priority asc = P1 first). `limit` caps to the first N after sorting (`<1` → 400). Arrays use repeated keys, not comma-separated. AND across dimensions, OR within id arrays. No params = all tasks, newest-first. `inbox=true` + `projectIds` → 400. `includeSubtasks=true` (v2.20.0, web-only) loads each task's `subtasks[]` so the web can render the inline checklist; MCP omits it so `list_tasks` stays lean (counts only). `completedOn=yyyy-MM-dd` (v3.0/#79) filters to tasks completed that calendar day - feeds the journal's derived "Unplanned, got done" bucket. |
| GET | `/api/tasks/{id}` | Single task by ID, including its `comments[]` (newest first) and `subtasks[]` (by Position). 404 if not found |
| GET | `/api/subtasks` | Global subtask search across all tasks (absolute route). Query: `text` (case-insensitive title substring), `completed`. Each match carries its parent `taskId` + `taskTitle`. Backs the MCP `find` tool so "I finished X" resolves without knowing the parent (v2.20.0) |
| GET | `/api/tasks/{taskId}/subtasks` | List a task's subtasks in manual order. 404 if task missing (v2.20.0) |
| POST | `/api/tasks/{taskId}/subtasks` | Add a subtask. Body: `{ title, deadline? }` (title <= 500). Position = max+1. 201; 400 bad title; 404 task missing (v2.20.0) |
| PATCH | `/api/tasks/{taskId}/subtasks/{id}` | Present-key update of `title`/`deadline`(null clears)/`isCompleted`. 404 if not under that task (v2.20.0) |
| DELETE | `/api/tasks/{taskId}/subtasks/{id}` | Delete a subtask under that task. 204; 404 if not found (v2.20.0) |
| POST | `/api/tasks/{taskId}/subtasks/reorder` | Rewrite Position from `{ orderedIds }` (must be a permutation of the task's subtask ids). 400 otherwise (v2.20.0) |
| GET | `/api/tasks/{taskId}/comments` | List a task's comments, newest first. 404 if task missing |
| POST | `/api/tasks/{taskId}/comments` | Add a comment. Body: `{ body }` (non-empty, <= 2000). 201 with the created comment; 400 bad body; 404 task missing |
| DELETE | `/api/tasks/{taskId}/comments/{id}` | Delete a comment under that task. 204; 404 if not found |
| POST | `/api/tasks` | Create task. Body: `{ title, deadline?, projectId?, priority?, description?, recurrence?, isHabit?, weeklyTarget? }`. priority is 1-4 (default 4 = none); description <= 2000 chars (blank → null); `recurrence` is an RRULE-shaped rule that stamps a SeriesId - it requires a deadline UNLESS the task `isHabit` (a habit schedules itself with no anchor, v2.18.0); `isHabit` defaults false; `weeklyTarget` (1-7) is the "x times a week" habit frequency (habits only, mutually exclusive with `recurrence` - 400 if both, if non-habit, or out of 1-7). 400 if out of range |
| PATCH | `/api/tasks/{id}` | Partial update of title, deadline, priority, description, recurrence, isHabit, and/or weeklyTarget. JSON body, present-key detection: omit=keep, `deadline: null`/`description: null`/blank/`recurrence: null`/`weeklyTarget: null`=clear, value=set. `isHabit` is processed first so the effective habit state gates the rest (turning it off keeps past check-ins but clears WeeklyTarget). Setting recurrence requires a deadline UNLESS the task is a habit (v2.18.0), assigns a SeriesId, and clears WeeklyTarget; clearing recurrence nulls Recurrence + SeriesId. Setting `weeklyTarget` (1-7, habits only) clears Recurrence + SeriesId. Recurrence and weeklyTarget are mutually exclusive - sending both string+number in one PATCH is 400. priority must be 1-4; description <= 2000. 400 on empty title / bad date / bad priority / too-long description / unsupported recurrence / non-boolean isHabit / weeklyTarget out of 1-7 or on a non-habit. Returns the updated task |
| DELETE | `/api/tasks/{id}` | Delete task. 204 on success, 404 if not found |
| PATCH | `/api/tasks/{id}/complete` | Mark task complete or incomplete. Body: `{ isCompleted: bool }`. Returns the (completed) task. For a recurring task, completing it also spawns the next occurrence (deadline advanced per the rule; title/project/labels/priority/description/recurrence carried under the same SeriesId) and logs a completion comment on the finished one - UNLESS an end condition is reached (v2.14.1: UNTIL date passed or COUNT occurrences exist), in which case the series stops and a "series complete" comment is logged instead. COUNT is evaluated by counting rows with the same SeriesId. Bulk-complete does not spawn. Body may include `subtaskMode` (v2.20.0): when completing a parent with open subtasks, `"completeAll"` (default) ticks them all, `"pullOut"` graduates each open subtask into a standalone task in the parent's project (with a back-reference comment) and detaches it. A recurring occurrence spawns the next one with the subtask checklist reset to unchecked (title + order carried, deadlines dropped) |
| PATCH | `/api/tasks/{id}/project` | Reassign task to a project or Inbox. Body: `{ projectId: int?, projectName?: string }`. projectName is resolved by name (case-insensitive, exact) and wins over projectId; 0/multiple matches → 400 |
| POST | `/api/tasks/bulk` | Apply one operation to many tasks in one transaction. Body: `{ operation: "complete" \| "assignProject" \| "setDeadline" \| "setPriority", taskIds: int[], data?: { isCompleted?, projectId?, projectName?, deadline?, priority? } }`. assignProject accepts a project name (resolved, wins over id). No bulk delete. Unknown ids skipped; returns the affected tasks. 400 on empty ids / unknown op / invalid data (missing/ambiguous project name, priority out of 1-4) |
| GET | `/api/projects` | All projects in sidebar order (`Position` asc, name breaking ties), each with its `client` (v3.2.0) and `area` (v4.1) |
| POST | `/api/projects` | Create project. Body: `{ name, color?, clientId?, areaId?, newAreaName? }` (`color` = `#RRGGBB` hex; `clientId` groups under a client; `newAreaName` get-or-creates an area by name - the composer's create-on-type, v4.1/#92). Assigns `Position` = max+1. Returns created project (v2.19.0 color; v3.2.0 clientId+position) |
| PATCH | `/api/projects/{id}` | Present-key update of `name` / `color` / `clientId` / `areaId` / `status` (`active`\|`onhold`) / `about` / `now` (JsonElement, like tasks): omit=keep, null=clear. Setting a different `now` archives the old NowText into NowHistoryJson as a dated chapter - append-only (v4.1/#92). Returns updated project w/ client + area (v3.2.0/#86) |
| POST | `/api/projects/reorder` | Rewrite `Position` from `{ orderedIds }` (must be a permutation of all project ids). Returns the reordered list. 400 otherwise (v3.2.0/#86) |
| DELETE | `/api/projects/{id}` | Delete project + cascade delete its tasks. Time entries that referenced it are SET NULL (kept), not deleted. 204 on success |
| GET | `/api/clients` | All clients, ordered by name (v3.2.0/#86) |
| POST | `/api/clients` | Create client. Body: `{ name, color? }`. Returns created client (v3.2.0/#86) |
| PATCH | `/api/clients/{id}` | Rename/recolor. Body: `{ name, color? }` (color omitted = unchanged). Returns updated client (v3.2.0/#86) |
| DELETE | `/api/clients/{id}` | Delete client; its projects survive with `ClientId` set null (Ungrouped). 204; 404 if missing (v3.2.0/#86) |
| GET | `/api/time-entries` | Time entries overlapping `[from, to)` window. Query: `from` + `to` (local ISO datetimes, no zone). Defaults to today. Max 366-day range. Entries started before `from` but still running at `from` are included. (v2.19.0) |
| GET | `/api/time-entries/active` | Currently running entry, or 204 No Content when idle. (v2.19.0) |
| POST | `/api/time-entries/start` | Start a timer. Body: `{ taskId?, description?, projectId? }` - all optional (v3.2.0): a task-free entry needs only a description; project defaults from the task when started on one. Auto-stops any running entry first. 404 if a supplied task/project id is missing. (v2.19.0/#86) |
| POST | `/api/time-entries/{id}/stop` | Stop a running entry. Applies the on-close tidy rules (discard <2.5min / snap edges to 5-min grid, v3.2.0). Idempotent: an already-stopped entry is returned unchanged. (v2.19.0/#86) |
| POST | `/api/time-entries` | Manually log a closed interval. Body: `{ startedAt, endedAt, taskId?, description?, projectId? }` (local ISO). Task/desc/project optional (v3.2.0). 400 if end <= start or end > now+5min. Manual entries are NOT auto-snapped. A retro interval TRIMS any running timer it overlaps (v4.1/#92): logging "sleep 00:50-06:00" while a dinner timer is still open stops that timer at 00:50 - timers never overlap. (v2.19.0/#86) |
| PATCH | `/api/time-entries/{id}` | Present-key edit of `startedAt` / `endedAt` / `description` / `projectId` / `taskId` (null clears/unlinks). 400 if end <= start when closed. (v2.19.0/#86) |
| DELETE | `/api/time-entries/{id}` | Delete a logged entry. 204 on success. (v2.19.0) |
| GET | `/api/time-entries/suggestions` | Autocomplete: distinct recent entry descriptions matching `?text=` (case-insensitive), each with its most-recent `projectId`. `?limit=` (default 8), bounded to the last 500 entries. (v3.2.0/#86) |
| GET | `/api/labels` | All labels, ordered by name |
| POST | `/api/labels` | Create label. Body: `{ name, colorIndex }`. Returns created label |
| PATCH | `/api/labels/{id}` | Update label name and/or color. Body: `{ name, colorIndex }`. Returns updated label |
| DELETE | `/api/labels/{id}` | Delete label. Unlinks from all tasks (does not delete tasks). 204 on success |
| PATCH | `/api/tasks/{id}/labels` | Replace task's label set. Body: `{ labelIds?: int[], labelNames?: string[] }`. labelNames is resolved by name and wins over labelIds; 0/multiple matches → 400. Empty/absent both clear. Returns updated task |
| GET | `/api/journal/templates` | All journal templates in display order, section definitions parsed (v3.0/#79) |
| GET | `/api/journal/entries?date=` | The day's entries across all templates (empty array = blank day; reads never auto-create). Default today (v3.0/#79) |
| GET | `/api/journal/entries/dates?from=&to=` | Days in the range having at least one entry - the calendar's dots. Max 400 days; defaults to the current month (v3.0/#79) |
| PUT | `/api/journal/entries/{templateKey}/{date}` | Upsert the day's note for a template. Body: `{ content: { ... } }` (JSON object keyed by section key). 200 with the stored entry; 404 unknown template; 400 non-object content. Never duplicates (unique index) (v3.0/#79) |
| PATCH | `/api/journal/entries/{templateKey}/{date}/sections` | MERGE partial sections into the stored day (v4.1/#92) - the writer-weave path. Body: `{ sections: { key: value } }`. Per-kind semantics via JournalSectionMerge: prose appends with a blank line, mind/list append items, evening shallow-merges keys, plan/projects replace; checkins are rejected (they have their own endpoint). Serialized process-wide + one retry so concurrent weaves and autosaves never lose sections |
| GET | `/api/journal/export?date=` | The day's full note (all templates) rendered to markdown, as a `yyyy-MM-dd.md` download. The preview pane fetches this same output (v3.0/#79) |
| GET | `/api/journal/export/all` | Every entry day as one `.md` each, zipped (`journal-export.zip`) (v3.0/#79) |
| GET | `/api/mood-checkins?date=` | That day's mood check-ins, oldest first (the arc reads left to right). Default today (v3.0/#79) |
| POST | `/api/mood-checkins` | Log a check-in. Body: `{ words: string[], energy: 0-10, mocLevel?, checkinAt? }` (checkinAt defaults to now; mocLevel 20-1000). 400 on empty words / out-of-range values (v3.0/#79) |
| DELETE | `/api/mood-checkins/{id}` | Remove a mistaken check-in. 204; 404 if not found (v3.0/#79) |
| GET | `/api/tasks/{taskId}/checkins` | List a habit's check-in dates, newest first. 404 if task missing (v2.16.0) |
| POST | `/api/tasks/{taskId}/checkins` | Log a check-in. Body: `{ date? }` (default today, reduced to date-only). Idempotent: existing day → 200 with that check-in; new day → 201. 404 if task missing (v2.16.0) |
| DELETE | `/api/tasks/{taskId}/checkins` | Undo a check-in. Query `?date=yyyy-MM-dd` (default today). 204 on success; 404 if there was no check-in that day (v2.16.0) |
| GET | `/api/captures?sessionId=&status=` | Filtered capture list, oldest first (the session's cards) (v4.0/#87) |
| GET | `/api/captures/{id}` | Single capture (201-Created Location target) (v4.0) |
| POST | `/api/captures` | Create a capture. Body: `{ type, payload, sessionId?, span?, confidence?, source?, autoConfirm? }`. `autoConfirm: true` (v4.1/#92 - Sage's autonomous writers) creates AND confirms in one transaction, returning the receipt row with `confirmedType`/`confirmedId`. Types: task / mood / thought / note (weave) / expense / time, each payload validated per-type. Per-session dedupe by normalized title returns the existing row (any status). Caps on payload/span/source/title (v4.0) |
| PATCH | `/api/captures/{id}` | Edit a proposed capture's payload (quick-edit / update_capture). `sessionId` in the body (the companion always sends it) scopes the edit to that conversation; resolved captures are immutable (v4.0) |
| POST | `/api/captures/{id}/confirm` | KEEP: materializes the typed home (task -> Tasks row; `newProjectName` get-or-creates the project in the same transaction), records ConfirmedType/Id. Idempotent; guarded claim under concurrency (v4.0) |
| POST | `/api/captures/{id}/dismiss` | TOSS a proposed capture, or (v4.1) UNDO a confirmed one: deletes the materialized row per its type (a running/created time entry, mood, note, expense...). A journal weave refuses (409) - merged prose is edited in the Journal instead. Idempotent (v4.0) |
| POST | `/api/captures/{id}/restore` | Undo an accidental toss: dismissed -> proposed. User-only (the companion has no restore tool) (v4.0) |
| GET | `/api/companion/sessions/today` | Today's session or 204 (reads never auto-create) (v4.0) |
| GET | `/api/companion/sessions?date=` | That day's session (history view) or 204 (v4.0) |
| GET | `/api/companion/sessions/dates?from=&to=` | Days having a conversation - the history calendar's dots (journal entries/dates twin; 400-day cap) (v4.0) |
| POST | `/api/companion/sessions` | Get-or-create TODAY's session (idempotent; unique-date race returns the winner) (v4.0) |
| PUT | `/api/companion/sessions/{id}` | Replace the transcript + present-key `sdkSessionId` (validated shape + caps) (v4.0) |
| POST | `/api/companion/sessions/{id}/messages` | APPEND messages (+ present-key sdkSessionId) - the route's save path; concurrency-safe vs whole-array PUT (v4.0) |
| POST | `/api/search/tasks` | Semantic search over OPEN tasks: `{ query, limit? (1-25) }` -> scored top-k. Embeds the query via Ollama + brute-force cosine over stored vectors; merges keyword hits for open tasks lacking vectors; falls back to keyword LIKE entirely when Ollama is unreachable (`matchedBy` says which) (v4.0) |
| GET | `/api/notes?kind=&date=` | Notes, newest first, optionally filtered by kind and/or origin date (v4.1/#92) |
| GET | `/api/notes/{id}` | Single note (v4.1) |
| POST | `/api/notes` | Create a note. Body: `{ title, bodyMd, kind?, about?, source?, originDate? }` (v4.1) |
| PATCH | `/api/notes/{id}` | Present-key update of title/bodyMd/kind/about/originDate (v4.1) |
| DELETE | `/api/notes/{id}` | Delete a note. 204 (v4.1) |
| GET | `/api/expenses?from=&to=&projectId=` | Expenses in a date range (default today) and/or for one project, newest first (v4.1/#92) |
| POST | `/api/expenses` | Log an expense. Body: `{ amount, direction?, occurredOn?, note, split?, projectId? }` (v4.1) |
| PATCH | `/api/expenses/{id}` | Update an expense (hand-edit surface - amounts are correctable, per pin 17) (v4.1) |
| DELETE | `/api/expenses/{id}` | Delete an expense. 204 (v4.1) |
| GET | `/api/profile-notes?all=` | Active profile notes (all=true includes retired), oldest first - the injection order (v4.1/#92) |
| POST | `/api/profile-notes` | Record a learned fact. Body: `{ text, kind?, sourceDate? }`. Exact-text dedupe returns the existing row (v4.1) |
| PATCH | `/api/profile-notes/{id}` | Edit text/kind, or `active: false` to RETIRE a stale fact (never deleted) (v4.1) |
| GET | `/api/areas` | All areas in position order, each with its project count (v4.1/#92) |
| POST | `/api/areas` | Get-or-create by case-insensitive name. Body: `{ name, why? }` (v4.1) |
| PATCH | `/api/areas/{id}` | Update name/why/position (v4.1) |
| DELETE | `/api/areas/{id}` | Delete an area; its projects survive ungrouped (AreaId SET NULL). 204 (v4.1) |
| GET | `/api/goals?projectId=` | Goals, optionally for one project, active first (v4.1/#92) |
| POST | `/api/goals` | Create a goal on a project. Body: `{ projectId, title, why?, timespan?, targetDate?, door? }` (v4.1) |
| PATCH | `/api/goals/{id}` | Update a goal: present-key fields; a changed `expectation` APPENDS a dated revision to ExpectationsJson; `progress` nudges 0-100; `status: done` forces progress 100 (v4.1) |
| DELETE | `/api/goals/{id}` | Delete a goal. 204 (v4.1) |
| GET | `/api/persons` | All persons, by name (v4.1/#92) |
| POST | `/api/persons` | Get-or-create by name; on an existing person, supplied fields fill BLANKS only (never overwrite). Body: `{ name, relation?, whoTheyAre?, rhythmDays?, lastContactAt?, birthday?, threads?, nextTime? }` (v4.1) |
| PATCH | `/api/persons/{id}` | Present-key update; `threads` replaces the array wholesale (v4.1) |
| DELETE | `/api/persons/{id}` | Delete a person. 204 (v4.1) |
| POST | `/api/activity/batch` | The tape's intake: `{ machine, samples: [{ ts, win?, idleS?, state? }] }` (<= 5000/batch). Idempotent - existing (machine, ts) pairs are skipped, so the watchman can reship after failures. Returns inserted/skipped counts (v4.1/#92) |
| GET | `/api/activity/segments?from=&to=&machine=` | The tape, coalesced server-side: consecutive same-state samples merge (gap <= 5min) into segments `{ from, to, minutes, state, topWindow }`, sub-2-minute noise dropped. Max 7-day range; default today. Sage's check_screen reads this (v4.1/#92) |
| GET | `/api/habits` | Habit dashboard: every task where `IsHabit`, each as `{ task, currentStreak, doneToday, recentCheckIns[], weeklyTarget, thisWeekCount, recentWeeks[] }` (last ~90 days of check-ins, newest-first). `currentStreak` is unit-aware: consecutive **days** for a specific-days/daily habit (grace through yesterday), consecutive **weeks** with >= 1 check-in for a frequency habit (`weeklyTarget != null`, v2.18.0). For frequency habits, `thisWeekCount` = days done this calendar week (Mon-Sun) and `recentWeeks[]` = the last 8 weeks `{ weekStart, count, status }` (status met/partial/none); these three fields are null for non-frequency habits. Ordered newest-created first (v2.16.0) |

### CORS

Enabled in Development mode only (`Program.cs`). Allows `http://localhost:3000`.
In production, a reverse proxy on the same host is assumed - no CORS needed.
**Known issue:** see GitHub issue #1 - LAN access currently breaks without this fix.

---

## Frontend

**Runtime:** Node.js / Next.js 16 (App Router)
**Styling:** Tailwind CSS v4
**Fonts:** Space Grotesk (headings), DM Sans (body) via `next/font/google`
**Default port:** `3000`

### Next.js App Router

Next.js uses file-based routing. Every `page.tsx` file maps to a URL.
Components are either Server Components (run on the server, no interactivity)
or Client Components (run in the browser, marked with `"use client"`).

```
src/app/
  layout.tsx           Server Component. Runs on every request.
                       Loads fonts, renders header, wraps all pages in <main>.

  page.tsx             Server Component. Route: /
                       Renders <ProjectLayout />.

  tasks/[id]/
    page.tsx           Server Component. Route: /tasks/:id
                       Fetches task and projects from API, renders detail card.
                       Returns 404 if task not found. Projects fallback to [] silently.

  labels/
    page.tsx           Server Component. Route: /labels. Renders <LabelsClient /> (client-fetched).

  habits/
    page.tsx           Server Component. Route: /habits. Renders <HabitsClient /> (client-fetched). (v2.16.0)

  time/
    page.tsx           Server Component. Route: /time. Renders <TimelineView /> wrapped in
                       TimeTrackingProvider. (v2.19.0)

  journal/
    page.tsx           Server Component. Route: /journal. Renders <JournalClient />
                       (client-fetched; owns date, entries, check-ins). (v3.0/#79)
```

`TimeTrackingContext` (v2.19.0; #86) - React context provider mounted at app root in `layout.tsx`.
Holds the single running `TimeEntry` (or null) and a `nowMs` that ticks at 1 s ONLY while active,
so elapsed seconds are live across TrackingBar, TimerControl, and TimelineView. Rehydrates from
`GET /api/time-entries/active` on mount AND polls it every 15 s (skipping while a local start/stop
is in flight) so a start/stop/edit on another device shows here (#86). Exposes `startEntry` (task/
description/project), `quickStart` (task-free), `updateActive` (edit the running entry) and
`refreshActive` (re-pull after the timeline edits the running start).

### Component responsibilities

```
ProjectLayout.tsx       Client Component.
                        - Owns activeView state ("all" | "inbox" | projectId)
                        - Fetches projects on mount
                        - Handles create/rename/delete project actions
                        - Shows error feedback banner for project operation failures
                        - Renders ProjectSidebar and TasksClient side by side
                        - On mobile: renders sidebar as a slide-in drawer

ProjectSidebar.tsx      Client Component.
                        - Renders "All Tasks", "Inbox", and project list
                        - Highlights the active selection
                        - Create project: inline input at the bottom
                        - Rename project: opens an Edit Project modal dialog
                        - Delete project: opens a confirmation dialog (warns about cascade)
                        - Delegates all data operations to ProjectLayout via callbacks

TasksClient.tsx         Client Component.
                        - Owns the task list state
                        - Fetches all tasks on mount (useEffect)
                        - Filters tasks client-side by activeView prop
                        - Handles add, delete, and completion operations
                        - Shows loading spinner, inline feedback messages
                        - Renders task table with AddTaskForm below
                        - Project column shown only in "all" view
                        - Toggle to show/hide completed tasks

AddTaskForm.tsx         Client Component.
                        - Owns title, deadline, and project dropdown state
                        - Project dropdown pre-selected to active project view
                        - Syncs dropdown when defaultProjectId prop changes
                        - Validates title not empty before calling parent's onAdd
                        - Shows inline field-level error messages

DeleteTaskButton.tsx    Client Component.
                        - Used only on the task detail page
                        - Calls DELETE API, then redirects to home on success
                        - Shows spinner during request, error on failure

CompleteTaskButton.tsx  Client Component.
                        - Used only on the task detail page
                        - Toggles IsCompleted via PATCH API, then calls router.refresh()
                        - Shows "Mark complete" or "Mark incomplete" based on current state
                        - Shows spinner during request, error on failure

AssignProjectButton.tsx Client Component.
                        - Used only on the task detail page
                        - Dropdown to reassign task to a project or Inbox
                        - Calls PATCH /api/tasks/{id}/project, then router.refresh()
                        - State only updates after API confirms (no optimistic update)

LabelChip.tsx           Client Component.
                        - Shared colored pill chip for label display
                        - Optional onRemove callback renders an × button
                        - Background color derived from label.colorIndex via labelColor()

AssignLabelsButton.tsx  Client Component.
                        - Used only on the task detail page
                        - Shows current labels as LabelChip components with remove buttons
                        - Select dropdown to add unassigned labels
                        - Calls PATCH /api/tasks/{id}/labels on each change, then router.refresh()

LabelsClient.tsx        Client Component.
                        - Used on the /labels page
                        - Full CRUD: fetch, create, inline rename, color picker, delete
                        - Desktop: table layout. Mobile: card list.

ColorPickerButton.tsx   Client Component. (v2.19.0 - replaces ColorPicker.tsx)
                        - Compact swatch button that opens a floating ProjectColorPicker popover
                        - Closes on Escape, outside-click, or palette selection
                        - Used by LabelsClient, ProjectSidebar, and TimelineView settings

LabelColorButton.tsx    Client Component. (v2.19.0)
                        - Same popover pattern but for colorIndex (0-9 label palette)
                        - Used by LabelsClient in table rows and mobile cards

TimelineView.tsx        Client Component. (v2.19.0; #86)
                        - Toggl-style vertical hour grid on a 5-min-box zoom (defaults to Day view)
                        - Entry blocks by start/duration, project-colored, labelled by task-or-description
                        - layoutDay() pushes colliding short blocks down instead of overlapping
                        - Add/edit is a bottom sheet (mobile) / centered modal (desktop) via EntryForm:
                          description + optional task + project + start/end; clicking the backdrop saves
                        - Click the running block to edit it (start/desc/project; "Set start to last stop")
                        - Polls the visible range; Inbox color picker; per-activity totals below the grid

TrackingBar.tsx         Client Component. (v2.19.0; #86)
                        - Persistent bar: idle launcher opens a composer (bottom sheet on mobile,
                          card on desktop) with description + merged autocomplete (past entries +
                          open tasks) + project picker; Start tracks a TASK-FREE entry (no phantom task)
                        - Running: entry label + project dot + live H:MM:SS + Stop; tap label to edit

RadialTimePicker.tsx    Client Component. (#86)
                        - Clock-dial 12h AM/PM time picker (tap hour ring, then 5-min ring), portaled;
                          replaces the native time input in the timeline edit sheet

TimerControl.tsx        Client Component. (v2.19.0)
                        - Per-task start/stop button on each task row
                        - Driven by TimeTrackingContext.isRunning(taskId)

FilterPanel.tsx         Client Component.
                        - Popover opened from the task list header three-dot button
                        - Filter sections: Labels (multi-select chips), Project (checkboxes), Date (radio)
                        - Apply and Clear buttons; draft state committed only on Apply
```

### API calls

All fetch calls go through `src/lib/api.ts`. This is the only place
that knows the API base URL and constructs request shapes.

```
getTasks()                GET /api/tasks                  Used by TasksClient (client-side)
getTask(id)               GET /api/tasks/:id              Used by tasks/[id]/page.tsx (server-side)
createTask()              POST /api/tasks                 Used by TasksClient via AddTaskForm callback
deleteTask(id)            DELETE /api/tasks/:id           Used by TasksClient and DeleteTaskButton
completeTask(id, bool)    PATCH /api/tasks/:id/complete   Used by TasksClient and CompleteTaskButton
assignTaskProject(id, pid) PATCH /api/tasks/:id/project   Used by AssignProjectButton
getProjects()             GET /api/projects               Used by ProjectLayout and tasks/[id]/page.tsx
createProject(name)       POST /api/projects              Used by ProjectLayout
renameProject(id, name)   PATCH /api/projects/:id         Used by ProjectLayout
deleteProject(id)         DELETE /api/projects/:id        Used by ProjectLayout
getHabits()               GET /api/habits                 Used by HabitsClient (v2.16.0)
addCheckIn(id, date?)     POST /api/tasks/:id/checkins    Used by HabitsClient (done-today toggle) (v2.16.0)
removeCheckIn(id, date?)  DELETE /api/tasks/:id/checkins  Used by HabitsClient (undo) (v2.16.0)
getTimeEntries(from, to)  GET /api/time-entries           Used by TimelineView (v2.19.0)
getActiveTimeEntry()      GET /api/time-entries/active    Used by TimeTrackingContext on mount (v2.19.0)
startTimer(taskId)        POST /api/time-entries/start    Used by TimeTrackingContext (v2.19.0)
stopTimer(id)             POST /api/time-entries/:id/stop Used by TimeTrackingContext (v2.19.0)
addTimeEntry(...)         POST /api/time-entries          Used by TimelineView (manual log) (v2.19.0)
updateTimeEntry(id, ...)  PATCH /api/time-entries/:id     Used by TimelineView (edit) (v2.19.0)
deleteTimeEntry(id)       DELETE /api/time-entries/:id    Used by TimelineView (delete) (v2.19.0)
getJournalTemplates()     GET /api/journal/templates      Used by JournalClient (v3.0)
getJournalEntries(date)   GET /api/journal/entries        Used by JournalClient (day + yesterday) (v3.0)
getJournalEntryDates(f,t) GET /api/journal/entries/dates  Used by JournalClient (calendar dots) (v3.0)
upsertJournalEntry(...)   PUT /api/journal/entries/:k/:d  Used by JournalClient (debounced autosave) (v3.0)
getMoodCheckins(date)     GET /api/mood-checkins          Used by JournalClient (v3.0)
addMoodCheckin(...)       POST /api/mood-checkins         Used by FeelingsWheelModal save (v3.0)
deleteMoodCheckin(id)     DELETE /api/mood-checkins/:id   Used by CheckinsSection (v3.0)
getJournalDayMarkdown(d)  GET /api/journal/export?date=   Used by JournalPreview (v3.0)
journalExportUrl(date?)   (URL builder)                   Header download link / zip-all (v3.0)
getTasksCompletedOn(d)    GET /api/tasks?completedOn=     Used by JournalClient (Unplanned bucket) (v3.0)
searchOpenTasks(text)     GET /api/tasks?text=&completed=false  Server-side type-ahead (currently unused - the plan combobox filters the loaded list locally) (v3.0)
```

**Known issue:** `getTask()` uses `NEXT_PUBLIC_API_URL` which resolves to `localhost`
from a server-side Node.js process. Breaks in production. See GitHub issue #1.

### Environment variables

```
NEXT_PUBLIC_API_URL     Base URL for API calls. Defined in frontend/.env.local.
                        Currently: http://localhost:5115
                        NEXT_PUBLIC_ prefix = available in both browser and server code.
API_URL                 Server-side base URL (private; used by SSR + the companion route).
                        Falls back to http://localhost:5115.
COMPANION_ENABLED       "1" enables the Sage chat route (v4.0). Runtime env, deliberately
                        NOT NEXT_PUBLIC_. Set on the PC (.env.local) and optionally the
                        phone service; absent on the public VM -> the route 404s.
```

Backend config (appsettings.json): `Ollama:Url` (default http://localhost:11434) - where
EmbeddingService reaches Ollama; hosts without Ollama simply never get vectors.

---

## MCP server (Node/TypeScript)

**Runtime:** Node.js 20+ via `tsx` in dev, compiled JS via `tsc` in production
**HTTP framework:** Hono with `@hono/node-server`
**MCP SDK:** `@modelcontextprotocol/sdk` (Streamable HTTP transport, stateful mode)
**OAuth:** hand-rolled, conforming to OAuth 2.1 + RFC 7591/7636/8414/8707/9728
**Default port:** `5180`
**Public URL (production):** `https://mcp-tasklog.manudubey.in` via Cloudflare Tunnel

### Endpoint surface

```
GET  /                                          health/identity JSON
POST /mcp                                       JSON-RPC (initialize, tools/*, etc.)
GET  /mcp                                       405 Method Not Allowed (we do not push)
GET  /.well-known/oauth-protected-resource      RFC 9728 metadata
GET  /.well-known/oauth-authorization-server    RFC 8414 metadata
POST /register                                  RFC 7591 Dynamic Client Registration
GET  /authorize                                 OAuth user-consent page (renders HTML)
GET  /auth/github/callback                      GitHub OAuth upstream callback
POST /token                                     auth_code and refresh_token grants
```

### Middleware on /mcp (applied in order)

| Middleware | Purpose | Failure response |
|---|---|---|
| `originMiddleware` | Origin header allow-list (claude.ai, localhost in dev) | 403 |
| `protocolVersionMiddleware` | `MCP-Protocol-Version: 2025-06-18` if present | 400 |
| `bearerAuthMiddleware` | Validate access token, check audience claim | 401 + RFC 9728 `WWW-Authenticate` |

### Tool layer

45 MCP tools across six families (tasks: 20, subtasks: 6, projects: 4, clients: 4, labels: 4, time: 7). The client family (v3.2.0/#86 - `list_clients`, `create_client`, `rename_client`, `delete_client`) wraps `/api/clients`; `create_project`/`rename_project` accept an optional `clientId`. The time family is now task-optional: `start_timer`/`log_time` take `taskId?` + `description?` + `projectId?` (task-free entries), `edit_time_entry` edits description/project/task, and `get_time_summary` groups by client/project. The subtask family (v2.20.0) - `add_subtask`, `list_subtasks`, `set_subtask_completion`, `update_subtask`, `delete_subtask`, `reorder_subtasks` - wraps the `/api/tasks/{taskId}/subtasks` sub-resource (registered from `tools/subtasks.ts`). The task family adds `find` (v2.20.0): a single by-name search over BOTH tasks and subtasks that returns each hit tagged `type: "task" | "subtask"` (subtasks carry `parentTaskId`/`parentTitle`), so the LLM resolves "I finished X" in one call without knowing whether X is a task or a checklist item; it merges `list_tasks(text)` with the `/api/subtasks` search. `list_tasks` stays for structured filtering (project/label/date/priority). The task family includes four bulk tools (`bulk_set_completion`, `bulk_assign_to_project`, `bulk_set_deadline`, `bulk_set_priority`) backed by the single `POST /api/tasks/bulk` endpoint; `add_task_comment`, `list_task_comments`, `delete_task_comment` (v2.19.0); `log_habit_checkin`, `undo_habit_checkin`, `get_habit_checkins` (v2.19.0); and `get_habits` (full habits dashboard with streak, done-today, weekly progress; v2.19.0). `assign_task_to_project` / `bulk_assign_to_project` / `set_task_labels` accept a name as an alternative to an id (resolved server-side). `create_task` and `update_task` accept an RRULE-shaped `recurrence` string (v2.14.0), an `isHabit` flag (v2.16.0), and a `weeklyTarget` (1-7) for "x times a week" habits (v2.18.0). `create_project` / `rename_project` accept an optional `color` hex (v2.19.0). The time family (v2.19.0) covers `start_timer`, `stop_timer`, `get_active_timer`, `log_time`, `edit_time_entry`, `delete_time_entry`, and `get_time_summary` (totals by task for a date range). Each tool is a thin wrapper around the corresponding Tasklog `/api` endpoint via `api-client.ts`. Input schemas use Zod and are inlined per tool. The `runTool()` helper in `result.ts` converts thrown `ApiError`s into MCP `isError: true` tool results (not JSON-RPC protocol errors), so the LLM can see and react to failures.

The `list_tasks` tool accepts an optional filter object (project, inbox, labels, deadline range, completion, title substring) that `api-client.ts` serializes into a query string on `GET /api/tasks`. Completion is a single `set_task_completion(id, isCompleted)` tool - the earlier `complete_task` / `uncomplete_task` split was consolidated in v2.10.1.

### OAuth data model

Separate SQLite file at `mcp/data/auth.db` (not the Tasklog DB). Four tables:

```
clients
  client_id      TEXT  primary key (opaque, generated by /register)
  client_name    TEXT
  redirect_uris  TEXT  JSON-encoded array
  created_at     INTEGER  unix epoch seconds

auth_codes
  code                  TEXT  primary key (one-use, consumed by /token)
  client_id             TEXT
  redirect_uri          TEXT
  code_challenge        TEXT  S256 base64url
  code_challenge_method TEXT
  scope                 TEXT
  resource              TEXT  RFC 8707 resource indicator
  github_user           TEXT  verified GitHub login
  expires_at            INTEGER

access_tokens
  token        TEXT  primary key (opaque, 32-byte hex)
  client_id    TEXT
  audience     TEXT  must match MCP_PUBLIC_URL on validation
  github_user  TEXT
  scope        TEXT
  expires_at   INTEGER  TTL 1h

refresh_tokens
  same shape as access_tokens, TTL 30d, rotated on every /token use
```

`consume()` queries on `auth_codes` and `refresh_tokens` are transactional read+delete so replay attacks fail.

### Authorization flow

```
claude.ai opens /authorize in browser
  -> we validate params, set signed flow cookie, render "Log in with GitHub"
  -> user clicks, goes to GitHub
  -> GitHub redirects to /auth/github/callback
  -> we exchange code with GitHub, fetch user identity
  -> we check login against ALLOWED_GH_USERS env var
  -> we mint our auth code, 302 to claude.ai's callback
claude.ai POSTs /token with code + PKCE verifier
  -> we verify PKCE, issue access + refresh tokens
claude.ai POSTs /mcp with Authorization: Bearer <access_token>
  -> middleware validates token + audience
  -> MCP transport handles tools/list, tools/call
```

See [docs/learnings/oauth-2-1-for-mcp.md](learnings/oauth-2-1-for-mcp.md) for the full mechanics, [docs/learnings/mcp-protocol.md](learnings/mcp-protocol.md) for what MCP itself is, and [guides/mcp-server-setup.md](../guides/mcp-server-setup.md) for the end-to-end setup walkthrough.

### Environment variables (read by config.ts)

| Var | Purpose | Required in prod |
|---|---|---|
| `PORT` | HTTP listen port (default 5180) | no |
| `TASKLOG_API_URL` | Where to reach the Tasklog API | no (default localhost:5115) |
| `MCP_PUBLIC_URL` | Canonical public URL; used as token audience | yes |
| `GITHUB_CLIENT_ID` | Upstream GitHub OAuth App | yes |
| `GITHUB_CLIENT_SECRET` | Same; secret | yes |
| `ALLOWED_GH_USERS` | Comma-separated GitHub login allow-list | yes |
| `SESSION_SECRET` | HMAC key for signed flow cookies | yes |
| `NODE_ENV` | `production` enables strict env validation | implicit |
| `AUTH_DB_PATH` | SQLite path (default data/auth.db) | no |

In production, `config.ts` throws on startup if any required var is missing or still at its dev default. Secrets live in `/root/.tasklog-mcp.env` (chmod 600) inside proot, sourced by the runit service script.

---

## Companion AI layer (v4.0/#87)

Sage is the first INBOUND LLM in the system (the MCP server is outbound - claude.ai calling
us). It lives in a Next.js API route, not the .NET backend (the Agent SDK is Node-only) and
not the MCP server (that is the public OAuth surface). The .NET API stays the system of
record; the route is a thin AI orchestrator over it.

```
Browser /companion tab
  │  POST /api/companion/chat { message }          (same-origin Next.js route)
  ▼
route.ts                                            gate: 404 unless COMPANION_ENABLED=1
  1. get-or-create today's CompanionSession (idempotent)
  2. APPEND the user's raw words to the transcript  ← save-first: words persist even
     (fails -> 502, turn never starts)                 if the AI never answers
  3. build the system prompt: persona.md (incl. the CONDUCT - content first, capture
     invisibly, never announce writes) + active PROFILE NOTES + live projects/clients +
     this session's ledger + TODAY's compact context (journal state, time entries,
     expenses - so Sage knows the day before the first word) + "Right now" date-time
  4. decorate the MODEL-facing copy only: <app_time now=".." since_last_message=".."/>
     (user text sanitized so pasted "<app_time" cannot impersonate the tag;
      the DB/UI always keep the raw words)
  5. ClaudeCodeProvider.runTurn: per-turn Agent SDK query() on the user's Claude
     subscription, resume: SdkSessionId (self-heals a stale cursor by rerunning fresh)
     - settingSources: [], custom system prompt (no CLAUDE.md, no coding persona)
     - tool cage (v4.1, hard-won - all four required): createSdkMcpServer with
       alwaysLoad: true (else tools defer behind ToolSearch and never load);
       options.tools: [] (disables ALL built-ins; a deny-list can't keep up with
       new built-in names); strictMcpConfig: true (else the logged-in CLI's
       claude.ai connectors leak into the session); allowedTools generated from
       the tool list (auto-approve - correct under autonomy) + canUseTool belt.
       Schema gotcha: zod v4 z.record() in ANY tool's schema silently drops the
       ENTIRE tool batch - open-shape fields use described z.any()
     - in-process tools (v4.1/#92 - Sage's HANDS, all autonomous via
       POST /api/captures autoConfirm; each returns a receipt):
         find_relevant_tasks  -> POST /api/search/tasks   (semantic grounding)
         log_task / log_mood / log_thought / log_expense  (typed writers; mood
           energy ONLY when the user says a number)
         log_time             (start / stop / manual / edit - narration to timers)
         weave_journal        (PATCH journal sections via the merge service)
         write_profile_note   (durable facts about the user)
         undo_capture         (dismiss = revert own writes when corrected)
         check_screen         (GET /api/activity/segments - the TAPE RULE:
           always consult before backdating a boundary)
  6. NDJSON stream to the browser: text_delta | receipt | card | done | error
     - done: assistant turn + new sdk cursor APPENDED before the event is sent
     - error: any streamed partial text is appended too (words are never lost)
     - consumer-gone: enqueue failures flip a `closed` flag; the loop keeps
       draining so the saves still run
  ▼
CompanionClient renders the stream; autonomous writes show as ReceiptChips (undo = the
captures dismiss endpoint). v4.0's Keep/Edit/Toss cards remain only as the fallback shape;
since v4.1 Sage writes directly - the trust loop moved from pre-approval to post-hoc undo.
```

Key properties: the transcript is append-only (two devices interleave, never clobber);
one session per day maps 1:1 to an SDK resume id; the provider seam (`CompanionProvider`,
messages+tools shape) is where an Anthropic-API/BYOK or local-model implementation slots in
later without touching the route. Semantic grounding is embeddings-shortlist + the model
judges: Ollama `nomic-embed-text` vectors stored once per task, brute-force cosine in C#.
The Agent SDK + zod are `serverExternalPackages` in next.config.ts (the SDK spawns a
native binary - it cannot be bundled). NOTE: a resumed SDK session retains the options it
was created with - after changing provider config, reset CompanionSessions.SdkSessionId
to force a fresh session or the old tool cage persists.

Deployment stance: PC/LAN-first. The route is INERT (404) without `COMPANION_ENABLED=1` in
the runtime env, so `deploy-oci.sh` cannot accidentally expose it on the public VM (which has
no app auth). Remaining public-exposure hardening is tracked in #88.

---

## How a request flows end to end

**Opening the home page:**
```
1. Browser requests http://localhost:3000/
2. Next.js renders layout.tsx + page.tsx on server (Server Components)
3. HTML shell sent to browser
4. Browser loads TasksClient.tsx JavaScript
5. TasksClient useEffect fires: GET http://localhost:5115/api/tasks
6. .NET queries SQLite, returns JSON array
7. React renders the task table
```

**Adding a task:**
```
1. User fills form and clicks "Add Task"
2. AddTaskForm validates input, calls onAdd() callback
3. TasksClient calls createTask() in api.ts
4. POST http://localhost:5115/api/tasks with JSON body
5. .NET inserts row in SQLite, returns new task JSON
6. TasksClient prepends task to local state
7. React re-renders the list - no page reload
```

**Viewing a task detail:**
```
1. Browser requests http://localhost:3000/tasks/42
2. Next.js runs tasks/[id]/page.tsx on the server
3. Server calls getTask(42): GET http://localhost:5115/api/tasks/42
4. .NET returns task JSON
5. Server renders HTML with task data
6. Browser receives complete HTML - no client-side fetch needed
```

**Asking Claude to create a task (post v2.10):**
```
1. User types in claude.ai mobile: "add task: review PR by Friday"
2. claude.ai sends prompt to its LLM, which decides to invoke our connector
3. claude.ai opens TLS connection to https://mcp-tasklog.manudubey.in/mcp
4. Cloudflare edge terminates TLS, forwards over the tunnel to phone:5180
5. tasklog-mcp middleware: Origin OK (claude.ai), Bearer token validated, audience matches
6. McpServer routes tools/call -> create_task handler
7. Handler POSTs http://localhost:5115/api/tasks (LAN-only call inside the phone)
8. Tasklog .NET API inserts row in SQLite, returns new task JSON
9. Handler wraps the result in a CallToolResult content block
10. Response flows back: phone -> tunnel -> Cloudflare edge -> claude.ai -> LLM -> user
```

---

## Known architectural limitations

These are tracked as GitHub issues:

| Issue | Description |
|-------|-------------|
| [#1](https://github.com/hydraInsurgent/Tasklog/issues/1) | CORS and server-side localhost URL break app outside dev |
| [#2](https://github.com/hydraInsurgent/Tasklog/issues/2) | Optimistic delete and feedback timer state bugs |
| [#3](https://github.com/hydraInsurgent/Tasklog/issues/3) | Fragile database path and silent API URL failure |

---

## What does not exist yet

These are planned but not built:

- Pagination
- Authentication
- Production deployment configuration
