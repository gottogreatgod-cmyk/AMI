"use client";

// ---------------------------------------------------------------------------
// AMI ANALYST — Grok-style live desk briefing panel (task 6-b).
//
//   header      : title, LIVE DESK BRIEFING chip, generatedAt, refresh
//                 countdown (1s tick), LLM status chip, manual refresh
//   left column : markdown briefing feed (auto-renews), market pulse table,
//                 engine signals strip
//   right column: FX sessions + data-day board, event risk / US news board
//   full width  : per-market confluence board (centerpiece)
//
// One fetch (`/api/analyst`, 60s usePolling loop) drives everything; the 1s
// countdowns are computed from a local clock state and never retrigger the
// fetch. All timestamps render in the user's local time.
// ---------------------------------------------------------------------------

import { memo, useEffect, useMemo, useState } from "react";
import Markdown from "react-markdown";
import {
  Activity,
  AlertTriangle,
  CalendarClock,
  Clock,
  Gauge,
  Layers,
  Minus,
  Newspaper,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  fmtCountdown,
  fmtDate,
  fmtPct,
  fmtPrice,
  fmtTime,
  localTzOffsetMin,
  pnlClass,
  usePolling,
} from "./hooks";

// ---------------------------------------------------------------------------
// API contract types (GET /api/analyst?tz=...)
// ---------------------------------------------------------------------------

type Impact = "High" | "Medium" | "Low" | "Holiday";
type VolRegime = "ELEVATED" | "NORMAL" | "QUIET" | "N/A";
type TrendState = "bull" | "bear" | "neutral";

interface CalendarEvent {
  id: string;
  title: string;
  country: string;
  date: string;
  ts: number;
  impact: Impact;
  forecast: string;
  previous: string;
}

interface TrendVote {
  tf: "1w" | "1d" | "4h";
  state: TrendState;
}

interface MarketPulse {
  symbol: string;
  name: string;
  assetClass: string;
  price: number;
  changePct: number | null;
  rv14: number | null;
  volRegime: VolRegime;
  trend: TrendVote[];
  trendScore: number;
  atrPct1d: number | null;
  donchian20Upper: number | null;
  donchian20Lower: number | null;
  dataAsOf: number;
}

interface ConfluenceEvent {
  title: string;
  country: string;
  impact: string;
  ts: number;
  inHours: number;
  forecast?: string;
  previous?: string;
}

interface Confluence {
  symbol: string;
  name: string;
  assetClass: string;
  bias: "bullish" | "bearish" | "neutral";
  strength: "STRONG" | "MILD" | "NONE";
  trendScore: number;
  volRegime: string;
  eventRisk: { level: "HIGH" | "MEDIUM" | "NONE"; events: ConfluenceEvent[] };
  vixBackdrop: number | null;
  notes: string[];
  implication: string;
}

interface SessionSlot {
  name: string;
  hours: string;
  open: boolean;
  opensInMin: number | null;
  closesInMin: number | null;
}

interface DataDay {
  date: string;
  dayName: string;
  forex: boolean;
  futures: boolean;
  note: string;
}

interface SessionBoard {
  asOf?: number;
  utc: string;
  sessions: SessionSlot[];
  forexOpen: boolean;
  futuresOpen: boolean;
  forexNote: string;
  futuresNote: string;
  dataDays: DataDay[];
}

interface CalendarDigest {
  today: CalendarEvent[];
  tomorrow: CalendarEvent[];
  thisWeek: CalendarEvent[];
  nextHighImpact: CalendarEvent[];
  usdToday: CalendarEvent[];
  usdTomorrow: CalendarEvent[];
  usdThisWeek: CalendarEvent[];
}

interface EngineSignal {
  symbol: string;
  strategy: string;
  tf: string;
  bias: string | null;
  htfState: string;
  atrPct: number;
}

