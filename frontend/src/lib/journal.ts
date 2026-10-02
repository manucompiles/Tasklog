// Journal content shapes + pure helpers (#79).
//
// A JournalEntryDto's `content` is an object keyed by section key; the value shape
// depends on the section kind defined in the template. These types are the client-side
// contract for those shapes (the backend stores them opaquely and the markdown renderer
// mirrors them in Services/JournalMarkdown.cs - change both together).

import { MoodCheckinDto } from "./api";

// kind: "prose" -> string
// kind: "projects" -> ProjectFocus[]
// kind: "plan" -> PlanContent
// kind: "mind" -> MindItem[]
// kind: "evening" -> EveningContent
// kind: "list" -> string[]

export interface ProjectFocus {
  name: string;
  focus: string;
}

// Plan bucket keys are fixed (they mirror JournalMarkdown.PlanBuckets).
export const PLAN_BUCKETS = [
  { key: "non_negotiable", title: "Non-negotiable" },
  { key: "if_energy", title: "If energy allows" },
  { key: "easy_wins", title: "Easy wins" },
] as const;
export type PlanBucketKey = (typeof PLAN_BUCKETS)[number]["key"];

export interface PlanContent {
  buckets: Record<PlanBucketKey, number[]>; // task ids per bucket
}

export function emptyPlan(): PlanContent {
  return { buckets: { non_negotiable: [], if_energy: [], easy_wins: [] } };
}

// A transient Front/Back-of-Mind item. Cleared = consciously closed (stays in the day's
// record, renders struck-through in markdown). Uncleared items surface tomorrow as
// "rolled over" candidates.
export interface MindItem {
  text: string;
  cleared: boolean;
  // v4.1 (#92, plan D7): how the item was closed at the evening ceremony -
  // "closed" (done), "letgo" (consciously released, renders struck), or
  // "rolled" (still open, marked for tomorrow; the existing rollover
  // derivation carries it forward). Absent on plain adds/clears.
  verdict?: "closed" | "letgo" | "rolled";
}

// Evening review's typed fields (emotion shift + energy EOD are derived, never stored).
export const EVENING_FIELDS = [
  { key: "whatDroveIt", label: "What drove it" },
  { key: "whatMovedForward", label: "What moved forward" },
  { key: "whatSlowedYouDown", label: "What slowed you down" },
  { key: "patternNoticed", label: "Pattern noticed" },
  { key: "oneSmallAdjustment", label: "One small adjustment" },
  { key: "closeTheTabs", label: "Close the tabs" },
  { key: "justNoticing", label: "Just noticing" },
] as const;
export type EveningFieldKey = (typeof EVENING_FIELDS)[number]["key"];
export type EveningContent = Partial<Record<EveningFieldKey, string>>;

// ---------- derived values ----------

// Emotion shift, derived from the day's first and last check-ins. Null until the
// first check-in exists; `to` is null until a second one does.
export function moodShift(
  checkins: MoodCheckinDto[],
): { from: string; to: string | null } | null {
  if (checkins.length === 0) return null;
  const from = checkins[0].words[0] ?? "";
  const to = checkins.length > 1 ? (checkins[checkins.length - 1].words[0] ?? "") : null;
  return { from, to };
}

// Energy at end of day = the last check-in's energy, only once a second check-in exists
// (a single morning check-in is not an EOD reading).
export function energyEod(checkins: MoodCheckinDto[]): number | null {
  return checkins.length > 1 ? checkins[checkins.length - 1].energy : null;
}

// Yesterday's uncleared Front/Back-of-Mind items that today hasn't adopted or written
// itself - shown as "rolled over - keep?" candidates. Matching is by exact text: adopting
// copies the text into today, which removes it from this list on the next derivation.
export function rolloverCandidates(
  yesterday: MindItem[] | undefined,
  today: MindItem[],
): string[] {
  if (!yesterday) return [];
  const todayTexts = new Set(today.map((i) => i.text));
  return yesterday
    .filter((i) => !i.cleared && !todayTexts.has(i.text))
    .map((i) => i.text);
}

// ---------- date helpers ----------
// (yyyy-MM-dd keys come from lib/time.ts dateKey() - local calendar, never toISOString.)

// "HH:mm" from a local ISO datetime string, for check-in rows and the arc's x-axis.
export function timeOfDayLabel(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Fraction of the day elapsed (0..1) for a local ISO datetime - the arc's x position.
export function dayFraction(iso: string): number {
  const d = new Date(iso);
  return (d.getHours() + d.getMinutes() / 60) / 24;
}
