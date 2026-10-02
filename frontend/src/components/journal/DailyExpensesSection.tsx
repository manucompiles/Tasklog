"use client";

// Daily expenses (#92, pin 10/16): structured rows in the day's record - what
// today cost, with split state. Read model only; rows are born from speech
// (Sage) or the manual API, and appear here day-matched. Renders nothing on a
// money-quiet day (optional everything).

import type { ExpenseDto } from "@/lib/api";
import SectionCard from "./SectionCard";

interface Props {
  expenses: ExpenseDto[];
}

function splitChip(raw: string): string | null {
  try {
    const s = JSON.parse(raw) as { with?: string; share?: number; settled?: boolean };
    if (!s.with) return null;
    return s.settled ? `split with ${s.with} · settled` : `${s.with} owes ${s.share?.toLocaleString("en-IN") ?? "half"}`;
  } catch {
    return null;
  }
}

export default function DailyExpensesSection({ expenses }: Props) {
  if (expenses.length === 0) return null;
  const total = expenses.reduce((sum, x) => sum + (x.direction === "in" ? -x.amount : x.amount), 0);

  return (
    <SectionCard title="Daily expenses" hint="day-matched, from the money log">
      <ul className="divide-y divide-j-line">
        {expenses.map((x) => {
          const chip = splitChip(x.splitJson);
          return (
            <li key={x.id} className="flex items-baseline gap-3 py-1.5 text-sm">
              <span className="font-mono tabular-nums w-20 shrink-0 text-right text-j-ink">
                {x.direction === "in" ? "+" : "-"}
                {x.amount.toLocaleString("en-IN")}
              </span>
              <span className="flex-1 min-w-0 truncate text-j-ink">{x.note}</span>
              {chip && (
                <span className="shrink-0 font-mono text-[0.62rem] text-j-muted border border-j-line rounded-full px-2 py-0.5">
                  {chip}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="flex items-baseline gap-3 pt-2 mt-1 border-t border-j-line text-sm">
        <span className="font-mono tabular-nums w-20 shrink-0 text-right font-semibold text-j-ink">
          -{total.toLocaleString("en-IN")}
        </span>
        <span className="text-j-muted">total today</span>
      </p>
    </SectionCard>
  );
}
