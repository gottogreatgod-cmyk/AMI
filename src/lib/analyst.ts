// ---------------------------------------------------------------------------
// AMI Analyst — the deterministic confluence engine behind the briefing.
//
// Everything here is computed from live closed bars + the economic calendar:
//   • market pulse (price, change, realized vol regime, 1w/1d/4h trend votes)
//   • event risk (high-impact calendar events within 24h per currency)
//   • FX/futures session board + which days data shows up
//   • per-market confluence: bias, strength, vol regime, event windows
// The LLM briefing is generated FROM this JSON — it never invents numbers.
// ---------------------------------------------------------------------------

import { getBars } from "@/lib/data/providers";
import { INSTRUMENTS, getInstrument } from "@/lib/data/instruments";
import { getCalendar, type CalendarEvent } from "@/lib/data/calendar";
import { cacheGet, cacheSet } from "@/lib/data/cache";
import { realizedVol } from "@/lib/engine/indicators";
import type { Bar } from "@/lib/engine/types";
import { currentSignalState, type SignalState } from "@/lib/engine/runner";
import type { StrategyConfig } from "@/lib/engine/types";

export interface TrendVote {
  tf: "1w" | "1d" | "4h";
  state: "bull" | "bear" | "neutral";
}

export interface MarketPulse {
  symbol: string;
  name: string;
  assetClass: string;
  price: number;
  changePct: number | null;
  rv14: number | null;
  volRegime: "ELEVATED" | "NORMAL" | "QUIET" | "N/A";
  trend: TrendVote[];
  trendScore: number;
  atrPct1d: number | null;
  donchian20Upper: number | null;
  donchian20Lower: number | null;
  dataAsOf: number;
}

export interface EventRisk {
  level: "HIGH" | "MEDIUM" | "NONE";
  events: Array<{ title: string; country: string; impact: string; ts: number; inHours: number; forecast?: string; previous?: string }>;
}

export interface Confluence {
  symbol: string;
  name: string;
  assetClass: string;
  bias: "bullish" | "bearish" | "neutral";
  strength: "STRONG" | "MILD" | "NONE";
  trendScore: number;
  volRegime: MarketPulse["volRegime"];
  eventRisk: EventRisk;
  vixBackdrop: number | null;
  notes: string[];
  implication: string;
}

export interface SessionSlot {
  name: string;
  hours: string;
  open: boolean;
  opensInMin: number | null;
  closesInMin: number | null;
}

export interface DataDay {
  date: string;
  dayName: string;
  forex: boolean;
  futures: boolean;
  note: string;
}

export interface SessionBoard {
  asOf: number;
  utc: string;
  sessions: SessionSlot[];
  forexOpen: boolean;
  futuresOpen: boolean;
  forexNote: string;
  futuresNote: string;
  dataDays: DataDay[];
}

export interface CalendarDigest {
  today: CalendarEvent[];
  tomorrow: CalendarEvent[];
  thisWeek: CalendarEvent[];
  nextHighImpact: CalendarEvent[];
  usdToday: CalendarEvent[];
  usdTomorrow: CalendarEvent[];
  usdThisWeek: CalendarEvent[];
}

