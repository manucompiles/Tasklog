# P92 - The Companion Days (v4.1)

**Overall Progress:** `100%`

## TLDR
Sage gains typed capture writers (mood, thought, note, expense, time) flowing
through the existing Capture inbox trust loop, the journal becomes the center
of the product (server-side section merge, redesigned day page, evening close
ceremony), and the conduct rules from the dogfood keep the companion a
companion. Design gate: `docs/ideas/design-principles-v4.md`,
`docs/ideas/dogfood-findings.md`, `docs/ideas/mockups/projects-tab-mockup.html`
(17 pins). Stage A is buildable now; Stage B (Projects tab, people, Profile)
lands after the Sep 15-24 trip.

## Goal State
**Current State:** Captures support only `task`. Journal PUT replaces whole
content (race-prone). Mood requires energy. No expense, note, or person
entities. Sage can propose tasks only and confirms with visible bookkeeping.

**Goal State:** Any spoken sentence can become its typed thing through the
trust loop, invisibly; the day page reads as a story with derived tiles and an
evening close that moves items in place; the schema debt from the dogfood
(expense, notes-with-kind, optional energy, journal merge) is paid.

## Critical Decisions

- **D1: Sage is AUTONOMOUS - captures auto-confirm; the inbox becomes the
  receipt trail (user decision, 11 Sep night: "same thing minus the
  approval").**
  - Options: propose-then-approve cards (v4.0 model); direct writes with no
    record; direct writes THROUGH the capture pipeline, auto-confirmed.
  - Chosen: writers run the existing capture machinery end-to-end in one
    call (create + confirm transactionally) - entities land immediately in
    their real tables; the capture row survives as the audit/undo receipt.
    Existing dismiss/restore mechanics become UNDO (reverse the confirmed
    entity, mark the capture dismissed). Every Sage-written entity carries a
    receipt affordance in UI: click to edit / update / delete / undo.
  - Trade-off: wrong writes land in real tables - undo is the safety net;
    two dogfood days of act-then-correct showed this matches how he actually
    operates (corrections by talking, zero desire for gates). Task proposals
    from v4.0 switch to the same autonomous mode for consistency.
  - Payload JSON per type still validated; caps differ (note ~16KB vs 4KB).
- **D2: Journal gets a server-side section merge endpoint**
  (`PATCH /api/journal/entries/{templateKey}/{date}/sections`), merge
  semantics per section kind (prose appends with separator, mind appends
  items, expenses appends rows, plan replaces buckets). Kills the
  GET-merge-PUT race proven in the dogfood (11 occurrences in 2 days). The
  existing PUT stays for the tab editor.
- **D3: Thoughts are Notes.** New `Notes` table (Title, BodyMd, Kind:
  memory/idea/reflection/quote/wish/plain, AboutJson links, OriginDate).
  Verbatim original kept in the capture row (Span/payload), cleaned body in
  the note - the two-pass rule.
- **D4: Expenses are a real table** (Amount, Direction, OccurredOn, Note,
  SplitJson {with, share, settled}, ProjectId?), day-matched into the journal
  day render and rolled up per project. Not tasks, not comments (pin 10).
- **D5: MoodCheckin.Energy becomes nullable** - he says words, not numbers
  (dogfood finding). MocLevel already nullable.
- **D6: Conduct lives in persona.md** - one question per turn max, mornings
  open with statements, evening close narrates then walks verdicts, unsaid
  fields stay empty, register matching, and AUTONOMY over suggestion: Sage
  acts and leaves receipts instead of proposing (D1); it never remarks on the
  user's manual edits, which win silently. No new infra.
- **D7: Front/Back-of-mind verdicts extend MindItem** with an optional
  `verdict` field (closed/rolled/letgo); `cleared` stays for compatibility.
  Rolling copies to tomorrow (existing rollover mechanics reused).
- D8: Stage B entities (Project.Status + kind-from-client grouping, Areas
  with a why, Person) are separate migrations and steps - nothing in Stage A
  depends on them.
- GUIDELINES CHECK: first server-side merge endpoint (journal sections);
  Notes introduces the markdown-entity pattern; expenses introduce SplitJson.
  Product scope expansion is deliberate and gated by the two ideas docs.

## UI Specification
Design tokens and global rules per `../../UI-SPEC.md`. Feature-specific UI is
pinned in `../ideas/mockups/projects-tab-mockup.html` (pins 1-17) - the
mockup is the UI spec for this plan; no separate /ui-spec round needed.

## Tasks

### Stage A - before/through the trip

- [x] 🟩 **Step 1: Schema A migration** `[sequential]` → delivers: Notes +
  Expenses tables, nullable Energy, capture payload caps per type
  - [x] 🟩 Notes table + model (Kind enum as string, AboutJson)
  - [x] 🟩 Expenses table + model (SplitJson, ProjectId nullable FK)
  - [x] 🟩 MoodCheckin.Energy -> int? (+ frontend tolerance)
  - [x] 🟩 Migration, EnsureCreated parity, seed untouched

- [x] 🟩 **Step 2: Captures registry + writers** `[sequential]` → depends on: Step 1
  - [x] 🟩 RegisteredTypes += mood, thought, note, expense, time
  - [x] 🟩 Per-type payload validation + caps (note 16KB; others 4KB)
  - [x] 🟩 Auto-confirm writers (D1): one transactional create+confirm per
        type - mood->MoodCheckins, thought->Notes, expense->Expenses,
        time->TimeEntries (start/stop/manual/retro-edit), note->journal
        section merge (D2); task switches to autonomous too
  - [x] 🟩 Undo path: dismiss reverses the confirmed entity (per type)
  - [x] 🟩 ConfirmedType/ConfirmedId wiring + embedding upsert parity

- [x] 🟩 **Step 3: Journal section-merge endpoint** `[parallel]` → delivers:
  PATCH sections with per-kind merge semantics (usable by Step 2's note
  handler and the UI)
  - [x] 🟩 Merge semantics per kind (prose/mind/expenses/plan)
  - [x] 🟩 Concurrency: last-writer-per-section, 256KB cap preserved

- [x] 🟩 **Step 4: Sage tools + conduct** `[sequential]` → depends on: Step 2
  - [x] 🟩 Autonomous writer tools (log_task/mood/thought/expense/time, weave_journal, undo_capture) replace propose/update_capture
  - [x] 🟩 persona.md: the conduct (anti-Socrates rules, morning statement,
        evening ceremony, register matching, invisible receipts language ban)
  - [x] 🟩 Morning brief + evening What Moved / What Came Back derivations
        (todayContext ledger injection; page-side rendering in Step 5)
  - [x] 🟩 ProfileNotes store (Text, Kind, SourceDate, Active) + context
        injection: Sage's own note sheet - distilled at session close via a
        write_profile_note tool, loaded into every conversation; surfaced
        and correctable in the Stage B Profile tab (until then, by chat)

- [x] 🟩 **Step 5: Journal day page redo** `[UI]` `[sequential]` → depends on:
  Steps 2-3 (pin 16)
  - [x] 🟩 Derived DayTiles lead the page (existing main+rail layout kept - already the pin's shape; TodaySoFar widget is the rail)
  - [x] 🟩 MorningBrief (auto: sleep + rollovers), NotesTodaySection (destiny
        list, note popups per pin 14), DailyExpensesSection (rows + splits +
        total, optional-everything)
  - [x] 🟩 Evening close: MindWidget verdicts in place (closed/rolled/letgo,
        D7), EveningSection opens with auto What Moved / What Came Back
  - [x] 🟩 Receipt chips replace proposal cards (D1): ReceiptChip renders any
        non-task/confirmed capture as a compact "Sage did X" line with undo
        (dismiss-on-confirmed reverses the entity); legacy proposed task
        cards keep ProposalCard. Notes + Expenses got hand-edit CRUD APIs
        (pin 17).

- [x] 🟩 **Step 6: Stage A verification + tests** `[sequential]` → depends on: Steps 1-5
  - [x] 🟩 Writer round-trips against corpus samples (word-only mood, split expense day-matched to Sep 4, memory thought with about-links, retro time manual+edit, weave appends, undo per type, structural 400s)
  - [x] 🟩 Merge race test - FOUND and fixed a real lost-write bug (see Outcomes)
  - [x] 🟩 Deployed twice; live e2e: Sage autonomously created 'Pack sunscreen' into the Kerala project with the packing deadline, receipt streamed

### Stage B - pulled forward by user request (built 12 Sep)

- [x] 🟩 **Step 7: Schema B + Projects tab** `[sequential]` → depends on: Stage A
  - [x] 🟩 Project.Status + Area entity (get-or-create, why) + Goal entity
        (locked spec) + Project About/Now(+chapters); area-grouped sidebar;
        composer with datalist search-or-create area
  - [x] 🟩 Project home per pins 1-13 (About/Now hand-editable, chapters,
        pulse, goal popups with nudge/revisions/door, optional sections,
        on-hold + Revive)

- [x] 🟩 **Step 8: People + Profile tab** `[UI]` `[sequential]` → depends on: Step 7
  - [x] 🟩 Person entity (relation, who-they-are, rhythm, birthday slot,
        threads, next-time; get-or-create by mention), popup-first
  - [x] 🟩 Profile tab per pin 15: where-the-week-went (evidence v1), areas
        + whys, What Sage Knows with retire-X, people, memories, wishes

- [x] 🟩 **Step 9: Docs + ship prep** `[sequential]` → depends on: Step 8
  - [x] 🟩 /document sync, CHANGELOG v4.1.0, review round

## Outcomes (Stage A, 12 Sep 2026)

What changed vs planned:
- Journal layout: kept the existing main+widgets structure (it already IS the
  pin's shape) instead of rebuilding to three columns; added DayTiles,
  MorningBrief, DailyExpensesSection, NotesTodaySection, mind-item verdicts,
  and evening auto-lines into it.
- Step 6 earned its keep twice:
  1. The merge race test caught concurrent weaves losing whole sections
     (unique-index 500 on same-day create; read-modify-write lost update on
     existing days). Fixed with a process-wide merge gate + one retry.
  2. Live testing exposed that Sage had NO working tools in production, with
     four stacked causes: SDK MCP tools deferred behind (disabled) ToolSearch
     -> alwaysLoad; deny-list missed modern harness tools -> options.tools: [];
     the logged-in CLI's claude.ai connectors leaked into the session ->
     strictMcpConfig; and zod v4 z.record() schemas silently dropped the whole
     tool batch in the SDK converter -> described z.any() (backend validates).
     Bisected via a minimal probe script/route. This predates v4.1 - v4.0's
     prod tool loop likely never worked on hydramachine.
- Undo semantics: dismiss-on-confirmed deletes the entity (weaves excepted,
  edited in the journal instead). Time writer does no grid-snapping (agent
  writes record what was said).
- First autonomous production write: task 'Pack sunscreen' -> Kerala project,
  deadline matched to the packing cutoff, receipt chip streamed. Kept (real).
Key decisions during execution: allowedTools generated from the tool list
(auto-approve correct under D1); merge implementation shared as a service so
HTTP and capture writers cannot diverge; ProfileNotes dedupe by exact text.

## Outcomes (Step 9 + review, 2 Oct 2026)

- Beyond plan scope, built during the stretch: the tape (watchman agent +
  /api/activity batch/segments + check_screen tool + tape rule in the persona +
  v1 YouTube alert popup) - grew out of the 12 Sep backdating lesson.
- Three-agent review (security/quality/logic): 1 block + 11 warns + 11
  suggests. The block cluster was fixed pre-ship (cba2ece): op-aware time undo
  via an _undo record on the receipt (stop reopens, edit restores pre-image,
  only creators delete), retro-trim covers timers started inside the interval,
  backdated starts supersede instead of double-counting, stop validates its
  boundaries, failed autoConfirms strand nothing, and the per-turn capture
  context labels writes per type. Remaining warns/suggests tracked for
  follow-up issues (R7-R23: tape prompt-injection fencing, undo session guard,
  watchman spool hygiene, clear-sentinel consistency, idle-threshold unification,
  dedupe helpers).
- 398 backend tests green at ship.

