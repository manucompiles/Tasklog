"use client";

// Derived tiles (#92, pin 16): the day's vitals lead the page - mood, plan
// score, spent, tracked. Computed, never typed (design-principles P5).

import type { MoodCheckinDto } from "@/lib/api";

interface Props {
  checkins: MoodCheckinDto[];
  planDone: number;
  planTotal: number;
  spentToday: number;
  timeSeconds: number;
}

function hm(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

export default function DayTiles({ checkins, planDone, planTotal, spentToday, timeSeconds }: Props) {
  const lastCheckin = checkins.length > 0 ? checkins[checkins.length - 1] : null;
  const tiles: { v: string; k: string }[] = [
    {
      v: lastCheckin ? (lastCheckin.words[0] ?? "-") : "-",
      k: lastCheckin
        ? `last check-in${lastCheckin.energy !== null ? ` · E${lastCheckin.energy}` : ""}`
        : "no check-in yet",
    },
    {
      v: planTotal > 0 ? `${planDone} / ${planTotal}` : "-",
      k: planTotal > 0 ? "plan done" : "no plan yet",
    },
    {
      v: spentToday > 0 ? `-${spentToday.toLocaleString("en-IN")}` : "0",
      k: "spent today",
    },
    { v: timeSeconds > 0 ? hm(timeSeconds) : "-", k: "tracked" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-3.5">
      {tiles.map((t) => (
        <div key={t.k} className="rounded-xl border border-j-line bg-j-card px-3 py-2.5">
          <div className="font-heading text-lg font-semibold text-j-ink leading-tight truncate">{t.v}</div>
          <div className="font-mono text-[0.62rem] text-j-muted mt-0.5">{t.k}</div>
        </div>
      ))}
    </div>
  );
}
