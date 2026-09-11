"use client";

// Sage - the companion surface (#87). One conversation per day: a message
// stream, a sticky composer, and inline proposal cards (the trust loop:
// keep / edit / toss). A history calendar (desktop right rail / mobile
// toggle) browses past days read-only - dots mark days with conversations,
// exactly like the journal's calendar. Talks to two backends:
//
//   - /api/companion/chat (same-origin Next.js route): runs one AI turn and
//     streams NDJSON events (text_delta / card / done / error).
//   - the .NET API (via lib/api.ts): session + captures persistence.
//
// Degradability contract: the route saves the user's words BEFORE the AI runs,
// so a mid-turn failure shows a soft notice and loses nothing. Only a transport
// failure (this fetch never reached the route) means unsaved - the composer
// keeps the draft in that case and says so.
//
// Past days are read-only as CONVERSATIONS (no composer), but their proposal
// cards stay fully actionable: the talk is day-bound, the inbox is not.

import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays, X } from "lucide-react";
import {
  confirmCapture,
  dismissCapture,
  getCaptures,
  getCompanionSessionByDate,
  getCompanionSessionDates,
  getProjects,
  getTodayCompanionSession,
  restoreCapture,
  updateCapture,
  type CaptureDto,
  type CompanionMessage,
  type Project,
} from "@/lib/api";
import { dateKey, localIso } from "@/lib/time";
import {
  COMPANION_GREETING,
  COMPANION_NAME,
  STARTER_CHIPS,
} from "@/lib/companion/meta";
import CompanionCalendar from "./CompanionCalendar";
import ProposalCard from "./ProposalCard";
import ReceiptChip from "./ReceiptChip";
import CardsPanel from "./CardsPanel";

// ---------- small shared bits ----------

// Soft SVG sprout glyph - Sage's avatar (no emoji per UX rules).
function SageGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className={className}>
      <path
        d="M12 21v-8M12 13c0-4 2.5-6.5 7-7-.5 4.5-3 7-7 7ZM12 13c0-3-2-5-5.5-5.5.4 3.5 2.5 5.5 5.5 5.5Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function timeLabel(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime())
    ? ""
    : d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// NDJSON events from the chat route (mirrors provider.ts CompanionTurnEvent).
type TurnEvent =
  | { type: "text_delta"; text: string }
  | { type: "card"; capture: CaptureDto }
  // v4.1 (#92): a receipt - the autonomous writers already acted; the chip is
  // an edit/undo affordance, never an approval ask.
  | { type: "receipt"; capture: CaptureDto; entity?: unknown }
  | { type: "done"; sdkSessionId: string | null; text: string; sessionId?: number }
  | { type: "error"; message: string }
  // ping = instant first byte (#90); queued = this send is waiting its turn
  // behind an in-flight one and will be answered in a combined follow-up (#91).
  | { type: "ping" }
  | { type: "queued" };

// The stream interleaves messages and cards by time (cards appear where they
// were proposed, and stay after resolution as the trust-loop record).
type TimelineItem =
  | { kind: "msg"; at: string; msg: CompanionMessage }
  | { kind: "card"; at: string; capture: CaptureDto };

// Month window for the calendar-dots fetch.
function monthRange(anchor: Date): { from: string; to: string } {
  return {
    from: dateKey(new Date(anchor.getFullYear(), anchor.getMonth(), 1)),
    to: dateKey(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1)),
  };
}

// ---------- the surface ----------

