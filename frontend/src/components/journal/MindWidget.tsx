"use client";

// Front / Back of mind (#79): transient rail lists meant to be CLEARED by end of day.
// Clearing marks the item closed (it stays in the day's record, struck through in the
// export). Yesterday's uncleared items surface as "rolled over - keep?" candidates:
// tapping one consciously adopts it into today; ignoring it costs nothing tomorrow.

import { useState } from "react";
import { ArrowRight, Check, X } from "lucide-react";
import { MindItem } from "@/lib/journal";
import SectionCard from "./SectionCard";

interface Props {
  title: string;
  items: MindItem[];
  // Rolled-over candidate texts derived from yesterday (not part of today's content yet).
  rolled: string[];
  onChange: (items: MindItem[]) => void;
}

export default function MindWidget({ title, items, rolled, onChange }: Props) {
  const [draft, setDraft] = useState("");
  const open = items.filter((i) => !i.cleared);

  const add = () => {
    const text = draft.trim();
    if (!text) return;
    onChange([...items, { text, cleared: false }]);
    setDraft("");
  };

  // v4.1 verdicts (#92, plan D7): each open item takes its verdict in place.
  // closed = done with it; letgo = consciously released (stays struck in the
  // record); rolled = still open, marked for tomorrow (the existing rollover
  // derivation carries uncleared items forward).
  const verdict = (text: string, v: "closed" | "letgo" | "rolled") => {
    onChange(items.map((i) =>
      i.text === text ? { ...i, cleared: v !== "rolled", verdict: v } : i,
    ));
  };

  const adopt = (text: string) => {
    onChange([...items, { text, cleared: false }]);
  };

  return (
    <SectionCard title={title} hint="clear by close">
      {open.length === 0 && rolled.length === 0 && (
        <p className="font-mono text-[0.66rem] text-j-muted py-0.5">clear - nothing on your mind</p>
      )}
      <ul>
        {open.map((item) => (
          <li key={item.text} className="group flex items-baseline gap-2 py-0.5 text-[0.9rem]">
            <span className="w-1 h-1 rounded-full bg-j-muted shrink-0 translate-y-[-3px]" aria-hidden="true" />
            <span className="flex-1">
              {item.text}
              {item.verdict === "rolled" && (
                <span className="ml-1.5 font-mono text-[0.58rem] uppercase text-j-muted">-&gt; tomorrow</span>
              )}
            </span>
            <span className="flex items-center opacity-60 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100">
              <button
                onClick={() => verdict(item.text, "closed")}
                aria-label={`Close "${item.text}" (done with this)`}
                title="Closed - done with this"
                className="text-j-muted hover:text-j-accent p-1.5 -my-1.5 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-j-accent rounded"
              >
                <Check size={12} aria-hidden="true" />
              </button>
              <button
                onClick={() => verdict(item.text, "rolled")}
                aria-label={`Roll "${item.text}" to tomorrow`}
                title="Roll to tomorrow"
                className="text-j-muted hover:text-j-ink p-1.5 -my-1.5 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-j-accent rounded"
              >
                <ArrowRight size={12} aria-hidden="true" />
              </button>
              <button
                onClick={() => verdict(item.text, "letgo")}
                aria-label={`Let go of "${item.text}" (kept in the record, struck)`}
                title="Let go - consciously released"
                className="text-j-muted hover:text-j-ink p-1.5 -my-1.5 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-j-accent rounded"
              >
                <X size={12} aria-hidden="true" />
              </button>
            </span>
          </li>
        ))}
        {rolled.map((text) => (
          <li key={`rolled-${text}`} className="flex items-baseline gap-2 py-0.5 text-[0.9rem] text-j-muted">
            <span className="w-1 h-1 rounded-full bg-j-muted/60 shrink-0 translate-y-[-3px]" aria-hidden="true" />
            <span className="flex-1">{text}</span>
            <button
              onClick={() => adopt(text)}
              aria-label={`Keep "${text}" for today`}
              className="rounded-full border border-dashed border-j-muted px-2 py-px font-mono text-[0.58rem] uppercase tracking-wide hover:border-j-accent hover:text-j-accent cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-j-accent"
            >
              rolled · keep?
            </button>
          </li>
        ))}
      </ul>
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && add()}
        onBlur={add}
        placeholder="+ add"
        aria-label={`Add to ${title}`}
        className="w-full bg-transparent text-[0.82rem] text-j-ink placeholder:text-j-muted/70 py-1 focus:outline-none"
      />
    </SectionCard>
  );
}
