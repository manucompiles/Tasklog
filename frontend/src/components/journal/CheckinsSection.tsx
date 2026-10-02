"use client";

// The day's mood check-ins as note rows: time, MoC band dot, the user's words, energy.
// Read-only here (logging happens through the wheel); a row can be deleted if mistaken.

import { X } from "lucide-react";
import { MoodCheckinDto } from "@/lib/api";
import { timeOfDayLabel } from "@/lib/journal";
import { mocBand } from "@/lib/feelingsWheel";
import SectionCard from "./SectionCard";

const BAND_COLOR: Record<string, string> = {
  low: "var(--color-moc-low)",
  mid: "var(--color-moc-mid)",
  high: "var(--color-moc-high)",
  none: "var(--color-j-muted)",
};

export default function CheckinsSection({
  title,
  checkins,
  onDelete,
}: {
  title: string;
  checkins: MoodCheckinDto[];
  onDelete: (id: number) => void;
}) {
  return (
    <SectionCard title={title} marked>
      {checkins.length === 0 ? (
        <p className="text-sm text-j-muted">No check-ins yet - log one from the mood arc.</p>
      ) : (
        <ul className="space-y-1">
          {checkins.map((c) => (
            <li key={c.id} className="group flex flex-wrap items-center gap-2 py-1">
              <time className="font-mono text-xs text-j-muted min-w-11">{timeOfDayLabel(c.checkinAt)}</time>
              <span
                className="w-2 h-2 rounded-full"
                style={{ background: BAND_COLOR[mocBand(c.mocLevel)] }}
                aria-hidden="true"
              />
              {c.words.map((w) => (
                <span key={w} className="rounded-full bg-j-accent-soft px-2.5 py-0.5 text-[0.8rem] font-medium text-j-accent">
                  {w}
                </span>
              ))}
              <span className="rounded-full border border-j-line px-2.5 py-0.5 text-[0.8rem] text-j-muted">
                energy {c.energy ?? "-"}
              </span>
              {c.mocLevel !== null && (
                <span className="rounded-full border border-j-line px-2.5 py-0.5 text-[0.8rem] text-j-muted">
                  MoC {c.mocLevel}
                </span>
              )}
              <button
                onClick={() => onDelete(c.id)}
                aria-label={`Delete check-in at ${timeOfDayLabel(c.checkinAt)}`}
                className="opacity-60 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 text-j-muted hover:text-danger p-2 -my-2 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-j-accent rounded"
              >
                <X size={13} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
