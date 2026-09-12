"use client";

// The goal's popup (v4.1 Stage B, mockup pin 8 + the locked goal entity):
// timespan tier, the why, progress with a manual nudge, dated expectation
// history, the smallest door. Every field optional - a goal is born from one
// line and deepens here, never through a form up front.

import { useState } from "react";
import { type GoalDto, updateGoal } from "@/lib/api";

const TIMESPANS = ["10Y", "5Y", "3Y", "1Y", "6M", "3M", "1M"];

export default function GoalPopup({
  goal,
  onClose,
  onSaved,
}: {
  goal: GoalDto;
  onClose: () => void;
  onSaved: (g: GoalDto) => void;
}) {
  const [why, setWhy] = useState(goal.why ?? "");
  const [timespan, setTimespan] = useState(goal.timespan ?? "");
  const [door, setDoor] = useState(goal.door ?? "");
  const [expectation, setExpectation] = useState("");
  const [progress, setProgress] = useState(goal.progress);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const expectations = (() => {
    try {
      return JSON.parse(goal.expectationsJson) as { at: string; text: string }[];
    } catch {
      return [];
    }
  })();
  const current = expectations.length > 0 ? expectations[expectations.length - 1] : null;

  const save = async (patch: Parameters<typeof updateGoal>[1]) => {
    setBusy(true);
    setError(null);
    try {
      onSaved(await updateGoal(goal.id, patch));
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={goal.title}
    >
      <div
        className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl bg-surface border border-border p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <p className="text-[11px] uppercase tracking-wider text-text-muted">
            goal · {goal.status}
            {goal.timespan ? ` · ${goal.timespan}` : ""}
          </p>
          <h3 className="font-heading text-lg font-semibold text-text-primary">{goal.title}</h3>
        </div>

        {/* Progress: derived someday, always nudgeable now - the bar must not
            argue when the evidence lags reality. */}
        <div>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-2 rounded-full bg-surface-raised overflow-hidden">
              <div className="h-full rounded-full bg-accent" style={{ width: `${progress}%` }} />
            </div>
            <span className="text-sm tabular-nums text-text-muted w-10 text-right">{progress}%</span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              type="range"
              min={0}
              max={100}
              value={progress}
              onChange={(e) => setProgress(Number(e.target.value))}
              className="flex-1 accent-[var(--color-accent,#2563EB)]"
              aria-label="Nudge progress"
            />
            <button
              type="button"
              disabled={busy || progress === goal.progress}
              onClick={() => save({ progress })}
              className="rounded-lg border border-border px-2.5 py-1 text-xs text-accent hover:border-accent disabled:opacity-40 cursor-pointer"
            >
              nudge
            </button>
          </div>
        </div>

        <label className="block text-sm">
          <span className="text-[11px] uppercase tracking-wider text-text-muted">Why · one line</span>
          <input
            value={why}
            onChange={(e) => setWhy(e.target.value)}
            onBlur={() => why !== (goal.why ?? "") && save({ why })}
            placeholder="never demanded - filled when it wants to be"
            className="mt-1 w-full rounded-lg border border-border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </label>

        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-wider text-text-muted">Timespan</span>
          {TIMESPANS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => {
                setTimespan(t);
                void save({ timespan: t });
              }}
              className={`rounded-full border px-2 py-0.5 text-xs cursor-pointer ${
                timespan === t
                  ? "border-accent text-accent bg-surface-raised"
                  : "border-border text-text-muted hover:border-text-muted"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div>
          <span className="text-[11px] uppercase tracking-wider text-text-muted">Expectation · revisions archive</span>
          {current && (
            <p className="text-sm text-text-primary mt-0.5">
              {current.text} <span className="text-xs text-text-muted/70">({current.at})</span>
            </p>
          )}
          <div className="mt-1 flex gap-2">
            <input
              value={expectation}
              onChange={(e) => setExpectation(e.target.value)}
              placeholder="revise what success looks like…"
              className="flex-1 rounded-lg border border-border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <button
              type="button"
              disabled={busy || !expectation.trim()}
              onClick={() => {
                void save({ expectation: expectation.trim() });
                setExpectation("");
              }}
              className="rounded-lg border border-border px-2.5 py-1 text-xs text-accent hover:border-accent disabled:opacity-40 cursor-pointer"
            >
              revise
            </button>
          </div>
          {expectations.length > 1 && (
            <details className="mt-1 text-xs text-text-muted">
              <summary className="cursor-pointer">previous expectations ({expectations.length - 1})</summary>
              {expectations.slice(0, -1).reverse().map((x, i) => (
                <p key={i} className="mt-0.5 pl-3 border-l-2 border-border">
                  <b>{x.at}</b> - {x.text}
                </p>
              ))}
            </details>
          )}
        </div>

        <label className="block text-sm">
          <span className="text-[11px] uppercase tracking-wider text-text-muted">The smallest door · 5 minutes, never owes completion</span>
          <input
            value={door}
            onChange={(e) => setDoor(e.target.value)}
            onBlur={() => door !== (goal.door ?? "") && save({ door })}
            placeholder="the next 5-minute action"
            className="mt-1 w-full rounded-lg border border-border px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-accent"
          />
        </label>

        <div className="flex items-center gap-2 pt-1">
          {goal.status !== "done" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => save({ status: "done" })}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-green-700 hover:border-green-600 cursor-pointer"
            >
              done ✓
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => save({ status: goal.status === "parked" ? "active" : "parked" })}
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-muted hover:border-text-muted cursor-pointer"
          >
            {goal.status === "parked" ? "unpark" : "park"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-lg border border-border px-3 py-1.5 text-xs text-text-muted hover:text-text-primary cursor-pointer"
          >
            close
          </button>
        </div>
        {error && <p className="text-xs text-red-600" role="alert">{error}</p>}
      </div>
    </div>
  );
}
