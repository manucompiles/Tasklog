# Dogfood findings (10-11 Sep 2026)

Two days of living entirely in Tasklog with an AI agent operating the app from
conversation. Every input was logged verbatim (corpus kept privately - this repo
is public), then mined. These findings precede the #92 scope.

Companion doc: [design-principles-v4.md](design-principles-v4.md) - the synthesis.

## Numbers

- 44 exchanges, 17 distinct input types
- 24+ time entries across two days with zero hidden gaps
- 11 schema gaps surfaced by real usage
- 10 UI design decisions pinned on a live mockup
- 0 forms filled - every entity was born from a spoken sentence

## The input taxonomy

What a user actually throws at a conversational capture system, ranked roughly
by frequency observed:

| Type | Shape | What it needs |
|---|---|---|
| Timer narration | "working on X (client Y)", "now lunch" | start/stop/switch follows speech; missing hierarchy materialized silently |
| Retro narration | "ended X 10 mins ago", "that idle time was a meal" | backdated edits; sensor-reconciled reconstruction |
| Future intent | "it will run from 11:30" | scheduled actions |
| Numbered mind dump | "1. ... 2. another thought that I lost track" | each number is its own capture; lost thoughts kept as markers |
| Deep personal capture | long dictated reflection, mixed topics | journal-first; cleaned prose in the user's voice; park what the user parks |
| Confession + mood | "now I feel guilty" | mood check-in with no form; acknowledge, never counsel |
| Contemplation | a book passage, "the earlier parts feel mine" | source-linked capture; which-parts-are-mine nuance |
| Product/meta musing | trailing "I don't know" | hold, don't commit |
| Design feedback | reactions to a live mockup | iterate the artifact; emotional function is a spec |
| Archive research ask | "search my old exports", "check my old vault" | mine the past, return insight, import nothing |
| Expense dictation | "4214 x2 tickets both way mine" | parse multipliers and pairings; splits are first-class; day-matching |
| List dictation | a packing list | task plus checkable subtasks in one pass |
| Advice question | practical question mid-planning | real answer with reasons, then fold into data |
| Selective non-capture | "no need to log anything" | NOT logging is a first-class instruction |
| Agent audit | "you didn't notice I switched", "are you even seeing the tracker" | the user checks the agent against sensors |
| Correction by talking | "A or B, i am not sure... B, because..." | users self-resolve if you wait; nobody asks for an edit UI |

Cross-cutting: the garble layer. Dictation turns the user's own vocabulary into
common words (project names, ritual names, even book quotes). Cleanup needs a
personal lexicon plus context, not a spellchecker. Numbered lists survive
dictation nearly intact; free musing garbles worst.

## Behavioral findings

- The honest-ledger loop stabilized within one day. Once lapses were recorded
  without judgment, the user began reporting them as they happened. A prior
  tracking streak (2025, reconstructed from old exports) died the first week
  days went sideways; here the sideways day became the best-documented day.
- Despair rounds down. A day with dozens of entries and many decisions was
  called "zero" in the evening because two flagship tasks had not moved. One of
  them was completed 77 minutes later. Evening reviews must lead with what DID
  move, from the ledger, before asking anything.
- The dread ratio: a task avoided for 11 hours took 22 minutes once started.
  The user invented their own countermeasure mid-experiment: 5-minute blocks
  that never owe completion. Anti-dread shapes belong in the product.
- A stale running timer HIDES storms. The longest distraction stretch grew
  behind a forgotten "work" timer. When sensor and timer diverge for 15+
  minutes, nudge once.
- Two-pass capture is a real workflow: raw dump while doing chores ("my brain
  produces ideas while doing things"), refinement later at the desk. Keep both
  passes.
- THE decisive finding: after ~1.5 days the user named the failure mode -
  "seems now just a logger not a companion." Perfect capture with visible
  bookkeeping reads as a system, and systems get abandoned. Capture must be
  invisible; engagement with the content must be the entire visible surface.

## Schema gaps, ranked by how loudly usage demanded them

1. Expense entity - amount, direction, date, split state (who paid, who owes),
   project link; renders in the journal day, rolls up per project and month.
2. Typed capture writers - mood (energy optional), thought (kind + about),
   note-weave, time narration, expense. Everything above passed through the
   agent's hands; Sage needs first-class writers.
3. Journal server-side section merge - whole-content PUT forced a
   GET-merge-PUT dance eleven times in two days; one race from data loss.
4. Project status/kind - on-hold is currently unrepresentable.
5. Person entities - five people appeared with roles in two days.
6. Someday shelf - wishes are not tasks and should not rot in a backlog.
7. Identity/XP layer (later) - derived from evidence only, never declared.