export default function CompanionClient() {
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<CompanionMessage[]>([]);
  const [captures, setCaptures] = useState<CaptureDto[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [draft, setDraft] = useState("");
  const [streamText, setStreamText] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [loadError, setLoadError] = useState(false);
  // Two distinct failure copies (see header comment): saved vs not-saved.
  const [turnError, setTurnError] = useState<"ai" | "transport" | null>(null);

  // History browsing (#87 calendar): which day is on screen. Today = live.
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [sessionDates, setSessionDates] = useState<Set<string>>(new Set());
  const [showCalendar, setShowCalendar] = useState(false); // mobile toggle
  const isToday = dateKey(selectedDate) === dateKey(new Date());

  const bottomRef = useRef<HTMLDivElement | null>(null);
  // Bumped whenever the viewed day changes; an in-flight stream captured the
  // old value and must stop touching UI state (review R11 - no bleeding a live
  // turn into a browsed past day). The stream itself keeps draining so the
  // server-side saves complete.
  const dayGenRef = useRef(0);
  // One card action in flight at a time, shared by the inline cards AND the
  // rail/drawer panel (review R5 - the UX half of the double-Keep guard).
  const [actingId, setActingId] = useState<number | null>(null);

  // Load the selected day's conversation (today = the live session).
  const loadDay = useCallback(async (day: Date) => {
    const key = dateKey(day);
    const session =
      key === dateKey(new Date())
        ? await getTodayCompanionSession()
        : await getCompanionSessionByDate(key);
    if (session) {
      setSessionId(session.id);
      setMessages(Array.isArray(session.messages) ? session.messages : []);
      setCaptures(await getCaptures(session.id));
    } else {
      setSessionId(null);
      setMessages([]);
      setCaptures([]);
    }
    setLoadError(false); // a successful load heals a sticky earlier failure (review R36)
  }, []);

  // Mount: projects + today's conversation + this month's calendar dots.
  useEffect(() => {
    (async () => {
      try {
        const now = new Date();
        const { from, to } = monthRange(now);
        const [projectList, dates] = await Promise.all([
          getProjects(),
          getCompanionSessionDates(from, to),
        ]);
        setProjects(projectList);
        setSessionDates(new Set(dates));
        await loadDay(now);
      } catch {
        setLoadError(true);
      }
    })();
  }, [loadDay]);

  const selectDay = useCallback(
    async (day: Date) => {
      dayGenRef.current += 1;
      setSelectedDate(day);
      setShowCalendar(false);
      setTurnError(null);
      try {
        await loadDay(day);
      } catch {
        setLoadError(true);
      }
    },
    [loadDay],
  );

  const onMonthChange = useCallback(async (anchor: Date) => {
    try {
      const { from, to } = monthRange(anchor);
      setSessionDates(new Set(await getCompanionSessionDates(from, to)));
    } catch {
      // dots are decoration; a failed month fetch must not break the page
    }
  }, []);

  // Drawer a11y (design review D1): Escape closes, and focus lands inside the
  // dialog when it opens so keyboard users are not left stranded behind it.
  const drawerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!showCalendar) return;
    drawerRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setShowCalendar(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showCalendar]);

  // Keep the latest turn in view as text streams in (today only).
  useEffect(() => {
    if (isToday) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, streamText, captures.length, isToday]);

  // Crossing messages are allowed (#91): sends during a live turn queue
  // server-side and drain as one combined reply. Track in-flight requests with
  // a counter so `sending` only clears when ALL of them finish.
  const inFlightRef = useRef(0);
  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (text === "") return;
      inFlightRef.current += 1;
      setSending(true);
      setTurnError(null);
      setDraft("");
      setMessages((prev) => [
        ...prev,
        { role: "user", content: text, at: localIso() },
      ]);
      setStreamText("");

      let response: Response;
      try {
        response = await fetch("/api/companion/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: text }),
        });
        if (!response.ok || !response.body) throw new Error(String(response.status));
      } catch {
        // Never reached the route: the message was NOT saved. Give the words back.
        setMessages((prev) => prev.slice(0, -1));
        setDraft(raw);
        setStreamText(null);
        setTurnError("transport");
        inFlightRef.current -= 1;
        setSending(inFlightRef.current > 0);
        return;
      }

      let acc = "";
      let sawDelta = false;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      // The generation this turn belongs to: if the user browses to another day
      // mid-stream, gen goes stale and this loop stops touching UI state while
      // still draining the stream (the route finishes its saves regardless).
      const gen = dayGenRef.current;
      const live = () => dayGenRef.current === gen;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (line.trim() === "") continue;
            let event: TurnEvent;
            try {
              event = JSON.parse(line) as TurnEvent;
            } catch {
              continue;
            }
            if (!live()) continue;
            if (event.type === "text_delta") {
              acc += event.text;
              sawDelta = true;
              setStreamText(acc);
            } else if (event.type === "card" || event.type === "receipt") {
              // Upsert by id: Sage can UPDATE a proposed card mid-conversation
              // ("put that in its own project") and it must morph in place.
              setCaptures((prev) =>
                prev.some((c) => c.id === event.capture.id)
                  ? prev.map((c) => (c.id === event.capture.id ? event.capture : c))
                  : [...prev, event.capture],
              );
            } else if (event.type === "done") {
              if (typeof event.sessionId === "number") {
                if (sessionId !== null && event.sessionId !== sessionId) {
                  // Day rolled over mid-conversation (a 23:58 -> 00:02 send):
                  // this turn landed in a NEW daily session. Reload today so
                  // the screen matches the DB instead of stitching two days
                  // into one thread (review R10).
                  setStreamText(null);
                  void selectDay(new Date());
                  continue;
                }
                setSessionId(event.sessionId);
                // First message of the day: light today's calendar dot.
                setSessionDates((prev) => new Set(prev).add(dateKey(new Date())));
              }
              const finalText = event.text || acc;
              if (finalText) {
                setMessages((prev) => [
                  ...prev,
                  { role: "assistant", content: finalText, at: localIso() },
                ]);
              }
              acc = ""; // a drain turn may follow on this same stream (#91)
              setStreamText(null);
            } else if (event.type === "error") {
              // The route saved the user's words (and any partial reply) first.
              if (acc) {
                setMessages((prev) => [
                  ...prev,
                  { role: "assistant", content: acc, at: localIso() },
                ]);
              }
              acc = "";
              setStreamText(null);
              setTurnError("ai");
              // Cards created before the failure exist in the DB but their
              // stream events may never have arrived - reconcile so the user
              // sees what Sage will be told about next turn (review R22).
              if (sessionId !== null) {
                getCaptures(sessionId)
                  .then((c) => { if (live()) setCaptures(c); })
                  .catch(() => {});
              }
            }
          }
        }
      } catch {
        // Mid-stream drop (WiFi blip, route crash): the words were saved before
        // the AI ran, so the calm copy is the true one (review R13/R8-mobile).
        if (live()) setTurnError("ai");
      } finally {
        // Only the request that actually streamed may clear the thinking
        // indicator - a queued send's stream ends instantly and must not
        // clobber the live one's (#91).
        if (live() && sawDelta) setStreamText(null);
        inFlightRef.current -= 1;
        setSending(inFlightRef.current > 0);
      }
    },
    [sessionId, selectDay],
  );

  // ---- trust-loop actions (shared state update) ----
  const swapCapture = (updated: CaptureDto) =>
    setCaptures((prev) => prev.map((c) => (c.id === updated.id ? updated : c)));

  // Every card action runs through one gate: while any is in flight, all card
  // buttons everywhere are disabled (review R5). Errors rethrow so the calling
  // view (card or panel) can display them.
  const acting = async (id: number, fn: () => Promise<void>) => {
    if (actingId !== null) return;
    setActingId(id);
    try {
      await fn();
    } finally {
      setActingId(null);
    }
  };
  const keep = (id: number) =>
    acting(id, async () => swapCapture((await confirmCapture(id)).capture));
  const toss = (id: number) =>
    acting(id, async () => swapCapture(await dismissCapture(id)));

  // Undo a v4.1 receipt (#92): dismiss on a CONFIRMED capture reverses the
  // entity server-side, then the chip re-renders struck-through.
  const undoReceipt = async (id: number) =>
    swapCapture(await dismissCapture(id));
  const restore = (id: number) =>
    acting(id, async () => swapCapture(await restoreCapture(id)));
  const saveEdit = (id: number, payload: CaptureDto["payload"]) =>
    acting(id, async () => swapCapture(await updateCapture(id, payload)));

  // ---- timeline: messages + cards interleaved by real time ----
  // Parse-based comparison: transcripts contain both legacy UTC "Z" strings
  // (pre-fix) and local no-suffix strings - string compare would mis-order them.
  const timeline: TimelineItem[] = [
    ...messages.map((m) => ({ kind: "msg" as const, at: m.at, msg: m })),
    ...captures.map((c) => ({ kind: "card" as const, at: c.createdAt, capture: c })),
  ].sort((a, b) => (new Date(a.at).getTime() || 0) - (new Date(b.at).getTime() || 0));

  const empty = timeline.length === 0 && streamText === null;
  const dayLabel = selectedDate.toLocaleDateString([], {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  const calendar = (
    <CompanionCalendar
      selected={selectedDate}
      sessionDates={sessionDates}
      onSelect={(d) => void selectDay(d)}
      onMonthChange={(a) => void onMonthChange(a)}
    />
  );

  const cardsPanel = (
    <CardsPanel
      captures={captures}
      projects={projects}
      actingId={actingId}
      onKeep={keep}
      onToss={toss}
      onRestore={restore}
    />
  );

  return (
    <div className="max-w-5xl mx-auto lg:flex lg:items-start lg:gap-4">
      {/* Chat panel */}
      <div className="flex-1 max-w-2xl mx-auto lg:mx-0 rounded-2xl bg-c-bg text-c-ink -mx-2 sm:mx-auto min-h-[70vh] flex flex-col">
        {/* Daily header */}
        <div className="flex items-center gap-3 px-4 sm:px-6 pt-5 pb-3 border-b border-c-line">
          <span className="w-9 h-9 rounded-full bg-c-accent-soft text-c-accent flex items-center justify-center">
            <SageGlyph className="w-5 h-5" />
          </span>
          <div className="flex-1">
            <h1 className="font-heading text-lg font-semibold leading-tight">{COMPANION_NAME}</h1>
            <p className="text-xs text-c-muted">
              {dayLabel}
              {isToday ? " · a new thread each day" : " · looking back"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowCalendar((v) => !v)}
            aria-label="Open calendar and cards"
            aria-expanded={showCalendar}
            className="lg:hidden min-h-11 min-w-11 flex items-center justify-center rounded-lg text-c-muted hover:text-c-ink hover:bg-c-accent-soft cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-c-accent"
          >
            <CalendarDays size={20} aria-hidden="true" />
          </button>
        </div>

        {/* Mobile pull-out (right drawer): calendar + cards. Desktop uses the
            sticky rail instead. Plain fixed is safe here - no transformed
            ancestor on this page (the /time-sheet precedent). */}
        {showCalendar && (
          <div
            className="lg:hidden fixed inset-0 z-40"
            role="dialog"
            aria-modal="true"
            aria-label="Calendar and cards"
          >
            <div
              className="absolute inset-0 bg-black/30"
              onClick={() => setShowCalendar(false)}
              aria-hidden="true"
            />
            <div
              ref={drawerRef}
              tabIndex={-1}
              className="absolute right-0 top-0 bottom-0 w-[85vw] max-w-sm bg-c-bg border-l border-c-line p-4 space-y-4 overflow-y-auto focus:outline-none"
            >
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowCalendar(false)}
                  aria-label="Close calendar and cards"
                  className="min-h-11 min-w-11 flex items-center justify-center rounded-lg text-c-muted hover:text-c-ink hover:bg-c-accent-soft cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-c-accent"
                >
                  <X size={18} aria-hidden="true" />
                </button>
              </div>
              {calendar}
              {cardsPanel}
            </div>
          </div>
        )}

        {loadError && (
          <div className="mx-4 sm:mx-6 mt-4 rounded-xl border border-c-line bg-c-card px-4 py-3 text-sm text-c-ink">
            Tasklog&apos;s API is unreachable, so the conversation can&apos;t load or save right
            now. Check that the backend is running, then reload.
          </div>
        )}

        {/* Stream */}
        <div className="flex-1 px-4 sm:px-6 py-5 space-y-4">
          {empty && isToday && (
            <div className="pt-6 text-center">
              <span className="inline-flex w-12 h-12 rounded-full bg-c-accent-soft text-c-accent items-center justify-center">
                <SageGlyph className="w-6 h-6" />
              </span>
              <p className="mt-3 text-base text-c-ink max-w-[38ch] mx-auto">{COMPANION_GREETING}</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {STARTER_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    disabled={sending || loadError}
                    onClick={() => send(chip)}
                    className="min-h-11 px-4 rounded-full border border-c-line bg-c-card text-sm text-c-ink cursor-pointer transition-colors duration-150 hover:bg-c-accent-soft disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-c-accent"
                  >
                    {chip}
                  </button>
                ))}
              </div>
            </div>
          )}

          {empty && !isToday && (
            <p className="pt-8 text-center text-sm text-c-muted">
              No conversation on {dayLabel}.
            </p>
          )}

          {timeline.map((item, i) =>
            item.kind === "msg" ? (
              <div
                key={`m-${i}`}
                className={item.msg.role === "user" ? "flex justify-end" : "flex justify-start"}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-base leading-relaxed whitespace-pre-wrap ${
                    item.msg.role === "user"
                      ? "bg-c-accent-soft text-c-ink rounded-br-md"
                      : "bg-c-card border border-c-line text-c-ink rounded-bl-md"
                  }`}
                >
                  {item.msg.content}
                  <span className="block text-[10px] text-c-muted mt-1 text-right">
                    {timeLabel(item.at)}
                  </span>
                </div>
              </div>
            ) : item.capture.type !== "task" || item.capture.status === "confirmed" ? (
              // v4.1 receipts (#92): Sage already acted - render the compact
              // chip (undo inside), never an approval card. Confirmed task
              // rows are receipts too under the autonomous flow.
              <ReceiptChip
                key={`c-${item.capture.id}`}
                capture={item.capture}
                onUndo={undoReceipt}
              />
            ) : (
              <div key={`c-${item.capture.id}`} className="flex justify-start">
                <div className="max-w-[85%] w-full sm:w-[85%]">
                  <ProposalCard
                    capture={item.capture}
                    projects={projects}
                    actingId={actingId}
                    onKeep={keep}
                    onToss={toss}
                    onRestore={restore}
                    onSaveEdit={saveEdit}
                  />
                </div>
              </div>
            ),
          )}

          {/* Live assistant turn */}
          {streamText !== null && (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-c-card border border-c-line px-4 py-2.5 text-base leading-relaxed whitespace-pre-wrap">
                {streamText === "" ? (
                  <span className="inline-flex items-center gap-1.5 text-c-muted text-sm" aria-label={`${COMPANION_NAME} is thinking`}>
                    {COMPANION_NAME} is thinking
                    <span className="inline-flex gap-0.5 motion-safe:animate-pulse" aria-hidden="true">
                      <span>·</span><span>·</span><span>·</span>
                    </span>
                  </span>
                ) : (
                  streamText
                )}
              </div>
            </div>
          )}

          {turnError === "ai" && (
            <p className="text-sm text-c-muted text-center">
              {COMPANION_NAME} is unreachable right now. Your words are saved - try again in a bit.
            </p>
          )}
          {turnError === "transport" && (
            <p className="text-sm text-danger text-center">
              Couldn&apos;t reach the companion, so that message was NOT saved. It&apos;s back in
              the box below.
            </p>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Composer (today) / back-to-today bar (history) */}
        {isToday ? (
          <div className="sticky bottom-2 px-4 sm:px-6 pb-2 pt-1 bg-c-bg/95 backdrop-blur-sm rounded-b-2xl">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send(draft);
              }}
              className="flex items-end gap-2"
            >
              <label htmlFor="companion-input" className="sr-only">
                Message {COMPANION_NAME}
              </label>
              <textarea
                id="companion-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send(draft);
                  }
                }}
                rows={draft.includes("\n") ? 3 : 1}
                placeholder={`Talk to ${COMPANION_NAME}...`}
                disabled={loadError}
                className="flex-1 resize-none rounded-2xl border border-c-line bg-c-card px-4 py-3 text-base text-c-ink placeholder:text-c-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-c-accent disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={draft.trim() === "" || loadError}
                aria-label={`Send to ${COMPANION_NAME}`}
                className="min-h-11 min-w-11 rounded-full bg-c-accent text-white flex items-center justify-center disabled:opacity-50 cursor-pointer transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-c-accent"
              >
                <svg viewBox="0 0 20 20" className="w-5 h-5" fill="none" aria-hidden="true">
                  <path d="M3 10h13M11 5l5 5-5 5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </form>
          </div>
        ) : (
          <div className="sticky bottom-2 px-4 sm:px-6 pb-3 pt-1 bg-c-bg/95 backdrop-blur-sm rounded-b-2xl">
            <button
              type="button"
              onClick={() => void selectDay(new Date())}
              className="w-full min-h-11 rounded-2xl border border-c-line bg-c-card text-sm text-c-ink cursor-pointer hover:bg-c-accent-soft transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-c-accent"
            >
              Viewing {dayLabel} - back to today
            </button>
          </div>
        )}
      </div>

      {/* Desktop rail: sticky so calendar + cards stay in reach while the
          conversation scrolls (the "cards scroll away" fix). Dashboard-y
          additions (stats etc.) are a later, backlogged idea. */}
      <aside className="hidden lg:block w-64 shrink-0 pt-1 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6.5rem)] lg:overflow-y-auto space-y-3 lg:pb-20">
        {calendar}
        {cardsPanel}
        <p className="px-1 text-xs text-c-muted">
          A dot marks a day you talked. Past days are read-only; their suggestion
          cards stay actionable.
        </p>
      </aside>
    </div>
  );
}
