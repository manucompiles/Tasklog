# P92 - The Companion Days (v4.1)

**Overall Progress:** `33%`

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

- [ ] 🟨 **Step 4: Sage tools + conduct** `[sequential]` → depends on: Step 2
  - [ ] 🟥 propose_capture extended: type + typed payload schemas
  - [ ] 🟥 persona.md: the conduct (anti-Socrates rules, morning statement,
        evening ceremony, register matching, invisible receipts language ban)
  - [ ] 🟥 Morning brief + evening What Moved / What Came Back derivations
        (route-side from existing APIs; no new job system)
  - [ ] 🟥 ProfileNotes store (Text, Kind, SourceDate, Active) + context
        injection: Sage's own note sheet - distilled at session close via a
        write_profile_note tool, loaded into every conversation; surfaced
        and correctable in the Stage B Profile tab (until then, by chat)

- [ ] 🟥 **Step 5: Journal day page redo** `[UI]` `[sequential]` → depends on:
  Steps 2-3 (pin 16)
  - [ ] 🟥 Three-column layout, toggleable day rail, derived tiles
  - [ ] 🟥 Morning brief section (auto), dump items with destiny links
        (popup entities), structured expenses section
  - [ ] 🟥 Evening close: in-place verdicts on mind items (D7), auto lines,
        closing thoughts prose
  - [ ] 🟥 Receipt chips replace proposal cards (D1): compact "Sage did X"
        affordances in the conversation + on entities - click opens
        edit / update / delete / undo popover; no approval UI anywhere

- [ ] 🟥 **Step 6: Stage A verification + tests** `[sequential]` → depends on: Steps 1-5
  - [ ] 🟥 Writer round-trips against sanitized dogfood corpus samples
  - [ ] 🟥 Merge endpoint race test (two concurrent section writes)
  - [ ] 🟥 Live check on hydramachine via deploy-home.sh

### Stage B - after the trip (Sep 24+)

- [ ] 🟥 **Step 7: Schema B + Projects tab** `[sequential]` → depends on: Stage A
  - [ ] 🟥 Project.Status (active/on-hold) + Area entity (Name, Why) +
        area-grouped sidebar; composer with search-or-create comboboxes
  - [ ] 🟥 Project home per pins 1-13 (About/Now+chapters, pulse, goals
        popups, optional expenses panel, Revive)

- [ ] 🟥 **Step 8: People + Profile tab** `[UI]` `[sequential]` → depends on: Step 7
  - [ ] 🟥 Person entity (relation, rhythm, dates, threads, memories links,
        splits) per pin 17, popup-first
  - [ ] 🟥 Profile tab per pin 15: identities (derived, read-only v1), areas
        + whys, What Sage Knows (correctable), people, memories, wishes

- [ ] 🟥 **Step 9: Docs + ship prep** `[sequential]` → depends on: Step 8
  - [ ] 🟥 /document sync, CHANGELOG v4.1.0, review round

## Outcomes
<!-- filled at execution end -->