const SESSION_DEFS = [
  { name: "Sydney", startH: 21, endH: 6 },
  { name: "Tokyo", startH: 0, endH: 9 },
  { name: "London", startH: 7, endH: 16 },
  { name: "New York", startH: 12, endH: 21 },
];

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function minutesSinceMidnightUtc(d: Date) {
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

function sessionOpen(now: Date, startH: number, endH: number): boolean {
  const m = minutesSinceMidnightUtc(now);
  if (startH < endH) return m >= startH * 60 && m < endH * 60;
  return m >= startH * 60 || m < endH * 60; // wraps midnight
}

function minutesUntil(hour: number, minute: number, now: Date): number {
  const target = hour * 60 + minute;
  const cur = minutesSinceMidnightUtc(now);
  let diff = target - cur;
  if (diff <= 0) diff += 24 * 60;
  return diff;
}

export function buildSessionBoard(now = new Date()): SessionBoard {
  const m = minutesSinceMidnightUtc(now);
  const day = now.getUTCDay();

  const sessions: SessionSlot[] = SESSION_DEFS.map((s) => {
    const open = sessionOpen(now, s.startH, s.endH);
    let opensInMin: number | null = null;
    let closesInMin: number | null = null;
    if (open) {
      closesInMin = minutesUntil(s.endH, 0, now);
    } else {
      opensInMin = minutesUntil(s.startH, 0, now);
    }
    return {
      name: s.name,
      hours: `${String(s.startH).padStart(2, "0")}:00–${String(s.endH).padStart(2, "0")} UTC`,
      open,
      opensInMin,
      closesInMin,
    };
  });

  // Forex: closes Fri ~21:00 UTC, reopens Sun ~21:00 UTC (DST shifts ±1h)
  const forexOpen = !(day === 6 || (day === 0 && m < 21 * 60) || (day === 5 && m >= 21 * 60));
  const forexNote = forexOpen
    ? "Spot FX is trading (Mon–Fri). Sessions approximate UTC; DST shifts ±1h."
    : "Spot FX is CLOSED for the weekend (Fri ~21:00 → Sun ~21:00 UTC). Crypto keeps printing; futures reopen Sun 22:00 UTC.";

  // CME Globex: Sun 22:00 – Fri 21:00 UTC, daily 21:00–22:00 maintenance break
  const inMaintenance = m >= 21 * 60 && m < 22 * 60;
  const futuresOpen =
    !inMaintenance &&
    !(day === 6 || (day === 0 && m < 22 * 60) || (day === 5 && m >= 21 * 60));
  const futuresNote = futuresOpen
    ? "Globex is open (daily 21:00–22:00 UTC maintenance break, approximate)."
    : inMaintenance
      ? "Globex daily maintenance break 21:00–22:00 UTC."
      : "Globex is closed for the weekend (Fri ~21:00 → Sun ~22:00 UTC).";

  const dataDays: DataDay[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(now.getTime() + i * 86_400_000);
    const dow = d.getUTCDay();
    const isWeekend = dow === 0 || dow === 6;
    dataDays.push({
      date: d.toISOString().slice(0, 10),
      dayName: DAY_NAMES[dow],
      forex: !isWeekend,
      futures: dow !== 6, // Sun evening open counts as a data day
      note:
        dow === 0
          ? "FX/futures reopen Sunday evening UTC"
          : isWeekend
            ? "No FX/futures data — crypto only"
            : "Full data day",
    });
  }

  return {
    asOf: now.getTime(),
    utc: now.toISOString().replace("T", " ").slice(0, 19) + " UTC",
    sessions,
    forexOpen,
    futuresOpen,
    forexNote,
    futuresNote,
    dataDays,
  };
}

function trendStateOf(bars: Bar[], fast: number, slow: number): "bull" | "bear" | "neutral" {
  if (bars.length < slow + 5) return "neutral";
  const closes = bars.map((b) => b.c);
  const ema = (values: number[], period: number) => {
    const k = 2 / (period + 1);
    let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < values.length; i++) prev = values[i] * k + prev * (1 - k);
    return prev;
  };
  const f = ema(closes, Math.min(fast, closes.length - 1));
  const s = ema(closes, Math.min(slow, closes.length - 1));
  if (f > s * 1.0005) return "bull";
  if (f < s * 0.9995) return "bear";
  return "neutral";
}

