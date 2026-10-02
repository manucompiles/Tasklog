"use client";

// Evening review (#79): the resilient floor of the day - fixed fields that survive even
// collapse days. Emotion shift and energy-EOD are DERIVED from the day's check-ins
// (renderer mirrors this), so the ritual costs a few short answers, nothing more.

import { MoodCheckinDto } from "@/lib/api";
import { EVENING_FIELDS, EveningContent, moodShift, energyEod } from "@/lib/journal";
import SectionCard from "./SectionCard";

interface Props {
  title: string;
  value: EveningContent;
  checkins: MoodCheckinDto[];
  onChange: (value: EveningContent) => void;
  // v4.1 (#92, pin 16): the ceremony opens with the ledger's answer, not a
  // question - What Moved argues with despair using facts; What Came Back is
  // the honest boost line. Both derived by the page; empty strings hide them.
  movedLine?: string;
  cameBackLine?: string;
}

export default function EveningSection({ title, value, checkins, onChange, movedLine, cameBackLine }: Props) {
  const shift = moodShift(checkins);
  const eod = energyEod(checkins);

  return (
    <SectionCard title={title} marked>
      {movedLine && (
        <p className="mb-2 rounded-lg border border-j-accent/40 bg-j-accent-soft/40 px-3 py-2 text-sm text-j-ink">
          <b className="font-semibold">What moved:</b> {movedLine}{" "}
          <span className="font-mono text-[0.6rem] text-j-muted">auto</span>
        </p>
      )}
      {cameBackLine && (
        <p className="mb-3 rounded-lg border border-j-line bg-j-card px-3 py-2 text-sm text-j-ink">
          <b className="font-semibold">What came back:</b> {cameBackLine}{" "}
          <span className="font-mono text-[0.6rem] text-j-muted">auto</span>
        </p>
      )}
      <dl>
        <Row label="Emotion shift">
          <span className="text-sm text-j-muted">
            {shift === null ? (
              "log a check-in first"
            ) : shift.to === null ? (
              <><b className="text-j-ink font-semibold">{shift.from}</b> → log an evening check-in</>
            ) : (
              <><b className="text-j-ink font-semibold">{shift.from}</b> → <b className="text-j-ink font-semibold">{shift.to}</b> · derived</>
            )}
          </span>
        </Row>
        {EVENING_FIELDS.map(({ key, label }) => (
          <Row key={key} label={label}>
            <input
              value={value[key] ?? ""}
              onChange={(e) => onChange({ ...value, [key]: e.target.value })}
              placeholder={key === "closeTheTabs" ? "what carries to tomorrow" : key === "justNoticing" ? "one line only" : "…"}
              aria-label={label}
              className="w-full bg-transparent font-journal-serif text-[0.96rem] text-j-ink placeholder:text-j-muted/60 focus:outline-none"
            />
          </Row>
        ))}
        <Row label="Energy at EOD" last>
          <span className="text-sm text-j-muted">
            {eod === null ? "from your evening check-in" : <><b className="text-j-ink font-semibold">{eod}</b> · from last check-in</>}
          </span>
        </Row>
      </dl>
    </SectionCard>
  );
}

function Row({ label, children, last }: { label: string; children: React.ReactNode; last?: boolean }) {
  return (
    <div className={`grid grid-cols-1 sm:grid-cols-[170px_1fr] gap-x-4 gap-y-0.5 items-baseline py-1.5 ${last ? "" : "border-b border-dashed border-j-line"}`}>
      <dt className="font-mono text-[0.64rem] uppercase tracking-[0.1em] text-j-muted">{label}</dt>
      <dd className="m-0">{children}</dd>
    </div>
  );
}
