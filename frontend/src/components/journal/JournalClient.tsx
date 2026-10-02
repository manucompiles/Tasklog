"use client";

// The /journal page (#79): one date's journal. Note column (left) renders the templates'
// sections as one continuous editable note; the rail (right on desktop, top on mobile)
// holds the calendar, mood arc, Front/Back-of-Mind, and Today-so-far widgets.
//
// State model: `contents` is the draft content object per template key; every section
// edit updates it and schedules a debounced PUT upsert for that template (one entry per
// template per date is guaranteed server-side). Check-ins, tasks, and time are fetched
// per date; a light poll keeps the derived "Unplanned, got done" bucket and habit counts
// fresh while the page is open.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Download, HeartPulse, PanelLeft, X } from "lucide-react";
import {
  getJournalTemplates,
  getJournalEntries,
  getJournalEntryDates,
  upsertJournalEntry,
  getMoodCheckins,
  getTasksCompletedOn,
  getTasks,
  getProjects,
  getHabits,
  getTimeEntries,
  getExpenses,
  getNotesForDay,
  createTask,
  completeTask,
  addMoodCheckin,
  deleteMoodCheckin,
  journalExportUrl,
  getLabels,
  JournalTemplateDef,
  MoodCheckinDto,
  Task,
  Project,
  Label,
  TimeEntry,
} from "@/lib/api";
import { dateKey, addDays, dayTotalSeconds, perProjectTotals } from "@/lib/time";
import {
  MindItem,
  PlanContent,
  emptyPlan,
  rolloverCandidates,
} from "@/lib/journal";
import { usePolling } from "@/hooks/usePolling";
import CheckinsSection from "./CheckinsSection";
import ProseSection from "./ProseSection";
import ProjectsSection from "./ProjectsSection";
import PlanSection from "./PlanSection";
import EveningSection from "./EveningSection";
import ListSection from "./ListSection";
import CalendarWidget from "./CalendarWidget";
import MoodArcWidget from "./MoodArcWidget";
import MindWidget from "./MindWidget";
import TodaySoFarWidget from "./TodaySoFarWidget";
import DayTiles from "./DayTiles";
import MorningBrief from "./MorningBrief";
import DailyExpensesSection from "./DailyExpensesSection";
import NotesTodaySection from "./NotesTodaySection";
import FeelingsWheelModal from "./FeelingsWheelModal";
import JournalPreview from "./JournalPreview";
import TaskDetailModal from "../TaskDetailModal";
import TaskSheet from "../TaskSheet";

type Contents = Record<string, Record<string, unknown>>;

const SAVE_DEBOUNCE_MS = 800;