interface AnalystResponse {
  generatedAt: number;
  briefing: string;
  llm: { used: boolean; latencyMs: number; note: string | null };
  pulses: MarketPulse[];
  confluences: Confluence[];
  sessions: SessionBoard;
  calendar: CalendarDigest;
  signals: EngineSignal[];
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

const POLL_MS = 60_000;
const STRENGTH_RANK: Record<string, number> = { STRONG: 0, MILD: 1, NONE: 2 };

type PillTone = "green" | "red" | "amber" | "blue" | "purple" | "muted";

const PILL_TONES: Record<PillTone, string> = {
  green: "text-[#4bc39a] border-[#2b5c48] bg-[#123025]",
  red: "text-[#ef777d] border-[#5c2b31] bg-[#301919]",
  amber: "text-[#e7b86d] border-[#5c4a2b] bg-[#302719]",
  blue: "text-[#73a8e8] border-[#2b3e5c] bg-[#13203a]",
  purple: "text-[#b69af0] border-[#46365c] bg-[#231933]",
  muted: "text-[#9eafbd] border-[#2b3e4d] bg-[#152330]",
};

function StatusPill({
  tone,
  title,
  className,
  children,
}: {
  tone: PillTone;
  title?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-[2px] text-[9px] font-semibold tracking-[0.06em] whitespace-nowrap",
        PILL_TONES[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

function impactDotClass(impact: string): string {
  switch (impact) {
    case "High":
      return "bg-[#ef777d]";
    case "Medium":
      return "bg-[#e7b86d]";
    case "Holiday":
      return "bg-[#b69af0]";
    default:
      return "bg-[#5b6b78]";
  }
}

function volTextClass(regime: string): string {
  switch (regime) {
    case "ELEVATED":
      return "text-[#e7b86d]";
    case "QUIET":
      return "text-[#73a8e8]";
    case "NORMAL":
      return "text-[#8193a3]";
    default:
      return "text-[#5b6b78]";
  }
}

function assetClassShort(assetClass: string): string {
  switch (assetClass) {
    case "crypto":
      return "CRYPTO";
    case "futures":
      return "FUTURES";
    case "forex":
      return "FX";
    case "index":
      return "INDEX";
    default:
      return assetClass.toUpperCase();
  }
}

function priceDecimals(price: number): number {
  return price >= 10 ? 2 : 4;
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function AnalystPanel({ focusSymbol }: { focusSymbol: string }) {
  // stable tz for the query string; bust counter forces a manual refetch by
  // changing the url (the server cache key only reads `tz`, extra params are
  // ignored) — this never changes on the 1s clock.
  const [tz] = useState(() => localTzOffsetMin());
  const [bust, setBust] = useState(0);
  const url = `/api/analyst?tz=${tz}${bust > 0 ? `&_=${bust}` : ""}`;
  const { data, error } = usePolling<AnalystResponse>(url, POLL_MS);

  // 1s local clock — drives every visible countdown, never the fetch loop.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // When the current payload first rendered — recomputed once per fetch (the
  // data object identity changes on every response), so no effect is needed.
  const receivedAt = useMemo(() => Date.now(), [data]);

  // Manual refresh: bump the url (the polling effect refetches immediately)
  // and remember the click time so the spinner stops as soon as a newer
  // payload (receivedAt) or an error lands.
  const [refreshClickedAt, setRefreshClickedAt] = useState(0);
  const manualRefresh = () => {
    setRefreshClickedAt(Date.now());
    setBust((b) => b + 1);
  };

  const expired = error != null && error.toLowerCase().includes("session expired");

  if (!data || expired) {
    if (error) return <AnalystError error={error} onRetry={manualRefresh} />;
    return <AnalystSkeleton />;
  }

  const refreshInSec = Math.max(0, Math.ceil((receivedAt + POLL_MS - now) / 1000));
  const refreshingNow =
    (refreshClickedAt > 0 && receivedAt <= refreshClickedAt && !error) || refreshInSec === 0;

  return (
    <section className="panel flex-1 min-h-0 flex flex-col overflow-hidden" aria-label="Market analyst">
      {/* header bar */}
      <header className="panel-head shrink-0 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="truncate">AMI ANALYST</span>
          <span className="chip hidden sm:inline-flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#4bc39a] pulse-dot" aria-hidden />
            LIVE DESK BRIEFING
          </span>
          {error && (
            <StatusPill tone="amber" title={error} className="hidden lg:inline-flex">
              FEED RETRYING
            </StatusPill>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="chip hidden md:inline-flex tnum" title="Local time the current briefing was generated">
            UPDATED {fmtTime(data.generatedAt)}
          </span>
          <span className="chip hidden sm:inline-flex tnum" title="Next automatic refresh of the analyst feed">
            <span className="sr-only">Auto refresh countdown: </span>
            {refreshingNow ? "REFRESHING…" : `REFRESH IN ${refreshInSec}S`}
          </span>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="focus:outline-none cursor-help" aria-label="Analyst model status">
                <StatusPill tone={data.llm.used ? "green" : "amber"}>
                  {data.llm.used
                    ? `ANALYST MODEL · ${(data.llm.latencyMs / 1000).toFixed(1)}s`
                    : "DETERMINISTIC FALLBACK"}
                </StatusPill>
              </button>
            </TooltipTrigger>
            <TooltipContent side="bottom" className="max-w-72 text-[10px] leading-snug break-words">
              {data.llm.used
                ? "Briefing written by the analyst model from the deterministic confluence context — every number traces back to live feeds."
                : data.llm.note ?? "Analyst model unreachable — deterministic fallback briefing generated from the confluence engine."}
            </TooltipContent>
          </Tooltip>
          <Button
            variant="ghost"
            size="sm"
            onClick={manualRefresh}
            aria-label="Refresh analyst feed now"
            className="h-6 w-7 px-0 text-[#8193a3] hover:text-[#e5f0fb]"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", refreshingNow && "animate-spin")} />
          </Button>
        </div>
      </header>

      {/* body */}
      <div className="flex-1 min-h-0 overflow-y-auto ami-scroll p-2">
        <div className="grid gap-2 grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] items-start">
          {/* left column — briefing feed, market pulse, engine signals */}
          <div className="flex flex-col gap-2 min-w-0">
            <BriefingFeed briefing={data.briefing} generatedAt={data.generatedAt} />
            <PulseStrip pulses={data.pulses} focusSymbol={focusSymbol} />
            <SignalsStrip signals={data.signals} />
          </div>

          {/* right column — sessions board, event risk board */}
          <div className="flex flex-col gap-2 min-w-0">
            <SessionsBoard sessions={data.sessions} now={now} />
            <EventsBoard calendar={data.calendar} now={now} />
          </div>

          {/* full width — confluence board */}
          <div className="xl:col-span-2 min-w-0">
            <ConfluenceBoard confluences={data.confluences} focusSymbol={focusSymbol} now={now} />
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Briefing feed (memoized — the 1s clock must not re-parse the markdown)
// ---------------------------------------------------------------------------

const BriefingFeed = memo(function BriefingFeed({
  briefing,
  generatedAt,
}: {
  briefing: string;
  generatedAt: number;
}) {
  return (
    <section
      className="rounded-lg border border-[#1e303d] bg-[#0d1720] flex flex-col min-h-0"
      aria-label="AMI Analyst live desk briefing"
    >
      <div className="flex items-center gap-2.5 p-3 pb-2">
        <div
          className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#78a9ea] via-[#a58de6] to-[#48b997] grid place-items-center text-[#071019] font-black text-sm shrink-0"
          aria-hidden
        >
          A
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[11px] font-extrabold tracking-[0.06em] text-[#e5edf4]">AMI Analyst</div>
          <div className="text-[9px] text-[#687e90] tnum">
            generated {fmtTime(generatedAt)} local · auto-renews every 60s
          </div>
        </div>
        <span className="chip shrink-0">DESK BRIEFING</span>
      </div>
      <div className="px-3 pb-3 min-h-0">
        <div className="max-h-[520px] overflow-y-auto ami-scroll pr-1.5">
          {briefing && briefing.trim() ? (
            <div key={generatedAt} className="prose-ami fade-in">
              <Markdown>{briefing}</Markdown>
            </div>
          ) : (
            <div className="text-[11px] text-[#687e90]">briefing unavailable — retrying on the next cycle</div>
          )}
        </div>
      </div>
    </section>
  );
});

// ---------------------------------------------------------------------------
// Sessions & data days board
// ---------------------------------------------------------------------------

function sessionCountdown(base: number, minutes: number | null, now: number): string {
  if (minutes == null) return "—";
  return fmtCountdown(base + minutes * 60_000 - now);
}

function SessionsBoard({ sessions, now }: { sessions: SessionBoard; now: number }) {
  const base = sessions.asOf ?? now;
  return (
    <section className="rounded-lg border border-[#1e303d] bg-[#0d1720] p-3" aria-label="Forex sessions and data days">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[10px] font-extrabold tracking-[0.08em] text-[#aebdca]">
          <Clock className="w-3 h-3 inline mr-1 -mt-0.5" />
          FX SESSIONS &amp; DATA DAYS
        </span>
        <span className="text-[9px] text-[#687e90] tnum shrink-0" title="Server clock at last refresh">
          {sessions.utc}
        </span>
      </div>

      {/* market status pills */}
      <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
        <StatusPill tone={sessions.forexOpen ? "green" : "red"}>
          <span
            className={cn("w-1.5 h-1.5 rounded-full", sessions.forexOpen ? "bg-[#4bc39a] pulse-dot" : "bg-[#ef777d]")}
            aria-hidden
          />
          {sessions.forexOpen ? "FOREX OPEN" : "FOREX CLOSED FOR WEEKEND"}
        </StatusPill>
        <StatusPill tone={sessions.futuresOpen ? "green" : "red"} title={sessions.futuresNote}>
          <span
            className={cn("w-1.5 h-1.5 rounded-full", sessions.futuresOpen ? "bg-[#4bc39a] pulse-dot" : "bg-[#ef777d]")}
            aria-hidden
          />
          {sessions.futuresOpen ? "GLOBEX OPEN" : "GLOBEX CLOSED"}
        </StatusPill>
      </div>
      <p className="text-[9px] text-[#687e90] leading-snug mb-1">{sessions.forexNote}</p>
      <p className="text-[9px] text-[#687e90] leading-snug mb-2.5">{sessions.futuresNote}</p>

      {/* the four sessions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mb-2.5">
        {sessions.sessions.map((s) => (
          <div
            key={s.name}
            className="flex items-center justify-between gap-2 rounded-md border border-[#1b2a35] bg-[#0a121a] px-2 py-1.5"
          >
            <div className="min-w-0">
              <div className="text-[10px] font-bold flex items-center gap-1.5">
                <span
                  className={cn("w-1.5 h-1.5 rounded-full shrink-0", s.open ? "bg-[#4bc39a] pulse-dot" : "bg-[#3a5268]")}
                  aria-hidden
                />
                {s.name}
              </div>
              <div className="text-[8px] text-[#687e90] tnum">{s.hours}</div>
            </div>
            <span className={cn("text-[9px] tnum shrink-0", s.open ? "text-[#4bc39a]" : "text-[#8193a3]")}>
              {s.open
                ? `closes in ${sessionCountdown(base, s.closesInMin, now)}`
                : `opens in ${sessionCountdown(base, s.opensInMin, now)}`}
            </span>
          </div>
        ))}
      </div>

      {/* data days strip — which days FX / futures data shows up */}
      <div>
        <div className="text-[9px] font-bold tracking-[0.06em] text-[#8193a3] mb-1">DATA DAYS · NEXT 7</div>
        <div className="grid grid-cols-7 gap-1" role="list" aria-label="Next seven days of FX and futures data availability">
          {sessions.dataDays.map((d, i) => (
            <div
              key={d.date}
              role="listitem"
              title={d.note}
              className={cn(
                "rounded-md border px-0.5 py-1.5 text-center",
                i === 0 ? "border-[#34506a] bg-[#152435]" : "border-[#1b2a35] bg-[#0a121a]"
              )}
            >
              <div className="text-[9px] font-bold text-[#c3d0dc] leading-tight">{d.dayName}</div>
              <div className="text-[8px] text-[#687e90] tnum leading-tight">{d.date.slice(5).replace("-", "/")}</div>
              <div className="mt-1 grid gap-[3px]">
                <span className={cn("text-[8px] font-bold leading-none", d.forex ? "text-[#4bc39a]" : "text-[#5b6b78]")}>
                  FX
                </span>
                <span className={cn("text-[8px] font-bold leading-none", d.futures ? "text-[#4bc39a]" : "text-[#5b6b78]")}>
                  FUT
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="text-[8px] text-[#687e90] mt-1">green = data prints that day · hover a tile for the note</div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Event risk / US news board
// ---------------------------------------------------------------------------

function EventsBoard({ calendar, now }: { calendar: CalendarDigest; now: number }) {
  const usdHigh = useMemo(
    () => calendar.usdThisWeek.filter((e) => e.impact === "High"),
    [calendar.usdThisWeek]
  );
  const nextHigh = useMemo(
    () =>
      [...calendar.nextHighImpact]
        .filter((e) => e.ts >= now - 15 * 60_000)
        .sort((a, b) => a.ts - b.ts)
        .slice(0, 6),
    [calendar.nextHighImpact, now]
  );

  return (
    <section
      className="rounded-lg border border-[#1e303d] bg-[#0d1720] p-3"
      aria-label="Event risk and US economic calendar"
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[10px] font-extrabold tracking-[0.08em] text-[#aebdca]">
          <Newspaper className="w-3 h-3 inline mr-1 -mt-0.5" />
          EVENT RISK · ECONOMIC CALENDAR
        </span>
        <span className="chip shrink-0">{calendar.thisWeek.length} THIS WEEK</span>
      </div>

      {/* today / tomorrow */}
      <div className="grid grid-cols-2 gap-2 mb-2.5">
        <DayEvents label="TODAY" events={calendar.today} />
        <DayEvents label="TOMORROW" events={calendar.tomorrow} />
      </div>

      {/* next high-impact strip */}
      <div className="mb-2.5">
        <div className="text-[9px] font-bold tracking-[0.06em] text-[#8193a3] mb-1 flex items-center gap-1">
          <CalendarClock className="w-3 h-3" aria-hidden />
          NEXT HIGH-IMPACT · THIS WEEK
        </div>
        <div className="space-y-1">
          {nextHigh.map((e) => (
            <div key={e.id} className="flex items-center justify-between gap-2 text-[10px]">
              <div className="min-w-0">
                <div className="truncate leading-tight" title={e.title}>
                  {e.title}
                </div>
                <div className="text-[9px] text-[#687e90] tnum leading-tight">
                  {fmtDate(e.ts)} {fmtTime(e.ts)} · {e.country} · f {e.forecast || "—"} · prev {e.previous || "—"}
                </div>
              </div>
              <span className="text-[9px] font-bold text-[#ef777d] tnum shrink-0">in {fmtCountdown(e.ts - now)}</span>
            </div>
          ))}
          {nextHigh.length === 0 && (
            <div className="text-[10px] text-[#687e90]">no high-impact events in the feed window</div>
          )}
        </div>
      </div>

      {/* US focus */}
      <div className="rounded-md border border-[#1b2a35] bg-[#0a121a] p-2">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className="text-[9px] font-bold tracking-[0.06em] text-[#aebdca]">US FOCUS — THIS WEEK</span>
          <span className="text-[9px] text-[#687e90] tnum shrink-0" title="USD releases due today and tomorrow">
            today {calendar.usdToday.length} · tomorrow {calendar.usdTomorrow.length}
          </span>
        </div>
        <div className="text-[9px] text-[#8193a3] mb-1.5">
          {calendar.usdThisWeek.length} USD releases this week ·{" "}
          <span className="text-[#ef777d] font-bold">{usdHigh.length} high-impact</span>
        </div>
        <div className="space-y-1 max-h-44 overflow-y-auto ami-scroll pr-1">
          {usdHigh.map((e) => (
            <div key={e.id} className="flex items-start justify-between gap-2 text-[10px]">
              <div className="min-w-0">
                <div className="truncate leading-tight" title={e.title}>
                  {e.title}
                </div>
                <div className="text-[9px] text-[#687e90] tnum leading-tight">
                  f {e.forecast || "—"} · prev {e.previous || "—"}
                </div>
              </div>
              <span className="text-[9px] text-[#c3d0dc] tnum shrink-0">
                {fmtDate(e.ts)} {fmtTime(e.ts)}
              </span>
            </div>
          ))}
          {usdHigh.length === 0 && (
            <div className="text-[10px] text-[#687e90]">no high-impact USD releases this week</div>
          )}
        </div>
      </div>
    </section>
  );
}

function DayEvents({ label, events }: { label: string; events: CalendarEvent[] }) {
  return (
    <div className="min-w-0">
      <div className="text-[9px] font-bold tracking-[0.06em] text-[#8193a3] mb-1">
        {label} <span className="text-[#687e90]">· {events.length}</span>
      </div>
      <div className="space-y-1 max-h-52 overflow-y-auto ami-scroll pr-1">
        {events.map((e) => (
          <div key={e.id} className="flex items-start gap-1.5 text-[10px]">
            <span className={cn("w-1.5 h-1.5 rounded-full mt-1 shrink-0", impactDotClass(e.impact))} aria-hidden />
            <div className="min-w-0">
              <div className="truncate leading-tight" title={`${e.impact} impact · ${e.country}`}>
                {e.title}
              </div>
              <div className="text-[9px] text-[#687e90] tnum leading-tight">
                {fmtTime(e.ts)} {e.country} · f {e.forecast || "—"} · prev {e.previous || "—"}
              </div>
            </div>
          </div>
        ))}
        {events.length === 0 && <div className="text-[10px] text-[#687e90]">no events in feed window</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confluence board
// ---------------------------------------------------------------------------

type ConfluenceFilter = "all" | "crypto" | "futures" | "forex" | "strong";

const CONFLUENCE_FILTERS: Array<{ id: ConfluenceFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "crypto", label: "Crypto" },
  { id: "futures", label: "Futures" },
  { id: "forex", label: "FX" },
  { id: "strong", label: "Strong only" },
];

function ConfluenceBoard({
  confluences,
  focusSymbol,
  now,
}: {
  confluences: Confluence[];
  focusSymbol: string;
  now: number;
}) {
  const [filter, setFilter] = useState<ConfluenceFilter>("all");

  const cards = useMemo(() => {
    const passes = (c: Confluence) =>
      filter === "all"
        ? true
        : filter === "strong"
          ? c.strength === "STRONG"
          : c.assetClass === filter;
    const sorted = (list: Confluence[]) =>
      [...list].sort(
        (a, b) =>
          (STRENGTH_RANK[a.strength] ?? 3) - (STRENGTH_RANK[b.strength] ?? 3) ||
          Math.abs(b.trendScore) - Math.abs(a.trendScore)
      );
    const focused = confluences.filter((c) => c.symbol === focusSymbol).filter(passes);
    const rest = confluences.filter((c) => c.symbol !== focusSymbol).filter(passes);
    return [...sorted(focused), ...sorted(rest)];
  }, [confluences, focusSymbol, filter]);

  return (
    <section className="rounded-lg border border-[#1e303d] bg-[#0d1720] p-3" aria-label="Confluence board">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <span className="text-[10px] font-extrabold tracking-[0.08em] text-[#aebdca]">
          <Layers className="w-3 h-3 inline mr-1 -mt-0.5" />
          CONFLUENCE BOARD · PER-MARKET ESTIMATES
        </span>
        <div className="flex items-center gap-1" role="group" aria-label="Confluence filter">
          {CONFLUENCE_FILTERS.map((f) => (
            <Button
              key={f.id}
              size="sm"
              variant="ghost"
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
              className={cn(
                "h-6 px-2 text-[9px] gap-1 rounded-md",
                filter === f.id
                  ? "bg-[#203244] text-[#e5f0fb] border border-[#34506a]"
                  : "text-[#8193a3] border border-transparent hover:text-[#c3d0dc]"
              )}
            >
              {f.label}
            </Button>
          ))}
        </div>
      </div>
      {cards.length === 0 ? (
        <div className="text-[10px] text-[#687e90]">no markets match this filter</div>
      ) : (
        <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {cards.map((c) => (
            <ConfluenceCard key={c.symbol} c={c} focused={c.symbol === focusSymbol} now={now} />
          ))}
        </div>
      )}
    </section>
  );
}

function TrendMeter({ score }: { score: number }) {
  const clamped = Math.max(-3, Math.min(3, score));
  const pct = ((clamped + 3) / 6) * 100;
  const width = Math.abs(pct - 50);
  const left = Math.min(pct, 50);
  return (
    <div className="flex items-center gap-2">
      <div className="relative h-1.5 flex-1 rounded-full bg-[#16222d] overflow-hidden">
        <div className="absolute inset-y-0 left-1/2 w-px bg-[#3a5268]" aria-hidden />
        <div
          className={cn("absolute inset-y-0 rounded-full", clamped >= 0 ? "bg-[#4bc39a]" : "bg-[#ef777d]")}
          style={{ left: `${left}%`, width: `${width}%` }}
          aria-hidden
        />
      </div>
      <span
        className={cn(
          "text-[10px] font-bold tnum w-10 text-right",
          clamped > 0.4 ? "text-[#4bc39a]" : clamped < -0.4 ? "text-[#ef777d]" : "text-[#8193a3]"
        )}
      >
        {clamped > 0 ? "+" : ""}
        {clamped.toFixed(1)}
      </span>
    </div>
  );
}

function ConfluenceCard({ c, focused, now }: { c: Confluence; focused: boolean; now: number }) {
  const nextEvent = c.eventRisk.events[0];
  const extraEvents = c.eventRisk.events.length - 1;
  return (
    <article
      className={cn(
        "rounded-lg border bg-[#0a121a] p-2.5 flex flex-col gap-2",
        focused ? "border-[#3a8a6b] ring-1 ring-[#2b5c48]" : "border-[#1e303d]"
      )}
      aria-label={`${c.symbol} confluence estimate`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[12px] font-bold leading-tight">
            {c.symbol}
            {focused && (
              <span className="ml-1.5 text-[8px] font-extrabold tracking-[0.08em] text-[#4bc39a] align-middle">
                FOCUS
              </span>
            )}
          </div>
          <div className="text-[9px] text-[#687e90] truncate" title={c.name}>
            {c.name}
          </div>
        </div>
        <span className="chip shrink-0">{assetClassShort(c.assetClass)}</span>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <StatusPill tone={c.bias === "bullish" ? "green" : c.bias === "bearish" ? "red" : "muted"}>
          {c.bias.toUpperCase()}
        </StatusPill>
        <StatusPill tone={c.strength === "STRONG" ? "purple" : c.strength === "MILD" ? "amber" : "muted"}>
          {c.strength}
        </StatusPill>
      </div>

      <div>
        <div className="flex items-center justify-between text-[8px] tracking-[0.06em] text-[#687e90] mb-0.5">
          <span>MULTI-TF TREND · -3..+3</span>
          {c.vixBackdrop != null && <span title="VIX backdrop for risk assets">VIX {c.vixBackdrop.toFixed(1)}</span>}
        </div>
        <TrendMeter score={c.trendScore} />
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <StatusPill tone={c.volRegime === "ELEVATED" ? "amber" : c.volRegime === "QUIET" ? "blue" : "muted"} title="14d vs 90d realized volatility regime">
          VOL {c.volRegime}
        </StatusPill>
        <StatusPill
          tone={c.eventRisk.level === "HIGH" ? "red" : c.eventRisk.level === "MEDIUM" ? "amber" : "muted"}
          title="Calendar event risk for this market within 24h"
        >
          RISK {c.eventRisk.level}
        </StatusPill>
      </div>

      {nextEvent ? (
        <div className="text-[9px] leading-snug">
          <span className="text-[#8193a3]">next: </span>
          <span className="text-[#c3d0dc]">{nextEvent.title}</span>
          <span className="text-[#687e90]"> ({nextEvent.country})</span>
          <span
            className={cn(
              "font-bold tnum",
              c.eventRisk.level === "HIGH" ? "text-[#ef777d]" : "text-[#e7b86d]"
            )}
          >
            {" "}
            · in {fmtCountdown(nextEvent.ts - now)}
          </span>
          {extraEvents > 0 && <span className="text-[#687e90]"> · +{extraEvents} more</span>}
        </div>
      ) : (
        <div className="text-[9px] text-[#687e90]">no calendar events for this market in the next 24h</div>
      )}

      <ul className="list-disc pl-3.5 space-y-0.5 text-[9px] leading-snug text-[#a8b7c4]">
        {c.notes.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ul>

      <p className="text-[10px] italic leading-snug text-[#c3d0dc] border-t border-[#1b2a35] pt-1.5 mt-auto">
        {c.implication}
      </p>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Market pulse strip
// ---------------------------------------------------------------------------

function TrendIcon({ tf, state }: { tf: string; state: TrendState }) {
  const cls = state === "bull" ? "text-[#4bc39a]" : state === "bear" ? "text-[#ef777d]" : "text-[#687e90]";
  const Icon = state === "bull" ? TrendingUp : state === "bear" ? TrendingDown : Minus;
  return (
    <span className={cls} title={`${tf}: ${state}`}>
      <Icon className="w-3 h-3" aria-hidden />
      <span className="sr-only">{`${tf} ${state}`}</span>
    </span>
  );
}

function PulseStrip({ pulses, focusSymbol }: { pulses: MarketPulse[]; focusSymbol: string }) {
  const voteFor = (p: MarketPulse, tf: TrendVote["tf"]): TrendState =>
    p.trend.find((t) => t.tf === tf)?.state ?? "neutral";
  return (
    <section className="rounded-lg border border-[#1e303d] bg-[#0d1720] p-3" aria-label="Market pulse">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[10px] font-extrabold tracking-[0.08em] text-[#aebdca]">
          <Activity className="w-3 h-3 inline mr-1 -mt-0.5" />
          MARKET PULSE · ALL VENUES
        </span>
        <span className="text-[9px] text-[#687e90] shrink-0">trend votes 1w / 1d / 4h</span>
      </div>
      <div className="max-h-48 overflow-auto ami-scroll">
        <table className="w-full text-[10px] border-collapse min-w-[430px]">
          <thead>
            <tr className="text-[8px] uppercase tracking-[0.06em] text-[#687e90] border-b border-[#1b2a35]">
              <th scope="col" className="text-left font-semibold py-1">
                Symbol
              </th>
              <th scope="col" className="text-right font-semibold py-1">
                Price
              </th>
              <th scope="col" className="text-right font-semibold py-1">
                1D
              </th>
              <th scope="col" className="text-right font-semibold py-1">
                RV14
              </th>
              <th scope="col" className="text-left font-semibold py-1 pl-2">
                Vol
              </th>
              <th scope="col" className="text-center font-semibold py-1">
                1w 1d 4h
              </th>
              <th scope="col" className="text-right font-semibold py-1">
                ATR%
              </th>
            </tr>
          </thead>
          <tbody>
            {pulses.map((p) => {
              const focusedRow = p.symbol === focusSymbol;
              const dec = priceDecimals(p.price);
              return (
                <tr
                  key={p.symbol}
                  className={cn("border-b border-[#141f29] last:border-0", focusedRow && "bg-[#152435]")}
                >
                  <td
                    className="py-1 pr-2 font-semibold whitespace-nowrap"
                    title={`${p.name} · Donchian20 ${fmtPrice(p.donchian20Lower, dec)} – ${fmtPrice(
                      p.donchian20Upper,
                      dec
                    )} · last closed bar ${fmtTime(p.dataAsOf)}`}
                  >
                    {p.symbol}
                  </td>
                  <td className="py-1 text-right tnum whitespace-nowrap">{fmtPrice(p.price, dec)}</td>
                  <td className={cn("py-1 text-right tnum whitespace-nowrap", pnlClass(p.changePct))}>
                    {fmtPct(p.changePct)}
                  </td>
                  <td className="py-1 text-right tnum text-[#8193a3] whitespace-nowrap">
                    {p.rv14 != null ? `${p.rv14.toFixed(1)}%` : "—"}
                  </td>
                  <td className="py-1 pl-2 whitespace-nowrap">
                    <span className={cn("font-bold", volTextClass(p.volRegime))}>{p.volRegime}</span>
                  </td>
                  <td className="py-1">
                    <div className="flex items-center justify-center gap-1">
                      {(["1w", "1d", "4h"] as const).map((tf) => (
                        <TrendIcon key={tf} tf={tf} state={voteFor(p, tf)} />
                      ))}
                    </div>
                  </td>
                  <td className="py-1 text-right tnum text-[#8193a3] whitespace-nowrap">
                    {p.atrPct1d != null ? `${p.atrPct1d.toFixed(2)}%` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Engine signals strip
// ---------------------------------------------------------------------------

function signalBiasClass(bias: string | null): string {
  if (bias === "long") return "text-[#4bc39a]";
  if (bias === "short") return "text-[#ef777d]";
  return "text-[#8193a3]";
}

function SignalsStrip({ signals }: { signals: EngineSignal[] }) {
  return (
    <section className="rounded-lg border border-[#1e303d] bg-[#0d1720] p-3" aria-label="Engine signals">
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[10px] font-extrabold tracking-[0.08em] text-[#aebdca]">
          <Gauge className="w-3 h-3 inline mr-1 -mt-0.5" />
          ENGINE SIGNALS
        </span>
        <span className="text-[9px] text-[#687e90] shrink-0">{signals.length} live states</span>
      </div>
      {signals.length === 0 ? (
        <div className="text-[10px] text-[#687e90]">no engine signal states in the feed window</div>
      ) : (
        <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2 2xl:grid-cols-3">
          {signals.map((s, i) => (
            <div
              key={`${s.symbol}-${s.strategy}-${s.tf}-${i}`}
              className="flex items-center gap-1.5 text-[10px] min-w-0"
              title={`${s.symbol} · ${s.strategy} [${s.tf}] · ATR ${s.atrPct.toFixed(2)}% · htf ${s.htfState}`}
            >
              <span className="font-bold shrink-0">{s.symbol}</span>
              <span className="text-[#8193a3] truncate">
                · {s.strategy} [{s.tf}]
              </span>
              <span className="text-[#687e90] shrink-0" aria-hidden>
                →
              </span>
              <span className={cn("font-bold shrink-0", signalBiasClass(s.bias))}>
                {(s.bias ?? "flat").toUpperCase()}
              </span>
              <span className="text-[#687e90] truncate">(htf {s.htfState})</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Loading / error states
// ---------------------------------------------------------------------------

function AnalystSkeleton() {
  const widths = [92, 100, 78, 96, 64, 88, 100, 72, 90, 55];
  return (
    <section className="panel flex-1 min-h-0 flex flex-col overflow-hidden" aria-label="Market analyst loading">
      <div className="panel-head">
        <span>AMI ANALYST</span>
        <span className="chip">CONNECTING…</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto ami-scroll p-2">
        <div className="grid gap-2 grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] items-start">
          <div className="rounded-lg border border-[#1e303d] bg-[#0d1720] p-3">
            <div className="flex items-center gap-2.5 mb-3">
              <div
                className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#78a9ea] via-[#a58de6] to-[#48b997] grid place-items-center text-[#071019] font-black text-sm animate-pulse"
                aria-hidden
              >
                A
              </div>
              <div>
                <div className="text-[11px] font-extrabold tracking-[0.06em] text-[#e5edf4]">AMI Analyst</div>
                <div className="text-[9px] text-[#e7b86d]">assembling live desk briefing…</div>
              </div>
            </div>
            <div className="space-y-2 animate-pulse">
              {widths.map((w, i) => (
                <div key={i} className="h-2.5 rounded bg-[#1b2a35]" style={{ width: `${w}%` }} />
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <div className="rounded-lg border border-[#1e303d] bg-[#0d1720] p-3 space-y-2 animate-pulse">
              <div className="h-3 w-1/2 rounded bg-[#1b2a35]" />
              {[86, 77, 68, 59, 50, 41].map((w, i) => (
                <div key={i} className="h-2.5 rounded bg-[#1b2a35]" style={{ width: `${w}%` }} />
              ))}
            </div>
            <div className="rounded-lg border border-[#1e303d] bg-[#0d1720] p-3 space-y-2 animate-pulse">
              <div className="h-3 w-2/5 rounded bg-[#1b2a35]" />
              {[90, 83, 76, 69, 62, 55].map((w, i) => (
                <div key={i} className="h-2.5 rounded bg-[#1b2a35]" style={{ width: `${w}%` }} />
              ))}
            </div>
          </div>
          <div className="xl:col-span-2 grid gap-2 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="rounded-lg border border-[#1e303d] bg-[#0d1720] p-2.5 space-y-2 animate-pulse">
                <div className="h-3 w-1/2 rounded bg-[#1b2a35]" />
                <div className="h-2 w-1/3 rounded bg-[#1b2a35]" />
                <div className="h-6 rounded bg-[#1b2a35]" />
                <div className="h-2.5 w-3/4 rounded bg-[#1b2a35]" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function AnalystError({ error, onRetry }: { error: string; onRetry: () => void }) {
  const expired = error.toLowerCase().includes("session expired");
  return (
    <section className="panel flex-1 min-h-0 flex flex-col" aria-label="Market analyst error">
      <div className="panel-head">
        <span>AMI ANALYST</span>
        <span className="chip">FEED ERROR</span>
      </div>
      <div className="flex-1 grid place-items-center p-6">
        <div className="text-center space-y-3 max-w-sm">
          <AlertTriangle className="w-8 h-8 mx-auto text-[#ef777d]" aria-hidden />
          <div className="text-[12px] font-bold text-[#ef777d]">
            {expired ? "Session expired — reload" : "Analyst feed unavailable"}
          </div>
          {!expired && (
            <div className="text-[10px] text-[#8193a3] break-words">{error}</div>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => (expired ? window.location.reload() : onRetry())}
            className="h-7 text-[10px] gap-1.5"
          >
            <RefreshCw className="w-3 h-3" />
            {expired ? "Reload" : "Retry"}
          </Button>
        </div>
      </div>
    </section>
  );
}
