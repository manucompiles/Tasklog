"use client";

// The mood arc (#79, user's design): at rest, a small heartbeat-style chart of the day's
// check-ins - x is time of day, height and color are the Map of Consciousness level
// (green high, red low) with a dashed reference line at 200, Hawkins's courage threshold.
// "+ Log" opens the feelings wheel; tapping the chart toggles a taller view.

import { useState } from "react";
import { MoodCheckinDto } from "@/lib/api";
import { dayFraction, timeOfDayLabel } from "@/lib/journal";
import { mocBand } from "@/lib/feelingsWheel";
import SectionCard from "./SectionCard";

const BAND_COLOR: Record<string, string> = {
  low: "var(--color-moc-low)",
  mid: "var(--color-moc-mid)",
  high: "var(--color-moc-high)",
  none: "var(--color-j-muted)",
};

// MoC axis bounds for the y scale (Shame 20 .. Peace 600+).
const MOC_MIN = 20;
const MOC_MAX = 620;
// Check-ins without a MoC level (free words only) still plot; they sit mid-axis.
const MOC_FALLBACK = 250;

export default function MoodArcWidget({
  checkins,
  onLog,
}: {
  checkins: MoodCheckinDto[];
  onLog: () => void;
}) {
  const [big, setBig] = useState(false);
  const W = 268;
  const H = big ? 150 : 88;
  const PAD = 14;

  const x = (iso: string) => PAD + dayFraction(iso) * (W - 2 * PAD);
  const y = (moc: number | null) =>
    PAD + (1 - ((moc ?? MOC_FALLBACK) - MOC_MIN) / (MOC_MAX - MOC_MIN)) * (H - 2 * PAD);
  const courageY = y(200);
  const points = checkins.map((c) => ({ cx: x(c.checkinAt), cy: y(c.mocLevel), c }));

  return (
    <SectionCard
      title="Mood arc"
      marked
      action={
        <button
          onClick={onLog}
          className="text-[0.8rem] font-semibold text-j-accent hover:underline cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-j-accent rounded px-1"
        >
          + Log
        </button>
      }
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full cursor-pointer"
        role="img"
        aria-label={`Mood arc: ${checkins.length} check-ins today`}
        onClick={() => setBig((b) => !b)}
      >
        <defs>
          {/* y encodes MoC, so a vertical gradient colors the line by level. */}
          <linearGradient id="moc-arc-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--color-moc-high)" />
            <stop offset="0.55" stopColor="var(--color-moc-mid)" />
            <stop offset="1" stopColor="var(--color-moc-low)" />
          </linearGradient>
        </defs>
        <line x1={PAD} y1={courageY} x2={W - PAD} y2={courageY} stroke="var(--color-j-line)" strokeDasharray="3 4" />
        <text x={W - PAD} y={courageY - 4} textAnchor="end" className="fill-j-muted" fontSize="8" fontFamily="monospace">
          courage · 200
        </text>
        <text x={PAD} y={H - 3} className="fill-j-muted" fontSize="8" fontFamily="monospace">0h</text>
        <text x={W - PAD} y={H - 3} textAnchor="end" className="fill-j-muted" fontSize="8" fontFamily="monospace">24h</text>
        {points.length > 1 && (
          <polyline
            points={points.map((p) => `${p.cx},${p.cy}`).join(" ")}
            fill="none"
            stroke="url(#moc-arc-gradient)"
            strokeWidth="2.2"
          />
        )}
        {points.map((p) => (
          <circle key={p.c.id} cx={p.cx} cy={p.cy} r="4" fill={BAND_COLOR[mocBand(p.c.mocLevel)]}>
            <title>
              {`${timeOfDayLabel(p.c.checkinAt)} · ${p.c.words.join(", ")} · energy ${p.c.energy ?? "-"}${p.c.mocLevel !== null ? ` · MoC ${p.c.mocLevel}` : ""}`}
            </title>
          </circle>
        ))}
      </svg>
      <p className="font-mono text-[0.62rem] text-j-muted mt-1">
        {checkins.length === 0
          ? "no check-ins yet - how does the morning feel?"
          : `tap chart to ${big ? "shrink" : "expand"} · ${checkins.length} check-in${checkins.length > 1 ? "s" : ""}`}
      </p>
    </SectionCard>
  );
}
