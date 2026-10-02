"use client";

// Where thoughts went (#92, pin 16): the day's typed notes - each mind-dump
// thought's destiny (memory, idea, reflection, quote, wish). The row is the
// link phrase; clicking opens the note itself (pin 14: notes are entities,
// popups over inline). Renders nothing on a day with no typed notes.

import { useState } from "react";
import type { NoteDto } from "@/lib/api";
import SectionCard from "./SectionCard";

interface Props {
  notes: NoteDto[];
}

export default function NotesTodaySection({ notes }: Props) {
  const [open, setOpen] = useState<NoteDto | null>(null);
  if (notes.length === 0) return null;

  return (
    <SectionCard title="Where thoughts went" hint="the day's typed notes">
      <ul className="divide-y divide-j-line">
        {notes.map((n) => (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => setOpen(n)}
              className="w-full flex items-baseline gap-2 py-1.5 text-left text-sm text-j-ink hover:text-j-accent cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-j-accent rounded"
            >
              <span className="flex-1 min-w-0 truncate">{n.title}</span>
              <span className="shrink-0 font-mono text-[0.62rem] text-j-muted border border-j-line rounded-full px-2 py-0.5">
                {n.kind}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {/* The note itself - a popup, never inline (pin 14). */}
      {open && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          onClick={() => setOpen(null)}
          role="dialog"
          aria-modal="true"
          aria-label={open.title}
        >
          <div
            className="w-full max-w-lg max-h-[80vh] overflow-y-auto rounded-2xl bg-j-paper border border-j-line p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="font-mono text-[0.62rem] uppercase tracking-wider text-j-muted mb-1">
              {open.kind}
              {open.source ? ` · ${open.source}` : ""}
            </p>
            <h3 className="font-heading text-lg font-semibold text-j-ink mb-2">{open.title}</h3>
            <p className="text-sm text-j-ink leading-relaxed whitespace-pre-wrap">
              {open.bodyMd || "(no body yet - the title is the whole note so far)"}
            </p>
            <button
              type="button"
              onClick={() => setOpen(null)}
              className="mt-4 rounded-lg border border-j-line px-3 py-1.5 text-sm text-j-muted hover:text-j-ink cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-j-accent"
            >
              close
            </button>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
