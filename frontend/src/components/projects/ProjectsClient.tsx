"use client";

// The Projects tab (v4.1 Stage B, #92) - mockup pins 1-13 built for real.
// One tab: sidebar grouped by AREA (pin 11: area != client), each project
// opening its HOME in place (pin 6: home not dashboard - one-line About for
// the homely feeling, single-focus NOW with append-only chapters, a derived
// pulse, configurable goals, and optional sections that appear only when life
// has produced their content).

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type AreaDto, type Client, type ExpenseDto, type GoalDto, type NoteDto,
  type Project, type Task, type TimeEntry,
  createGoal, createProjectFull, getAreas, getClients, getExpensesForProject,
  getGoals, getNotesForDay, getProjects, getTasks, getTimeEntries,
  updateArea, updateProjectHome,
} from "@/lib/api";
import GoalPopup from "./GoalPopup";

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function hm(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

export default function ProjectsClient() {
  const [areas, setAreas] = useState<AreaDto[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [todayEntries, setTodayEntries] = useState<TimeEntry[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [goals, setGoals] = useState<GoalDto[]>([]);
  const [expenses, setExpenses] = useState<ExpenseDto[]>([]);
  const [notesToday, setNotesToday] = useState<NoteDto[]>([]);
  const [openGoal, setOpenGoal] = useState<GoalDto | null>(null);
  const [loading, setLoading] = useState(true);

  // Composer (pin 12): one line creates it; area is a datalist - typing an
  // existing name picks it, typing a new one creates it. No modal forms, ever.
  const [composing, setComposing] = useState(false);
  const [npName, setNpName] = useState("");
  const [npArea, setNpArea] = useState("");
  const [npClientId, setNpClientId] = useState<number | "">("");

  // Inline hand-edits (pin 17: everything editable by hand).
  const [editingAbout, setEditingAbout] = useState(false);
  const [editingNow, setEditingNow] = useState(false);
  const [draft, setDraft] = useState("");
  const [goalDraft, setGoalDraft] = useState("");

  const load = useCallback(async () => {
    const today = dateKey(new Date());
    const tomorrow = dateKey(new Date(Date.now() + 86400000));
    const [a, p, c, t, entries, notes] = await Promise.all([
      getAreas(),
      getProjects(),
      getClients(),
      getTasks(),
      getTimeEntries(today, tomorrow),
      getNotesForDay(today).catch(() => []),
    ]);
    setAreas(a);
    setProjects(p);
    setClients(c);
    setTasks(t);
    setTodayEntries(entries);
    setNotesToday(notes);
    setSelectedId((prev) => prev ?? p.find((x) => x.status === "active")?.id ?? p[0]?.id ?? null);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await load();
      } finally {
        setLoading(false);
      }
    })();
  }, [load]);

  const selected = projects.find((p) => p.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId) return;
    void getGoals(selectedId).then(setGoals).catch(() => setGoals([]));
    void getExpensesForProject(selectedId).then(setExpenses).catch(() => setExpenses([]));
  }, [selectedId]);

  // ---------- derived ----------

  const openTasks = useMemo(
    () => tasks.filter((t) => t.projectId === selectedId && !t.isCompleted),
    [tasks, selectedId],
  );
  const projectEntriesToday = useMemo(
    () => todayEntries.filter((e) => e.projectId === selectedId),
    [todayEntries, selectedId],
  );
  const trackedToday = projectEntriesToday.reduce((s, e) => s + e.durationSeconds, 0);

  // The pulse (pin 13): one derived line answering "is this alive?".
  const pulse = useMemo(() => {
    if (!selected) return "";
    const parts: string[] = [];
    if (trackedToday > 0) parts.push(`${hm(trackedToday)} today`);
    if (openTasks.length > 0) parts.push(`${openTasks.length} open`);
    const activeGoals = goals.filter((g) => g.status === "active").length;
    if (activeGoals > 0) parts.push(`${activeGoals} goal${activeGoals > 1 ? "s" : ""}`);
    if (parts.length === 0) parts.push(selected.status === "onhold" ? "sleeping" : "quiet today");
    return parts.join(" · ");
  }, [selected, trackedToday, openTasks, goals]);

  // Notes mentioning this project via about-links (pin 7: they gather themselves).
  const mentions = useMemo(() => {
    if (!selectedId) return [];
    return notesToday.filter((n) => {
      try {
        const about = JSON.parse(n.aboutJson) as { type?: string; id?: number; name?: string }[];
        return about.some(
          (x) => x.type === "project" && (x.id === selectedId || x.name?.toLowerCase() === selected?.name.toLowerCase()),
        );
      } catch {
        return false;
      }
    });
  }, [notesToday, selectedId, selected]);

  const chapters = useMemo(() => {
    if (!selected) return [];
    try {
      return JSON.parse(selected.nowHistoryJson) as { at: string; text: string }[];
    } catch {
      return [];
    }
  }, [selected]);

  // Sidebar groups: areas in order, then the ungrouped "Projects" bucket, then
  // On hold at the bottom (pin 2: full quieter homes, never deleted).
  const groups = useMemo(() => {
    const active = projects.filter((p) => p.status !== "onhold");
    const result: { key: string; title: string; areaId: number | null; items: Project[] }[] = [];
    for (const a of areas) {
      const items = active.filter((p) => p.areaId === a.id);
      if (items.length > 0) result.push({ key: `a${a.id}`, title: a.name, areaId: a.id, items });
    }
    const ungrouped = active.filter((p) => p.areaId === null || !areas.some((a) => a.id === p.areaId));
    if (ungrouped.length > 0) result.push({ key: "none", title: "Projects", areaId: null, items: ungrouped });
    return result;
  }, [areas, projects]);
  const onHold = projects.filter((p) => p.status === "onhold");

  // ---------- actions ----------

  const swap = (p: Project) => setProjects((prev) => prev.map((x) => (x.id === p.id ? p : x)));

  const saveAbout = async () => {
    if (!selected) return;
    setEditingAbout(false);
    if (draft === (selected.about ?? "")) return;
    swap(await updateProjectHome(selected.id, { about: draft }));
  };

  const saveNow = async () => {
    if (!selected) return;
    setEditingNow(false);
    if (draft === (selected.nowText ?? "")) return;
    swap(await updateProjectHome(selected.id, { now: draft }));
  };

  const toggleHold = async () => {
    if (!selected) return;
    swap(await updateProjectHome(selected.id, {
      status: selected.status === "onhold" ? "active" : "onhold",
    }));
  };

  const addGoal = async () => {
    const title = goalDraft.trim();
    if (!title || !selectedId) return;
    setGoalDraft("");
    const g = await createGoal(selectedId, title);
    setGoals((prev) => [g, ...prev]);
  };

  const createProject = async () => {
    const name = npName.trim();
    if (!name) return;
    const areaName = npArea.trim();
    const existing = areas.find((a) => a.name.toLowerCase() === areaName.toLowerCase());
    const p = await createProjectFull({
      name,
      ...(npClientId !== "" ? { clientId: npClientId } : {}),
      ...(existing ? { areaId: existing.id } : areaName ? { newAreaName: areaName } : {}),
    });
    setComposing(false);
    setNpName("");
    setNpArea("");
    setNpClientId("");
    await load();
    setSelectedId(p.id);
  };

  const editWhy = async (area: AreaDto) => {
    const why = window.prompt(`The why for "${area.name}":`, area.why ?? "");
    if (why === null) return;
    const updated = await updateArea(area.id, { why });
    setAreas((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  };

  if (loading) return <p className="text-sm text-text-muted py-10 text-center">opening the projects…</p>;

  return (
    <div className="lg:flex lg:items-start lg:gap-5">
      {/* Sidebar: grouped by area. On narrow screens a scrollable strip (pin 1). */}
      <aside className="lg:w-[250px] lg:shrink-0 mb-4 lg:mb-0 lg:sticky lg:top-4">
        <div className="flex lg:block gap-2 overflow-x-auto pb-2 lg:pb-0">
          {groups.map((g) => {
            const area = areas.find((a) => a.id === g.areaId);
            return (
              <div key={g.key} className="shrink-0 lg:mb-4">
                <button
                  type="button"
                  onClick={() => area && void editWhy(area)}
                  title={area?.why ?? undefined}
                  className={`text-[11px] uppercase tracking-wider text-text-muted mb-1 ${area ? "hover:text-text-primary cursor-pointer" : "cursor-default"}`}
                >
                  {g.title}{area ? " ▾" : ""}
                </button>
                <ul className="flex lg:block gap-1.5">
                  {g.items.map((p) => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(p.id)}
                        className={`w-full text-left flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm cursor-pointer ${
                          p.id === selectedId
                            ? "bg-surface-raised text-text-primary font-medium shadow-[inset_3px_0_0] shadow-accent"
                            : "text-text-primary hover:bg-surface-raised"
                        }`}
                      >
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.color ?? "#a1a1aa" }} />
                        <span className="truncate">{p.name}</span>
                        {p.client && <span className="ml-auto text-[11px] text-text-muted/70">{p.client.name}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}

          {onHold.length > 0 && (
            <div className="shrink-0 lg:mb-4">
              <p className="text-[11px] uppercase tracking-wider text-text-muted/70 mb-1">On hold</p>
              <ul className="flex lg:block gap-1.5">
                {onHold.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(p.id)}
                      className={`w-full text-left flex items-center gap-2 rounded-lg px-2.5 py-1 text-[13px] cursor-pointer ${
                        p.id === selectedId ? "bg-surface-raised text-text-primary" : "text-text-muted/70 hover:bg-surface-raised"
                      }`}
                    >
                      <span className="w-2 h-2 rounded-full bg-border shrink-0" />
                      <span className="truncate">{p.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Composer (pin 12): one line creates it. */}
          <div className="shrink-0">
            {!composing ? (
              <button
                type="button"
                onClick={() => setComposing(true)}
                className="text-sm text-accent hover:underline cursor-pointer"
              >
                + New project
              </button>
            ) : (
              <div className="rounded-xl border border-accent/50 p-2.5 space-y-2 w-60">
                <input
                  autoFocus
                  value={npName}
                  onChange={(e) => setNpName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void createProject()}
                  placeholder="Project name…"
                  className="w-full text-sm focus:outline-none"
                />
                <input
                  list="areas-list"
                  value={npArea}
                  onChange={(e) => setNpArea(e.target.value)}
                  placeholder="Area · type to search or create"
                  className="w-full rounded-md border border-border px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <datalist id="areas-list">
                  {areas.map((a) => <option key={a.id} value={a.name} />)}
                </datalist>
                <select
                  value={npClientId}
                  onChange={(e) => setNpClientId(e.target.value === "" ? "" : Number(e.target.value))}
                  className="w-full rounded-md border border-border px-2 py-1 text-xs focus:outline-none"
                  aria-label="Client"
                >
                  <option value="">no client</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <div className="flex gap-2">
                  <button type="button" onClick={() => void createProject()} className="rounded-md bg-primary text-white px-2.5 py-1 text-xs cursor-pointer">Create</button>
                  <button type="button" onClick={() => setComposing(false)} className="text-xs text-text-muted cursor-pointer">cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>
      </aside>

      {/* The project home */}
      <main className="flex-1 min-w-0 max-w-2xl">
        {!selected ? (
          <p className="text-sm text-text-muted py-10 text-center">No projects yet - one line up there creates the first.</p>
        ) : (
          <div className="space-y-5">
            <div>
              <div className="flex items-baseline gap-2.5 flex-wrap">
                <h1 className="font-heading text-2xl font-semibold text-text-primary">{selected.name}</h1>
                {selected.client && (
                  <span className="text-xs rounded-full border border-border px-2.5 py-0.5 text-text-muted">
                    client: {selected.client.name}
                  </span>
                )}
                <span className={`text-xs rounded-full border px-2.5 py-0.5 ${
                  selected.status === "onhold"
                    ? "border-amber-300 bg-amber-50 text-amber-700"
                    : "border-green-200 bg-green-50 text-green-700"
                }`}>
                  {selected.status === "onhold" ? "on hold" : "active"}
                </span>
                <button
                  type="button"
                  onClick={() => void toggleHold()}
                  className="ml-auto text-xs rounded-lg border border-border px-2.5 py-1 text-text-muted hover:border-text-muted cursor-pointer"
                >
                  {selected.status === "onhold" ? "Revive" : "Put on hold"}
                </button>
              </div>

              {/* About: one line, the doorstep (pin 6). Click to hand-edit (pin 17). */}
              {editingAbout ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={() => void saveAbout()}
                  onKeyDown={(e) => e.key === "Enter" && void saveAbout()}
                  className="mt-2 w-full text-sm text-text-muted border-b border-accent focus:outline-none pb-0.5"
                />
              ) : (
                <p
                  className="mt-2 text-sm text-text-muted cursor-text"
                  onClick={() => { setDraft(selected.about ?? ""); setEditingAbout(true); }}
                  title="click to edit"
                >
                  {selected.about ?? <span className="text-text-muted/70">what is this place? one line, click to write it</span>}
                </p>
              )}

              {/* NOW: one focus; old Nows archive as chapters (pin 13). */}
              <div className="mt-1.5 text-sm">
                <span className="font-heading text-[11px] tracking-wider text-text-muted/70">NOW&nbsp;&nbsp;</span>
                {editingNow ? (
                  <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={() => void saveNow()}
                    onKeyDown={(e) => e.key === "Enter" && void saveNow()}
                    className="w-3/4 text-sm border-b border-accent focus:outline-none pb-0.5"
                  />
                ) : (
                  <span
                    className="cursor-text text-text-primary"
                    onClick={() => { setDraft(selected.nowText ?? ""); setEditingNow(true); }}
                    title="click to edit - the old Now archives as a chapter"
                  >
                    {selected.nowText ?? <span className="text-text-muted/70">the current chapter, click to start it</span>}
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-xs tabular-nums text-text-muted">{pulse}</p>
              {chapters.length > 0 && (
                <details className="mt-1 text-xs text-text-muted">
                  <summary className="cursor-pointer">previous chapters ({chapters.length})</summary>
                  {chapters.slice().reverse().map((ch, i) => (
                    <p key={i} className="mt-0.5 pl-3 border-l-2 border-border"><b>{ch.at}</b> - {ch.text}</p>
                  ))}
                </details>
              )}
            </div>

            {/* Goals: born from one line, opened as popups (pins 3+8). */}
            <section>
              <h2 className="font-heading text-sm font-semibold text-text-primary mb-1.5">Goals &amp; milestones</h2>
              {goals.filter((g) => g.status !== "parked").map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => setOpenGoal(g)}
                  className="w-full flex items-center gap-3 py-1.5 border-b border-border text-sm text-left cursor-pointer hover:bg-surface-raised"
                >
                  <span className={`flex-1 truncate ${g.status === "done" ? "line-through text-text-muted/70" : "text-text-primary"}`}>{g.title}</span>
                  {g.timespan && <span className="text-[11px] text-text-muted/70">{g.timespan}</span>}
                  <span className="w-24 h-1.5 rounded-full bg-surface-raised overflow-hidden shrink-0">
                    <span className="block h-full rounded-full bg-accent" style={{ width: `${g.progress}%` }} />
                  </span>
                  <span className="w-9 text-right text-xs tabular-nums text-text-muted">{g.progress}%</span>
                </button>
              ))}
              <input
                value={goalDraft}
                onChange={(e) => setGoalDraft(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void addGoal()}
                placeholder="+ say a goal out loud and it exists"
                className="mt-1 w-full text-sm text-text-primary placeholder:text-text-muted/70 py-1 focus:outline-none"
              />
            </section>

            {/* Optional sections - they appear only when life produced them. */}
            {openTasks.length > 0 && (
              <section>
                <h2 className="font-heading text-sm font-semibold text-text-primary mb-1.5">Open tasks</h2>
                {openTasks.map((t) => (
                  <div key={t.id} className="flex items-center gap-2.5 py-1.5 border-b border-border text-sm">
                    <span className="w-4 h-4 rounded border border-border shrink-0" />
                    <span className="flex-1 truncate text-text-primary">{t.title}</span>
                    {t.deadline && <span className="text-xs text-amber-700">{t.deadline.slice(0, 10)}</span>}
                  </div>
                ))}
              </section>
            )}

            {projectEntriesToday.length > 0 && (
              <section>
                <h2 className="font-heading text-sm font-semibold text-text-primary mb-1.5">Today</h2>
                {projectEntriesToday.map((e) => (
                  <div key={e.id} className="flex items-baseline gap-3 py-1 text-sm border-b border-border">
                    <span className="text-xs tabular-nums text-text-muted/70 w-24 shrink-0">
                      {e.startedAt.slice(11, 16)}-{e.endedAt ? e.endedAt.slice(11, 16) : "now"}
                    </span>
                    <span className="flex-1 truncate text-text-primary">{e.taskTitle || e.description}</span>
                    <span className="text-xs tabular-nums text-text-muted/70">{hm(e.durationSeconds)}</span>
                  </div>
                ))}
              </section>
            )}

            {expenses.length > 0 && (
              <section>
                <h2 className="font-heading text-sm font-semibold text-text-primary mb-1.5">💸 Expenses</h2>
                {expenses.slice(0, 4).map((x) => (
                  <div key={x.id} className="flex items-baseline gap-3 py-1 text-sm border-b border-border">
                    <span className="w-20 shrink-0 text-right tabular-nums text-text-primary">
                      {x.direction === "in" ? "+" : "-"}{x.amount.toLocaleString("en-IN")}
                    </span>
                    <span className="flex-1 truncate text-text-primary">{x.note}</span>
                    <span className="text-[11px] text-text-muted/70">{x.occurredOn.slice(0, 10)}</span>
                  </div>
                ))}
                <p className="flex items-baseline gap-3 pt-1.5 text-sm">
                  <span className="w-20 shrink-0 text-right font-semibold tabular-nums text-text-primary">
                    -{expenses.reduce((s, x) => s + (x.direction === "in" ? -x.amount : x.amount), 0).toLocaleString("en-IN")}
                  </span>
                  <span className="text-text-muted">total on this project</span>
                </p>
              </section>
            )}

            {mentions.length > 0 && (
              <section>
                <h2 className="font-heading text-sm font-semibold text-text-primary mb-1.5">Notes &amp; mentions</h2>
                {mentions.slice(0, 2).map((n) => (
                  <p key={n.id} className="py-1 text-sm text-text-primary border-b border-border">
                    {n.title} <span className="text-[11px] text-text-muted/70">· {n.kind}</span>
                  </p>
                ))}
              </section>
            )}
          </div>
        )}
      </main>

      {openGoal && (
        <GoalPopup
          goal={openGoal}
          onClose={() => setOpenGoal(null)}
          onSaved={(g) => {
            setGoals((prev) => prev.map((x) => (x.id === g.id ? g : x)));
            setOpenGoal(g);
          }}
        />
      )}
    </div>
  );
}
