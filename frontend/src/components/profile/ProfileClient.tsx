"use client";

// The Profile tab (v4.1 Stage B, mockup pin 15): the living profile made
// visible - what the system must never forget. Identities are evidence-fed
// (read-only v1: derived from where tracked time actually went), areas carry
// their whys, "What Sage knows" is the worn layer with an X per line (the
// transparency contract), people are deep entities, memories and wishes are
// typed notes. Everything correctable; nothing hidden.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type AreaDto, type NoteDto, type PersonDto, type ProfileNoteDto,
  type Project, type TimeEntry,
  getAreas, getNotesByKind, getPersons, getProfileNotes, getProjects,
  getTimeEntries, retireProfileNote, updateArea, updatePerson,
} from "@/lib/api";

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function ProfileClient() {
  const [areas, setAreas] = useState<AreaDto[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [persons, setPersons] = useState<PersonDto[]>([]);
  const [sheet, setSheet] = useState<ProfileNoteDto[]>([]);
  const [memories, setMemories] = useState<NoteDto[]>([]);
  const [wishes, setWishes] = useState<NoteDto[]>([]);
  const [weekEntries, setWeekEntries] = useState<TimeEntry[]>([]);
  const [openPerson, setOpenPerson] = useState<PersonDto | null>(null);
  const [openNote, setOpenNote] = useState<NoteDto | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const weekAgo = dateKey(new Date(Date.now() - 7 * 86400000));
    const tomorrow = dateKey(new Date(Date.now() + 86400000));
    const [a, p, ppl, notes, mem, wsh, entries] = await Promise.all([
      getAreas(),
      getProjects(),
      getPersons(),
      getProfileNotes(),
      getNotesByKind("memory"),
      getNotesByKind("wish"),
      getTimeEntries(weekAgo, tomorrow),
    ]);
    setAreas(a); setProjects(p); setPersons(ppl); setSheet(notes);
    setMemories(mem); setWishes(wsh); setWeekEntries(entries);
  }, []);

  useEffect(() => {
    void (async () => {
      try { await load(); } finally { setLoading(false); }
    })();
  }, [load]);

  // Proto-identities (read-only v1): where the week's tracked hours actually
  // went, by area - evidence, never declaration. The XP layer comes later.
  const identityRows = useMemo(() => {
    const byArea = new Map<string, number>();
    for (const e of weekEntries) {
      const project = projects.find((p) => p.id === e.projectId);
      const areaName = project?.area?.name
        ?? (project?.areaId ? areas.find((a) => a.id === project.areaId)?.name : undefined)
        ?? (project ? "Projects" : "unfiled");
      byArea.set(areaName, (byArea.get(areaName) ?? 0) + e.durationSeconds);
    }
    return [...byArea.entries()]
      .sort((x, y) => y[1] - x[1])
      .slice(0, 5)
      .map(([name, seconds]) => ({ name, hours: (seconds / 3600).toFixed(1) }));
  }, [weekEntries, projects, areas]);

  const editWhy = async (area: AreaDto) => {
    const why = window.prompt(`The why for "${area.name}":`, area.why ?? "");
    if (why === null) return;
    const updated = await updateArea(area.id, { why });
    setAreas((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
  };

  const retire = async (id: number) => {
    await retireProfileNote(id);
    setSheet((prev) => prev.filter((n) => n.id !== id));
  };

  if (loading) return <p className="text-sm text-zinc-500 py-10 text-center">opening the profile…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold text-zinc-900">Profile</h1>
        <p className="text-sm text-zinc-500 mt-1 max-w-xl">
          What the system must never forget: who you are, where you want to be.
          Everything here is derived or confirmed - and everything is correctable.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-x-8 gap-y-6">
        <section>
          <h2 className="font-heading text-sm font-semibold text-zinc-900 mb-1.5">Where the week went</h2>
          {identityRows.length === 0 ? (
            <p className="text-sm text-zinc-400">identities appear as evidence accumulates - track a few days first</p>
          ) : (
            identityRows.map((r) => (
              <div key={r.name} className="flex items-baseline gap-3 py-1 border-b border-zinc-100 text-sm">
                <span className="flex-1 text-zinc-800">{r.name}</span>
                <span className="tabular-nums text-zinc-500 text-xs">{r.hours}h this week</span>
              </div>
            ))
          )}
          <p className="text-[11px] text-zinc-400 mt-1">evidence, never declaration - the identity layer grows from this</p>
        </section>

        <section>
          <h2 className="font-heading text-sm font-semibold text-zinc-900 mb-1.5">
            What Sage knows
            <span className="ml-2 text-[11px] font-normal text-zinc-400">loads into every conversation</span>
          </h2>
          {sheet.length === 0 ? (
            <p className="text-sm text-zinc-400">nothing distilled yet - the note sheet fills as you two talk</p>
          ) : (
            sheet.map((n) => (
              <div key={n.id} className="group flex items-baseline gap-2 py-1 border-b border-zinc-100 text-sm">
                <span className="text-[10px] uppercase text-zinc-400 w-16 shrink-0">{n.kind}</span>
                <span className="flex-1 text-zinc-800">{n.text}</span>
                <button
                  type="button"
                  onClick={() => void retire(n.id)}
                  aria-label={`Remove "${n.text}"`}
                  title="Sage forgets this line"
                  className="opacity-40 group-hover:opacity-100 text-zinc-500 hover:text-red-600 cursor-pointer px-1"
                >
                  ✕
                </button>
              </div>
            ))
          )}
        </section>

        <section>
          <h2 className="font-heading text-sm font-semibold text-zinc-900 mb-1.5">Areas &amp; their whys</h2>
          {areas.length === 0 ? (
            <p className="text-sm text-zinc-400">areas are born when a project claims one</p>
          ) : (
            areas.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => void editWhy(a)}
                className="w-full text-left flex items-baseline gap-3 py-1.5 border-b border-zinc-100 text-sm cursor-pointer hover:bg-zinc-50"
              >
                <span className="font-medium text-zinc-800 w-24 shrink-0">{a.name}</span>
                <span className="flex-1 text-zinc-500 truncate">{a.why ?? "the why is unwritten - click"}</span>
              </button>
            ))
          )}
        </section>

        <section>
          <h2 className="font-heading text-sm font-semibold text-zinc-900 mb-1.5">People</h2>
          {persons.length === 0 ? (
            <p className="text-sm text-zinc-400">people appear when they are mentioned</p>
          ) : (
            persons.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setOpenPerson(p)}
                className="w-full text-left flex items-baseline gap-3 py-1.5 border-b border-zinc-100 text-sm cursor-pointer hover:bg-zinc-50"
              >
                <span className="font-medium text-zinc-800">{p.name}</span>
                <span className="flex-1 text-zinc-500 truncate">
                  {p.whoTheyAre ?? p.relation ?? ""}
                </span>
                {p.lastContactAt && (
                  <span className="text-[11px] text-zinc-400">last: {p.lastContactAt.slice(0, 10)}</span>
                )}
              </button>
            ))
          )}
        </section>

        <section>
          <h2 className="font-heading text-sm font-semibold text-zinc-900 mb-1.5">Memories</h2>
          {memories.length === 0 ? (
            <p className="text-sm text-zinc-400">notable things land here - resurfaced when they matter</p>
          ) : (
            memories.slice(0, 6).map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => setOpenNote(n)}
                className="w-full text-left py-1.5 border-b border-zinc-100 text-sm text-zinc-800 cursor-pointer hover:bg-zinc-50 truncate"
              >
                {n.title}
              </button>
            ))
          )}
        </section>

        <section>
          <h2 className="font-heading text-sm font-semibold text-zinc-900 mb-1.5">Wishes · someday</h2>
          {wishes.length === 0 ? (
            <p className="text-sm text-zinc-400">the someday shelf - wishes are not tasks</p>
          ) : (
            wishes.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => setOpenNote(n)}
                className="w-full text-left py-1.5 border-b border-zinc-100 text-sm text-zinc-800 cursor-pointer hover:bg-zinc-50 truncate"
              >
                {n.title}
              </button>
            ))
          )}
        </section>
      </div>

      {/* Person popup - simplified for now by his call; deepens in its own round. */}
      {openPerson && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          onClick={() => setOpenPerson(null)}
          role="dialog"
          aria-modal="true"
          aria-label={openPerson.name}
        >
          <div
            className="w-full max-w-md max-h-[80vh] overflow-y-auto rounded-2xl bg-white border border-zinc-200 p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div>
              <p className="text-[11px] uppercase tracking-wider text-zinc-500">
                person{openPerson.relation ? ` · ${openPerson.relation}` : ""}
              </p>
              <h3 className="font-heading text-lg font-semibold text-zinc-900">{openPerson.name}</h3>
            </div>
            {([
              ["whoTheyAre", "Who they are to me", openPerson.whoTheyAre],
              ["nextTime", "Next time", openPerson.nextTime],
            ] as const).map(([field, label, value]) => (
              <label key={field} className="block text-sm">
                <span className="text-[11px] uppercase tracking-wider text-zinc-500">{label}</span>
                <input
                  defaultValue={value ?? ""}
                  onBlur={async (e) => {
                    if (e.target.value === (value ?? "")) return;
                    const updated = await updatePerson(openPerson.id, { [field]: e.target.value });
                    setPersons((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
                    setOpenPerson(updated);
                  }}
                  className="mt-1 w-full rounded-lg border border-zinc-200 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </label>
            ))}
            <div className="text-sm text-zinc-600">
              {(() => {
                try {
                  const threads = JSON.parse(openPerson.threadsJson) as string[];
                  return threads.length > 0 ? (
                    <>
                      <span className="text-[11px] uppercase tracking-wider text-zinc-500">Open threads</span>
                      {threads.map((t, i) => <p key={i} className="mt-0.5">· {t}</p>)}
                    </>
                  ) : null;
                } catch { return null; }
              })()}
            </div>
            <button
              type="button"
              onClick={() => setOpenPerson(null)}
              className="rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 hover:text-zinc-900 cursor-pointer"
            >
              close
            </button>
          </div>
        </div>
      )}

      {/* Note popup (pin 14: the row was the link phrase; this is the entity). */}
      {openNote && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          onClick={() => setOpenNote(null)}
          role="dialog"
          aria-modal="true"
          aria-label={openNote.title}
        >
          <div
            className="w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-2xl bg-white border border-zinc-200 p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1">
              {openNote.kind}
              {openNote.source ? ` · ${openNote.source}` : ""}
              {openNote.originDate ? ` · ${openNote.originDate.slice(0, 10)}` : ""}
            </p>
            <h3 className="font-heading text-lg font-semibold text-zinc-900 mb-2">{openNote.title}</h3>
            <p className="text-sm text-zinc-700 leading-relaxed whitespace-pre-wrap">
              {openNote.bodyMd || "(the title is the whole note so far)"}
            </p>
            <button
              type="button"
              onClick={() => setOpenNote(null)}
              className="mt-4 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs text-zinc-600 hover:text-zinc-900 cursor-pointer"
            >
              close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
