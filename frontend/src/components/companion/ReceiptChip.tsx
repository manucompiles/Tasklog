"use client";

// One receipt chip (#92, plan D1) - the autonomous trust loop's affordance.
// Sage already DID the thing; this compact line says what, and opens undo.
// Never an approval ask: the entity exists, the chip is the record. Follows
// ProposalCard's extraction pattern - state with the parent, render + call back.

import { useState } from "react";
import { type CaptureDto } from "@/lib/api";
import { COMPANION_NAME } from "@/lib/companion/meta";

// A compact human line per capture type - what the receipt says Sage did.
export function receiptLabel(c: CaptureDto): string {
  const p = c.payload;
  switch (c.type) {
    case "task":
      return `task · ${p.title ?? ""}`;
    case "mood":
      return `mood · ${(p.words ?? []).join(", ")}${p.energy !== undefined ? ` · E${p.energy}` : ""}`;
    case "thought":
      return `${p.kind ?? "note"} · ${p.title ?? ""}`;
    case "expense":
      return `expense · ${p.direction === "in" ? "+" : "-"}${p.amount ?? 0} ${p.note ?? ""}`;
    case "time": {
      const what = p.description ?? "";
      if (p.op === "start") return `timer started${what ? ` · ${what}` : ""}`;
      if (p.op === "stop") return "timer stopped";
      if (p.op === "edit") return `time entry adjusted${what ? ` · ${what}` : ""}`;
      return `time logged${what ? ` · ${what}` : ""}`;
    }
    case "note":
      return `journal woven · ${Object.keys(p.sections ?? {}).join(", ")}`;
    default:
      return c.type;
  }
}

export default function ReceiptChip({
  capture,
  onUndo,
}: {
  capture: CaptureDto;
  onUndo: (id: number) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const undone = capture.status === "dismissed";
  // A journal weave cannot be undone wholesale (the journal is edited instead).
  const undoable = !undone && capture.type !== "note";

  return (
    <div className="my-1 flex justify-start">
      <div
        className={`inline-flex max-w-full items-center gap-2 rounded-full border px-3 py-1 text-xs ${
          undone
            ? "border-c-line text-c-muted line-through"
            : "border-c-line bg-c-card text-c-muted"
        }`}
      >
        <button
          type="button"
          className="truncate hover:text-c-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-c-accent"
          onClick={() => setOpen((v) => !v)}
          title={capture.span ? `from: "${capture.span}"` : undefined}
        >
          {receiptLabel(capture)}
        </button>
        {open && undoable && (
          <button
            type="button"
            disabled={busy}
            className="shrink-0 rounded-full border border-c-line px-2 py-0.5 hover:border-c-accent hover:text-c-ink disabled:opacity-50"
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onUndo(capture.id);
              } catch (e) {
                setError(e instanceof Error ? e.message : "undo failed");
              } finally {
                setBusy(false);
              }
            }}
          >
            undo
          </button>
        )}
        {open && !undoable && !undone && (
          <span className="shrink-0 opacity-70">edit in Journal</span>
        )}
        {undone && <span className="shrink-0">undone</span>}
      </div>
      {error && (
        <p className="ml-2 self-center text-xs text-red-500" role="alert">
          {COMPANION_NAME} could not undo that: {error}
        </p>
      )}
    </div>
  );
}