export default function JournalClient() {
  const [date, setDate] = useState<Date>(() => new Date());
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [templates, setTemplates] = useState<JournalTemplateDef[]>([]);
  const [contents, setContents] = useState<Contents>({});
  const [yesterdayDaily, setYesterdayDaily] = useState<Record<string, unknown> | null>(null);
  const [checkins, setCheckins] = useState<MoodCheckinDto[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [completedOnDate, setCompletedOnDate] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [entryDates, setEntryDates] = useState<Set<string>>(new Set());
  const [habitsDone, setHabitsDone] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [timeSeconds, setTimeSeconds] = useState(0);
  // The day's raw time entries, kept so we can derive the client/project breakdown (#86).
  const [timeEntries, setTimeEntries] = useState<TimeEntry[]>([]);
  const [wheelOpen, setWheelOpen] = useState(false);
  // Task detail/edit opened from the plan (#85) - same chaining as TasksClient.
  const [openingTask, setOpeningTask] = useState<Task | null>(null);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [allLabels, setAllLabels] = useState<Label[]>([]);
  // Mobile-only: widgets live in a left swipe-out drawer (desktop shows the right rail).
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Header quick action: the date pill opens the calendar without the drawer.
  const [calOpen, setCalOpen] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  const key = dateKey(date);
  const isToday = key === dateKey(new Date());
  // The day's actuals grouped by client/project (#86) - the "record of life" breakdown that
  // unites task and non-task time. Derived, so it recomputes as entries/projects load.
  const timeBreakdown = useMemo(
    () => perProjectTotals(timeEntries, [date], new Date(), projects),
    [timeEntries, projects, date],
  );
  // Debounced save timers, per template key.
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // Synchronous mirror of `contents`, updated in the same tick as every edit and on
  // day load - the reliable base for save snapshots (React state updates are deferred,
  // so reading `contents` in an event handler can be one edit behind).
  // v4.1 (#92): the day's money rows and typed notes (both optional-everything).
  const [expenses, setExpenses] = useState<import("@/lib/api").ExpenseDto[]>([]);
  const [notesToday, setNotesToday] = useState<import("@/lib/api").NoteDto[]>([]);

  const contentsRef = useRef<Contents>({});
  const eveningRef = useRef<HTMLDivElement | null>(null);
  const autoJumped = useRef(false);

  // ---------- loading ----------

  const loadStatic = useCallback(async () => {
    const [tpls, allTasks, projs, labels] = await Promise.all([
      getJournalTemplates(),
      getTasks(),
      getProjects(),
      getLabels(),
    ]);
    setTemplates(tpls);
    setTasks(allTasks);
    setProjects(projs);
    setAllLabels(labels);
  }, []);

  const loadDay = useCallback(async (day: Date) => {
    const k = dateKey(day);
    const prevK = dateKey(addDays(day, -1));
    const [entries, cks, completed, prevEntries, timeEntries, habits, dayExpenses, dayNotes] = await Promise.all([
      getJournalEntries(k),
      getMoodCheckins(k),
      getTasksCompletedOn(k),
      getJournalEntries(prevK),
      getTimeEntries(k, dateKey(addDays(day, 1))),
      getHabits(),
      getExpenses(k, k).catch(() => []),
      getNotesForDay(k).catch(() => []),
    ]);
    const byKey: Contents = {};
    for (const e of entries) byKey[e.templateKey] = e.content;
    contentsRef.current = byKey;
    setContents(byKey);
    setSaveState("idle");
    setCheckins(cks);
    setCompletedOnDate(completed);
    setYesterdayDaily(prevEntries.find((e) => e.templateKey === "daily")?.content ?? null);
    setTimeSeconds(dayTotalSeconds(timeEntries, day, new Date()));
    setTimeEntries(timeEntries);
    setHabitsDone({ done: habits.filter((h) => h.doneToday).length, total: habits.length });
    setExpenses(dayExpenses);
    setNotesToday(dayNotes);
  }, []);

  const loadMonthDots = useCallback(async (anchor: Date) => {
    const from = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const to = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1);
    setEntryDates(new Set(await getJournalEntryDates(dateKey(from), dateKey(to))));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        await Promise.all([loadStatic(), loadDay(date), loadMonthDots(date)]);
        setError(null);
      } catch {
        setError("Could not load the journal. Is the API running?");
      } finally {
        setLoading(false);
      }
    })();
    // Re-runs when the selected date changes (key covers date identity).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Keep task-derived data fresh (tasks completed elsewhere appear in Unplanned).
  usePolling(
    useCallback(async () => {
      const [completed, allTasks] = await Promise.all([getTasksCompletedOn(key), getTasks()]);
      setCompletedOnDate(completed);
      setTasks(allTasks);
    }, [key]),
    30000,
    mode === "edit" && !loading,
  );

  // The cheap evening close: after 18:00, opening today's journal lands on the evening
  // cluster (once per mount; respects reduced motion via scrollIntoView's default).
  useEffect(() => {
    if (!loading && isToday && !autoJumped.current && new Date().getHours() >= 18) {
      autoJumped.current = true;
      setTimeout(() => jumpToEvening(), 300);
    }
  }, [loading, isToday]);

  // ---------- saving ----------

  // Both the date AND the content are snapshotted at schedule time. Reading content
  // at fire time (e.g. through a ref) is a corruption bug: switch dates within the
  // debounce window and the pending timer would write the NEW day's content onto the
  // OLD day's entry. With the snapshot, a timer that outlives a date switch still
  // persists exactly the edit that scheduled it, onto the day it belongs to.
  const scheduleSave = useCallback(
    (templateKey: string, dayKey: string, snapshot: Record<string, unknown>) => {
      clearTimeout(saveTimers.current[templateKey]);
      saveTimers.current[templateKey] = setTimeout(async () => {
        try {
          setSaveState("saving");
          await upsertJournalEntry(templateKey, dayKey, snapshot);
          setSaveState("saved");
          setEntryDates((prev) => new Set(prev).add(dayKey));
        } catch {
          setSaveState("error");
        }
      }, SAVE_DEBOUNCE_MS);
    },
    [],
  );

  const updateSection = useCallback(
    (templateKey: string, sectionKey: string, value: unknown) => {
      const snapshot = { ...(contentsRef.current[templateKey] ?? {}), [sectionKey]: value };
      contentsRef.current = { ...contentsRef.current, [templateKey]: snapshot };
      setContents(contentsRef.current);
      scheduleSave(templateKey, key, snapshot);
    },
    [scheduleSave, key],
  );

  // ---------- derived ----------

  const tasksById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const daily = contents["daily"] ?? {};
  const plan = (daily["todays_plan"] as PlanContent | undefined) ?? emptyPlan();
  const planIds = useMemo(() => new Set(Object.values(plan.buckets).flat()), [plan]);
  const unplanned = useMemo(
    () => completedOnDate.filter((t) => !planIds.has(t.id)),
    [completedOnDate, planIds],
  );
  const planDone = [...planIds].filter((id) => tasksById.get(id)?.isCompleted).length;

  // v4.1 (#92, pin 16) - derived lines for the tiles and the evening ceremony.
  const spentToday = expenses.reduce((sum, x) => sum + (x.direction === "in" ? -x.amount : x.amount), 0);
  const movedLine = (() => {
    const parts: string[] = [];
    const doneTitles = [...planIds]
      .map((id) => tasksById.get(id))
      .filter((t) => t?.isCompleted)
      .map((t) => t!.title);
    if (doneTitles.length > 0) parts.push(`${doneTitles.join(", ")} - done`);
    if (unplanned.length > 0) parts.push(`${unplanned.length} unplanned win${unplanned.length > 1 ? "s" : ""}`);
    if (timeSeconds > 0) parts.push(`${Math.floor(timeSeconds / 3600)}h${String(Math.floor((timeSeconds % 3600) / 60)).padStart(2, "0")}m tracked, no hidden gaps`);
    return parts.join(" · ");
  })();
  const cameBackLine = (() => {
    const parts: string[] = [];
    if (notesToday.length > 0) parts.push(`${notesToday.length} thought${notesToday.length > 1 ? "s" : ""} kept`);
    if (checkins.length > 0) parts.push(`${checkins.length} check-in${checkins.length > 1 ? "s" : ""}`);
    if (entryDates.size > 0) parts.push(`journal streak alive (${entryDates.size} day${entryDates.size > 1 ? "s" : ""} this month)`);
    return parts.join(" · ");
  })();


  const fom = (daily["front_of_mind"] as MindItem[] | undefined) ?? [];
  const bom = (daily["back_of_mind"] as MindItem[] | undefined) ?? [];
  const fomRolled = rolloverCandidates(
    (yesterdayDaily?.["front_of_mind"] as MindItem[] | undefined) ?? undefined,
    fom,
  );
  const bomRolled = rolloverCandidates(
    (yesterdayDaily?.["back_of_mind"] as MindItem[] | undefined) ?? undefined,
    bom,
  );

  // Yesterday's uncleared mind items feed the morning brief's rollover line.
  const briefRollovers = [...fomRolled, ...bomRolled];

  // ---------- actions ----------

  const handleCreateTask = useCallback(
    async (title: string): Promise<Task> => {
      // Born from the day's plan: due that day, Inbox, defaults elsewhere.
      const task = await createTask(title, key);
      setTasks((prev) => [task, ...prev]);
      return task;
    },
    [key],
  );

  const handleToggleTask = useCallback(
    async (id: number, isCompleted: boolean) => {
      // Optimistic: flip locally, reconcile with the server response.
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, isCompleted } : t)));
      try {
        const updated = await completeTask(id, isCompleted);
        setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
        setCompletedOnDate(await getTasksCompletedOn(key));
      } catch {
        setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, isCompleted: !isCompleted } : t)));
      }
    },
    [key],
  );

  // A task saved from the detail modal or sheet: reconcile the journal's task list
  // and the derived Unplanned bucket (completion may have changed).
  const handleTaskSaved = useCallback(
    async (task: Task) => {
      setTasks((prev) => prev.map((t) => (t.id === task.id ? task : t)));
      setOpeningTask((prev) => (prev && prev.id === task.id ? task : prev));
      setCompletedOnDate(await getTasksCompletedOn(key));
    },
    [key],
  );

  const handleSaveCheckin = useCallback(
    async (words: string[], energy: number, mocLevel: number | null) => {
      // Viewing a past date = backfilling that day (at the current wall-clock time),
      // not silently logging onto today.
      const checkinAt = isToday ? undefined : `${key}T${new Date().toTimeString().slice(0, 8)}`;
      await addMoodCheckin(words, energy, mocLevel, checkinAt);
      setCheckins(await getMoodCheckins(key));
      setWheelOpen(false);
    },
    [key, isToday],
  );

  const handleDeleteCheckin = useCallback(
    async (id: number) => {
      await deleteMoodCheckin(id);
      setCheckins(await getMoodCheckins(key));
    },
    [key],
  );

  const jumpToEvening = () => {
    // "smooth" is an author-forced animation browsers do NOT suppress under
    // prefers-reduced-motion - honor the preference explicitly.
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    eveningRef.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
  };

  const selectDate = (d: Date) => {
    setMode("edit");
    setDate(d);
    setDrawerOpen(false); // picking a day is a destination - show the note
    setCalOpen(false);
    if (d.getMonth() !== date.getMonth() || d.getFullYear() !== date.getFullYear()) {
      loadMonthDots(d);
    }
  };

  // Edge-swipe right opens the widget drawer; swipe left anywhere closes it.
  // Mostly-horizontal gestures only, so vertical scrolling is never hijacked.
  const onTouchStart = (e: React.TouchEvent) => {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    const start = touchStart.current;
    touchStart.current = null;
    if (!start) return;
    const dx = e.changedTouches[0].clientX - start.x;
    const dy = e.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx)) return;
    if (dx > 0 && start.x < 32) setDrawerOpen(true);
    if (dx < 0) setDrawerOpen(false);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDrawerOpen(false);
        setCalOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // ---------- render ----------

  const dailyTemplate = templates.find((t) => t.key === "daily");
  const extraTemplates = templates.filter((t) => t.key !== "daily");

  if (error) {
    return <p className="text-danger text-sm py-8">{error}</p>;
  }

  // Widgets, shared by the desktop right rail and the mobile drawer.
  const railContent = (
    <>
      <CalendarWidget selected={date} entryDates={entryDates} onSelect={selectDate} onMonthChange={loadMonthDots} />
      <MoodArcWidget checkins={checkins} onLog={() => { setDrawerOpen(false); setWheelOpen(true); }} />
      <MindWidget
        title="Front of mind"
        items={fom}
        rolled={fomRolled}
        onChange={(items) => updateSection("daily", "front_of_mind", items)}
      />
      <MindWidget
        title="Back of mind"
        items={bom}
        rolled={bomRolled}
        onChange={(items) => updateSection("daily", "back_of_mind", items)}
      />
      <TodaySoFarWidget
        planDone={planDone}
        planTotal={planIds.size}
        unplannedDone={unplanned.length}
        timeSeconds={timeSeconds}
        timeBreakdown={timeBreakdown}
        habitsDone={habitsDone.done}
        habitsTotal={habitsDone.total}
        checkinCount={checkins.length}
      />
      <button
        onClick={() => { setDrawerOpen(false); jumpToEvening(); }}
        className="w-full rounded-xl border border-j-line bg-j-card py-2.5 text-sm font-semibold text-j-accent hover:bg-j-accent-soft cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-j-accent"
      >
        Jump to evening ↓
      </button>
    </>
  );

  return (
    <div className="rounded-2xl bg-j-paper text-j-ink p-4 sm:p-6 -mx-2 sm:mx-0" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {/* Header: widgets drawer (mobile), date, mode toggle, export */}
      <header className="flex flex-wrap items-center gap-3 border-b border-j-line pb-4 mb-6">
        <button
          onClick={() => setDrawerOpen(true)}
          aria-label="Open journal widgets"
          className="lg:hidden grid place-items-center w-9 h-9 rounded-lg border border-j-line bg-j-card text-j-muted hover:text-j-ink cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-j-accent"
        >
          <PanelLeft size={16} aria-hidden="true" />
        </button>
        <h1 className="font-heading text-xl font-bold">Journal</h1>
        <button
          onClick={() => setCalOpen(true)}
          aria-label="Change date"
          aria-haspopup="dialog"
          className="inline-flex items-center gap-1.5 text-sm rounded-full border border-j-line bg-j-card px-3.5 py-1.5 hover:bg-j-accent-soft cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-j-accent"
        >
          {date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
          <ChevronDown size={13} aria-hidden="true" className="text-j-muted" />
        </button>
        {!isToday && (
          <button
            onClick={() => selectDate(new Date())}
            className="text-sm text-j-accent font-medium cursor-pointer focus:outline-none focus:underline"
          >
            today
          </button>
        )}
        <button
          onClick={() => setWheelOpen(true)}
          aria-label="Log a mood check-in"
          className="inline-flex items-center gap-1.5 text-sm rounded-full border border-j-line bg-j-card px-3 py-1.5 text-j-accent font-medium hover:bg-j-accent-soft cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-j-accent"
        >
          <HeartPulse size={14} aria-hidden="true" />
          <span className="hidden sm:inline">Check in</span>
        </button>
        <span className="text-xs text-j-muted min-w-14" role="status">
          {saveState === "saving" ? "saving…" : saveState === "saved" ? "saved" : saveState === "error" ? "save failed - retrying on next edit" : ""}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded-lg border border-j-line bg-j-card overflow-hidden" role="tablist" aria-label="Mode">
            {(["edit", "preview"] as const).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                onClick={() => setMode(m)}
                className={`px-4 py-1.5 text-sm capitalize cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-j-accent ${
                  mode === m ? "bg-j-ink text-j-paper font-semibold" : "text-j-muted hover:text-j-ink"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <a
            href={journalExportUrl(key)}
            download
            aria-label="Download this day as markdown"
            title="Download this day as markdown"
            className="grid place-items-center w-9 h-9 rounded-lg border border-j-line bg-j-card text-j-muted hover:text-j-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-j-accent"
          >
            <Download size={16} aria-hidden="true" />
          </a>
        </div>
      </header>

      {loading ? (
        <p className="text-sm text-j-muted py-10 text-center">Loading the day…</p>
      ) : (
        <div className="flex gap-6 items-start">
          {/* Desktop rail: right column. On mobile the same widgets live in the drawer. */}
          <aside className="hidden lg:grid w-[300px] order-2 sticky top-4 grid-cols-1 gap-3.5">
            {railContent}
          </aside>

          {/* Note column */}
          <main className="flex-1 min-w-0 max-w-2xl lg:order-1">
            {mode === "preview" ? (
              <JournalPreview date={key} />
            ) : (
              <div className="space-y-3.5">
                <DayTiles
                  checkins={checkins}
                  planDone={planDone}
                  planTotal={planIds.size}
                  spentToday={spentToday}
                  timeSeconds={timeSeconds}
                />
                <MorningBrief timeEntries={timeEntries} rollovers={briefRollovers} />
                {dailyTemplate?.sections.map((section) => {
                  if (section.kind === "mind") return null; // rail widgets own these
                  const value = daily[section.key];
                  const onChange = (v: unknown) => updateSection("daily", section.key, v);
                  switch (section.kind) {
                    case "checkins":
                      return (
                        <CheckinsSection
                          key={section.key}
                          title={section.title}
                          checkins={checkins}
                          onDelete={handleDeleteCheckin}
                        />
                      );
                    case "prose":
                      return (
                        <ProseSection
                          key={section.key}
                          title={section.title}
                          value={(value as string | undefined) ?? ""}
                          optional={section.optional}
                          resetKey={key}
                          onChange={onChange}
                        />
                      );
                    case "projects":
                      return (
                        <ProjectsSection
                          key={section.key}
                          title={section.title}
                          value={(value as { name: string; focus: string }[] | undefined) ?? []}
                          projects={projects}
                          onChange={onChange}
                        />
                      );
                    case "plan":
                      return (
                        <PlanSection
                          key={section.key}
                          title={section.title}
                          plan={plan}
                          tasksById={tasksById}
                          unplanned={unplanned}
                          isToday={isToday}
                          onChange={onChange}
                          onCreateTask={handleCreateTask}
                          onToggleTask={handleToggleTask}
                          onSearch={(text) => Promise.resolve(searchLocal(tasks, text, planIds))}
                          onOpenTask={setOpeningTask}
                        />
                      );
                    case "evening":
                      return (
                        <div key={section.key} ref={eveningRef}>
                          <EveningSection
                            title={section.title}
                            value={(value as Record<string, string> | undefined) ?? {}}
                            checkins={checkins}
                            onChange={onChange}
                            movedLine={movedLine}
                            cameBackLine={cameBackLine}
                          />
                        </div>
                      );
                    default:
                      return null;
                  }
                })}

                <DailyExpensesSection expenses={expenses} />
                <NotesTodaySection notes={notesToday} />

                {extraTemplates.map((tpl) =>
                  tpl.sections.map((section) => {
                    const value = (contents[tpl.key] ?? {})[section.key];
                    const onChange = (v: unknown) => updateSection(tpl.key, section.key, v);
                    if (section.kind === "list") {
                      return (
                        <ListSection
                          key={`${tpl.key}.${section.key}`}
                          title={section.title}
                          hint={tpl.key === "affirmations" ? "revisit at close - celebrate what held" : undefined}
                          value={(value as string[] | undefined) ?? []}
                          onChange={onChange}
                        />
                      );
                    }
                    if (section.kind === "prose") {
                      return (
                        <ProseSection
                          key={`${tpl.key}.${section.key}`}
                          title={section.title}
                          value={(value as string | undefined) ?? ""}
                          optional={section.optional}
                          resetKey={key}
                          onChange={onChange}
                        />
                      );
                    }
                    return null;
                  }),
                )}
              </div>
            )}
          </main>
        </div>
      )}

      {/* Mobile: floating evening jump */}
      {/* bottom-20 clears the full-width TrackingBar pinned at the viewport bottom */}
      <button
        onClick={jumpToEvening}
        className="lg:hidden fixed bottom-20 right-4 z-40 rounded-full bg-j-ink text-j-paper px-5 py-3 text-sm font-semibold shadow-lg cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-j-accent"
        style={{ display: mode === "preview" ? "none" : undefined }}
      >
        Evening ↓
      </button>

      {/* Mobile widget drawer: slides in from the left (edge-swipe right also opens it) */}
      {drawerOpen && (
        <div className="fixed inset-0 bg-black/40 z-40 lg:hidden tl-fade" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
      )}
      <aside
        aria-label="Journal widgets"
        className={`lg:hidden fixed top-0 left-0 bottom-0 z-50 w-[320px] max-w-[86vw] overflow-y-auto bg-j-paper border-r border-j-line p-4 space-y-3.5 transform transition-transform duration-200 ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between">
          <span className="font-mono text-[0.68rem] uppercase tracking-[0.13em] text-j-muted">Widgets</span>
          <button
            onClick={() => setDrawerOpen(false)}
            aria-label="Close widgets"
            className="grid place-items-center w-9 h-9 rounded-lg text-j-muted hover:text-j-ink cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-j-accent"
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        {railContent}
      </aside>

      {/* Quick calendar: opened from the header date pill, no drawer needed */}
      {calOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4 tl-fade"
          onClick={(e) => e.target === e.currentTarget && setCalOpen(false)}
        >
          <div role="dialog" aria-modal="true" aria-label="Pick a date" className="w-full max-w-[340px] tl-pop">
            <CalendarWidget selected={date} entryDates={entryDates} onSelect={selectDate} onMonthChange={loadMonthDots} />
          </div>
        </div>
      )}

      {wheelOpen && (
        <FeelingsWheelModal onSave={handleSaveCheckin} onClose={() => setWheelOpen(false)} />
      )}

      {/* Task detail + edit sheet, opened from the plan (#85) - TasksClient's chaining */}
      {openingTask && (
        <TaskDetailModal
          task={openingTask}
          projects={projects}
          allLabels={allLabels}
          onClose={() => setOpeningTask(null)}
          onEdit={(task) => {
            setOpeningTask(null);
            setEditingTask(task);
          }}
          onSaved={handleTaskSaved}
        />
      )}
      {editingTask && (
        <TaskSheet
          task={editingTask}
          projects={projects}
          allLabels={allLabels}
          onSaved={(task) => {
            handleTaskSaved(task);
            setEditingTask(null);
          }}
          onClose={() => setEditingTask(null)}
        />
      )}
    </div>
  );
}

// Local type-ahead over the already-loaded task list (open tasks not yet planned).
// Server search exists too (searchOpenTasks) but the full list is already in memory
// for id lookups, so filtering locally avoids a round-trip per keystroke.
function searchLocal(tasks: Task[], text: string, planned: Set<number>): Task[] {
  const q = text.trim().toLowerCase();
  if (!q) return [];
  return tasks
    .filter((t) => !t.isCompleted && !planned.has(t.id) && t.title.toLowerCase().includes(q))
    .slice(0, 6);
}
