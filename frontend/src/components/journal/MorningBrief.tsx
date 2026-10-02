"use client";

// The morning brief (#92, pin 16): the day greets you before you say anything.
// Auto-written from the ledger - last night's sleep and what rolled over -
// never typed, never asked. Renders nothing when there is nothing to say
// (optional everything).

import type { TimeEntry } from "@/lib/api";

interface Props {
  // The day's time entries (already loaded by the page).
  timeEntries: TimeEntry[];
  // Yesterday's uncleared front/back-of-mind texts (the existing rollover derivation).
  rollovers: string[];
}

function hm(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

export default function MorningBrief({ timeEntries, rollovers }: Props) {
  // The night's sleep = the day's longest closed entry that looks like sleep.
  const sleep = timeEntries
    .filter((e) => e.endedAt && `${e.taskTitle ?? ""} ${e.description ?? ""}`.toLowerCase().includes("sleep"))
    .sort((a, b) => b.durationSeconds - a.durationSeconds)[0];

  if (!sleep && rollovers.length === 0) return null;

  return (
    <div className="rounded-xl border border-j-accent/40 bg-j-accent-soft/40 px-4 py-3 mb-3.5">
      <p className="font-mono text-[0.62rem] uppercase tracking-wider text-j-muted mb-1">
        morning brief · auto
      </p>
      <p className="text-sm text-j-ink leading-relaxed">
        {sleep && (
          <>
            Slept {sleep.startedAt.slice(11, 16)}-{sleep.endedAt!.slice(11, 16)} ({hm(sleep.durationSeconds)}).{" "}
          </>
        )}
        {rollovers.length > 0 && (
          <>
            Rolled over: {rollovers.slice(0, 3).join(" · ")}
            {rollovers.length > 3 ? ` · +${rollovers.length - 3} more` : ""}.
          </>
        )}
      </p>
    </div>
  );
}