async function pulseFor(symbol: string): Promise<MarketPulse> {
  const inst = getInstrument(symbol)!;
  const [d1, h4, w1] = await Promise.all([
    getBars(symbol, "1d", { days: 400 }).catch(() => ({ bars: [] as Bar[] })),
    getBars(symbol, "4h", { days: 50 }).catch(() => ({ bars: [] as Bar[] })),
    getBars(symbol, "1w", { days: 160 }).catch(() => ({ bars: [] as Bar[] })),
  ]);
  const daily = d1.bars;
  const last = daily[daily.length - 1];
  const prev = daily[daily.length - 2];
  const rv14 = daily.length > 20 ? realizedVol(daily, 14) : null;
  const rv90 = daily.length > 95 ? realizedVol(daily, 90) : null;
  let volRegime: MarketPulse["volRegime"] = "N/A";
  if (rv14 != null && rv90 != null && rv90 > 0) {
    const ratio = rv14 / rv90;
    volRegime = ratio > 1.3 ? "ELEVATED" : ratio < 0.75 ? "QUIET" : "NORMAL";
  }
  const trend: TrendVote[] = [
    { tf: "1w", state: w1.bars.length > 40 ? trendStateOf(w1.bars, 10, 30) : "neutral" },
    { tf: "1d", state: daily.length > 205 ? trendStateOf(daily, 50, 200) : trendStateOf(daily, 20, 60) },
    { tf: "4h", state: h4.bars.length > 55 ? trendStateOf(h4.bars, 20, 55) : "neutral" },
  ];
  const trendScore =
    (trend[0].state === "bull" ? 1.5 : trend[0].state === "bear" ? -1.5 : 0) +
    (trend[1].state === "bull" ? 1 : trend[1].state === "bear" ? -1 : 0) +
    (trend[2].state === "bull" ? 0.5 : trend[2].state === "bear" ? -0.5 : 0);

  // Donchian 20d levels from daily bars
  let donchian20Upper: number | null = null;
  let donchian20Lower: number | null = null;
  if (daily.length >= 21) {
    const slice = daily.slice(-21, -1);
    donchian20Upper = Math.max(...slice.map((b) => b.h));
    donchian20Lower = Math.min(...slice.map((b) => b.l));
  }

  // 1d ATR%
  let atrPct1d: number | null = null;
  if (daily.length > 15 && last) {
    let atr = 0;
    for (let i = daily.length - 14; i < daily.length; i++) {
      const tr = Math.max(daily[i].h - daily[i].l, Math.abs(daily[i].h - daily[i - 1].c), Math.abs(daily[i].l - daily[i - 1].c));
      atr += tr;
    }
    atr /= 14;
    atrPct1d = (atr / last.c) * 100;
  }

  return {
    symbol,
    name: inst.name,
    assetClass: inst.assetClass,
    price: last?.c ?? 0,
    changePct: last && prev ? ((last.c - prev.c) / prev.c) * 100 : null,
    rv14: rv14 != null ? +(rv14 * 100).toFixed(1) : null,
    volRegime,
    trend,
    trendScore: +trendScore.toFixed(2),
    atrPct1d: atrPct1d != null ? +atrPct1d.toFixed(2) : null,
    donchian20Upper,
    donchian20Lower,
    dataAsOf: last?.ct ?? Date.now(),
  };
}

function relevantCurrencies(symbol: string): string[] {
  switch (symbol) {
    case "EURUSD=X":
      return ["USD", "EUR"];
    case "USDJPY=X":
      return ["USD", "JPY"];
    case "^VIX":
      return ["USD"];
    default:
      return ["USD"];
  }
}

export function eventRiskFor(symbol: string, events: CalendarEvent[], now = Date.now()): EventRisk {
  const curs = relevantCurrencies(symbol);
  const in24h = events
    .filter((e) => e.ts >= now - 30 * 60_000 && e.ts <= now + 24 * 3_600_000 && curs.includes(e.country))
    .sort((a, b) => a.ts - b.ts);
  const high = in24h.filter((e) => e.impact === "High");
  const medium = in24h.filter((e) => e.impact === "Medium");
  const level = high.length > 0 ? "HIGH" : medium.length > 0 ? "MEDIUM" : "NONE";
  return {
    level,
    events: in24h.slice(0, 5).map((e) => ({
      title: e.title,
      country: e.country,
      impact: e.impact,
      ts: e.ts,
      inHours: +((e.ts - now) / 3_600_000).toFixed(1),
      forecast: e.forecast || undefined,
      previous: e.previous || undefined,
    })),
  };
}

