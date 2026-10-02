# Design principles for the v4.x line

The synthesis of the two-day dogfood (see
[dogfood-findings.md](dogfood-findings.md)). This is the gate document: scope
and mockups derive from it.

Three user statements govern everything:

1. "What you have constantly built in life are systems to avoid forgetting.
   Do not forget who I am, do not forget where I want to be."
2. "You need something real that you keep getting back."
3. "Make you care about things more than you."

## The first law

Capture is invisible; engagement is the entire visible surface.

The agent-as-logger failure appeared inside the experiment itself: flawless
books, dead relationship - the exact way every previous system died. Sage never
leads with "logged/captured/filed". Receipts are silent and retrievable; the
reply is what a companion says about the content.

## The ten principles

1. **Companion first, ledger backstage.** Bubbles and quiet receipts, never
   filing confirmations.
2. **Born from life, never from forms.** One spoken line creates an entity;
   depth accrues later. Optional everything - sections appear when life
   produces them. (The counter-example that proves it: a beautifully templated
   goals system in the user's old vault containing zero goal notes.)
3. **Evidence over declaration.** Identities, goals, streaks derive from what
   happened. Fake points are lies the brain smells; a receipt-backed increment
   is honest.
4. **Something real comes back, daily.** Distraction loops close instantly;
   real work's loop is long and silent at the end. The evening returns what the
   day earned - all of it true, or none of it works.
5. **The day is the unit; the journal is the center.** Sections fill from
   conversation (the weave); tiles derive; dump items get visible destinies.
6. **Verbatim + cleaned, voice intact.** Two-pass capture (raw dump, later
   refinement); the cleanup keeps the user's tone and personal lexicon.
7. **Sensors arbitrate, kindly.** Check before guessing; label guesses; nudge
   once on divergence; numbers over judgment.
8. **Respect the human contract.** Park what the user parks. Match the
   register. Protect stated protected hours. "Don't log this" is first-class.
   Assume chat replies go unread - state lands in the app.
9. **Anti-dread shapes are native.** 5-minute blocks that never owe
   completion; evenings that argue with despair using the true ledger.
10. **Never lose the user.** The profile keeps people, dates, vows, wishes -
    and resurfaces them at the moment they matter.
11. **The pieces are the product; the arrangement is the user's.** Area is the
    broad domain (Life, Work, Travel, Switch, Hobbies); Client is the part
    that is owed within it (Self and Responsibility both live under Life);
    then project, then task. Any composition must just work - the system
    builds components, the user decides what they mean. A Profile tab
    (identities, areas, the map of me) is the eventual home of this
    composition.
12. **Everything referenced is an entity; links carry only the phrase.** A
    note is markdown at its core (Obsidian-equivalent); journal lines and
    mention rows are link phrases that open the note itself. Goals, areas,
    notes open as popups, not inline folds - a popup has room for the full
    component and its choices.

## The goal entity (locked 11 Sep)

Born from one spoken line; every field below optional and fillable over time,
mostly by Sage from conversation. Opens as a popup; its full inner screen gets
its own design round later.

- Timespan tier: 10Y / 5Y / 3Y / 1Y / 6M / 3M / 1M
- The why: one line, never demanded
- Progress: derived from a chosen evidence source (linked tasks, habits,
  tracked time) AND manually updatable - the bar accepts a nudge when the
  evidence lags reality
- Expectation history: dated - revising what success looks like archives the
  old expectation (chapters, applied to goals)
- The next smallest door: one attached 5-minute action, always current; what
  Sage offers when the user is stuck

## The type system (locked 11 Sep)

One substrate, two families, plus containers.

**Notes** (markdown at the core; `type` decides fields, surfaces, lifecycle):

- memory - something that happened that is worth saving (not everyday
  routine). Carries about-links (person, project, area). Lifecycle:
  resurfacing at the moment it matters.
- reflection - carries a source and which-parts-are-mine; tied to its day.
- idea - tied to a project or the future; lifecycle: graduation
  (idea -> backlog -> project).
- quote/excerpt - verbatim text + source + own commentary.
- wish - the someday shelf is the wish-type view.
- plain note - everything else.

**Structured records** (real fields, real math; may carry an attached note):
task, time entry, expense, mood check-in, goal, habit, person,
project/client/area.

**Containers are views, not entities**: the journal day, a project home, the
Profile - they compose typed things and own nothing. A mind-dump one-liner is
a link phrase into whatever type the thought became.

Everything enters as a generic capture; Sage proposes the type; the user
keeps/edits/tosses. A note type graduates to a structured record only when
usage demands fields and math (as expense did in the dogfood).

**Memory vs profile - two knowledge layers:**

- Memories are discrete and notable: worth saving because it happened and
  matters. Not the everyday.
- The profile/persona is the accumulated understanding of the person -
  routines ("laundry lands on weekends"), patterns, preferences, vocabulary -
  distilled from the ledger and the days, not stored as individual memories.
  It loads into Sage's context so Sage simply KNOWS; memories are retrieved
  when relevant. As it scales, the profile keeps up with the person.

## The conduct (locked 11 Sep) - how Sage runs the morning and the evening

The flow matters as much as the UI. The failure to avoid is Socrates: chains of
questions that turn a companion into an interviewer (the documented reason the
old journaling prompt was abandoned).

- One question per turn, maximum. Questions only when they unlock action or
  the user is explicitly reflecting. Never probe parked items.
- **Morning:** Sage opens with the brief as a STATEMENT (the night, what
  rolled over) - not a question. The plan forms from whatever the user rants;
  at most one concrete optional prompt ("what's the one thing today?").
  Friendly openers are fine; one thread at a time.
- **Evening:** the close is verdicts-first (movement over logging). Sage
  narrates What Moved and What Came Back from the ledger, walks the open items
  for their in-place verdicts, then offers ONE opening for closing thoughts.
  Fields fill from whatever gets said; unsaid fields stay empty, never asked.
- Register-matching always: deadpan gets deadpan, vulnerability gets warmth,
  celebration only when invited.
- **Autonomous hands, visible receipts (supersedes propose-then-approve):**
  Sage does not suggest - it ACTS. Entities are generated and logged directly,
  no approval step. Every Sage-written thing wears a small receipt affordance
  (a tooltip/chip) that opens edit / update / delete / undo - the trust loop
  moved after the act, which is how the two-day dogfood actually worked (the
  agent did things; the user corrected by talking, and never once wanted a
  approval gate). The capture inbox survives as the audit-and-undo trail, not
  as a gate. Manual edits remain first-class and win silently.

## Locked UI decisions (11 Sep, from the mockup rounds)

- Tasks tab: the CURRENT app UI stays - the mockup's simplified version was
  worse. No redesign in scope.
- Journal: three columns on wide screens (story / doing / toggleable day
  rail); mind items carry status+details in place via popups; evening close
  is a ceremony over the existing sections, duplicating nothing.
- Person entity: deep (rhythm, dates, threads, next-time, memories, splits,
  events together) - popup starts simplified, deepens in its own round.
- All 17 mockup pins in docs/ideas/mockups/projects-tab-mockup.html are the
  UI record.

## What changes in existing designs

- Projects tab mockup: structure survives (grouped sidebar by area, home not
  dashboard, one-line About for the homely feeling, single-focus Now,
  configurable goals, on-hold with Revive, optional expenses). Add a "what
  came back" element.
- Journal tab: redo entirely as day-as-story - morning brief, dump items with
  destinies, structured expenses, derived tiles, sourced contemplations,
  evening that leads with what moved.
- Sage surface: never mocked, biggest gap. Design the invisible-capture feel
  (bubbles, silent receipts, non-interrupting proposals) BEFORE building v4.1.
- The dogfood corpus (private) becomes the eval set for Sage's writers: real
  inputs with known correct outcomes.

## Build order

- **NOW (before the mid-Sep trip):** freeze the #92 scope from this document -
  weave, mood/thought/note writers, expense capture, companion rules in the
  persona. One /ui-spec round for the Sage surface and the journal centerpiece.
- **NEXT (after the trip):** build #92. Writers + weave + expense type +
  journal merge endpoint + morning brief + evening recap. Ship only when the
  writers handle the corpus correctly.
- **THEN:** Projects tab, people, someday shelf, divergence nudges.
- **LATER (the boost):** identities, quests, the game layer - only once the
  evidence pipeline runs daily. The test for every mechanic: did it cause more
  real doing within a week, or more designing?