function buildConfluence(pulse: MarketPulse, events: CalendarEvent[], vixLevel: number | null): Confluence {
  const notes: string[] = [];
  const ts = pulse.trendScore;
  let bias: Confluence["bias"] = "neutral";
  let strength: Confluence["strength"] = "NONE";
  if (ts >= 1.5) {
    bias = "bullish";
    strength = ts >= 2.5 ? "STRONG" : "MILD";
  } else if (ts <= -1.5) {
    bias = "bearish";
    strength = ts <= -2.5 ? "STRONG" : "MILD";
  }
  const trendTxt = pulse.trend.map((t) => `${t.tf}:${t.state}`).join(" ");
  notes.push(`Trend votes — ${trendTxt} (score ${ts >= 0 ? "+" : ""}${ts}).`);

  const eventRisk = eventRiskFor(pulse.symbol, events);
  if (eventRisk.level === "HIGH") {
    notes.push(
      `Event risk HIGH: ${eventRisk.events[0]?.title} (${eventRisk.events[0]?.country}) in ${eventRisk.events[0]?.inHours}h — expect volatility expansion; leverage and tight stops both get punished.`
    );
  } else if (eventRisk.level === "MEDIUM") {
    notes.push("Medium-impact calendar events within 24h — usual spreads widen modestly around releases.");
  } else {
    notes.push("No high-impact calendar events for this market in the next 24h.");
  }

  if (pulse.volRegime === "ELEVATED") notes.push(`Volatility ELEVATED (14d RV ${pulse.rv14}% ann.) — stops need more room.`);
  if (pulse.volRegime === "QUIET") notes.push("Volatility QUIET — breakouts tend to be weaker; watch for compression resolves.");

  const riskAsset = ["crypto", "futures"].includes(pulse.assetClass) && pulse.symbol !== "GC=F" && pulse.symbol !== "PAXGUSDT";
  if (riskAsset && vixLevel != null && vixLevel >= 22) {
    notes.push(`VIX ${vixLevel.toFixed(1)} — risk-off macro backdrop presses risk assets; crypto/equity-index longs carry regime risk.`);
  } else if (riskAsset && vixLevel != null && vixLevel <= 14) {
    notes.push(`VIX ${vixLevel.toFixed(1)} — complacent macro backdrop favours risk assets until it doesn't.`);
  }

  let implication: string;
  if (strength === "STRONG" && eventRisk.level !== "HIGH") {
    implication = `With-trend ${bias} confluence; standard risk sizing is defensible, size from the stop.`;
  } else if (strength !== "NONE" && eventRisk.level === "HIGH") {
    implication = `Trend says ${bias} but event risk is HIGH — stand aside through the release or halve risk; expect stops to be swept.`;
  } else if (strength === "NONE") {
    implication = "No multi-timeframe confluence — range tactics or no position; wait for votes to align.";
  } else {
    implication = `Mild ${bias} tilt — smaller size, wider stops, no chasing extensions.`;
  }
  return {
    symbol: pulse.symbol,
    name: pulse.name,
    assetClass: pulse.assetClass,
    bias,
    strength,
    trendScore: ts,
    volRegime: pulse.volRegime,
    eventRisk,
    vixBackdrop: vixLevel,
    notes,
    implication,
  };
}

export function calendarDigest(events: CalendarEvent[], tzOffsetMin = 0): CalendarDigest {
  const now = Date.now();
  const localNow = now + tzOffsetMin * 60_000;
  const dayStart = (d: Date) => {
    const l = new Date(d.getTime() + tzOffsetMin * 60_000);
    return Date.UTC(l.getUTCFullYear(), l.getUTCMonth(), l.getUTCDate());
  };
  const todayStart = dayStart(new Date(now));
  const tomorrowStart = todayStart + 86_400_000;
  const weekEnd = todayStart + 7 * 86_400_000;

  const upcoming = events.filter((e) => e.ts >= localNow - 6 * 3_600_000);
  return {
    today: upcoming.filter((e) => e.ts < tomorrowStart),
    tomorrow: upcoming.filter((e) => e.ts >= tomorrowStart && e.ts < tomorrowStart + 86_400_000),
    thisWeek: upcoming.filter((e) => e.ts < weekEnd),
    nextHighImpact: upcoming.filter((e) => e.impact === "High").slice(0, 6),
    usdToday: upcoming.filter((e) => e.ts < tomorrowStart && e.country === "USD"),
    usdTomorrow: upcoming.filter((e) => e.ts >= tomorrowStart && e.ts < tomorrowStart + 86_400_000 && e.country === "USD"),
    usdThisWeek: upcoming.filter((e) => e.ts < weekEnd && e.country === "USD"),
  };
}

export interface AnalystContext {
  generatedAt: number;
  pulses: MarketPulse[];
  confluences: Confluence[];
  sessions: SessionBoard;
  calendar: CalendarDigest;
  signals: Array<{
    symbol: string;
    strategy: string;
    tf: string;
    bias: string | null;
    htfState: string;
    atrPct: number;
  }>;
  briefing: string | null;
  llm: { used: boolean; latencyMs: number; note?: string };
}

export async function buildAnalystContext(
  signalConfigs: Array<{ cfg: StrategyConfig; symbols: string[] }>,
  tzOffsetMin = 0
): Promise<AnalystContext> {
  const cached = cacheGet<AnalystContext>(`analyst-ctx|${tzOffsetMin}`);
  if (cached) return cached;

  const [calendar, ...pulseList] = await Promise.all([
    getCalendar().catch(() => ({ events: [] as CalendarEvent[], fetchedAt: Date.now(), source: "unavailable" })),
    ...INSTRUMENTS.map((i) => pulseFor(i.symbol)),
  ]);
  const pulses = pulseList;
  const vixPulse = pulses.find((p) => p.symbol === "^VIX");
  const vixLevel = vixPulse?.price ?? null;

  const confluences = pulses
    .filter((p) => p.symbol !== "^VIX")
    .map((p) => buildConfluence(p, calendar.events, vixLevel));

  const signalTasks: Promise<SignalState>[] = [];
  for (const entry of signalConfigs.slice(0, 5)) {
    for (const symbol of entry.symbols.slice(0, 3)) {
      signalTasks.push(
        currentSignalState(symbol, entry.cfg.timeframe, entry.cfg).catch(
          () =>
            ({
              symbol,
              tf: entry.cfg.timeframe,
              strategyKey: entry.cfg.key,
              strategyName: entry.cfg.name,
              bias: null,
              htfState: "n/a",
              lastPrice: 0,
              atrPct: 0,
              rsi: null,
              donchianUpper: null,
              donchianLower: null,
              asOfTs: Date.now(),
              note: "unavailable",
            }) as unknown as SignalState
        )
      );
    }
  }
  const signalStates = await Promise.all(signalTasks);

  const ctx: AnalystContext = {
    generatedAt: Date.now(),
    pulses,
    confluences,
    sessions: buildSessionBoard(),
    calendar: calendarDigest(calendar.events, tzOffsetMin),
    signals: signalStates.map((s) => ({
      symbol: s.symbol,
      strategy: s.strategyName,
      tf: s.tf,
      bias: s.bias,
      htfState: s.htfState,
      atrPct: +s.atrPct.toFixed(2),
    })),
    briefing: null,
    llm: { used: false, latencyMs: 0 },
  };
  cacheSet(`analyst-ctx|${tzOffsetMin}`, ctx, 150_000);
  return ctx;
}
