"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TooltipProps } from "recharts";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowLeft,
  FlaskConical,
  GitBranch,
  Info,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Trophy,
  X,
  Zap,
} from "lucide-react";
import {
  usePolling,
  fmtPrice,
  fmtPct,
  fmtCompact,
  pnlClass,
  verdictColor,
  fmtTime,
  fmtDate,
  fmtCountdown,
} from "./hooks";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";

// ---------------------------------------------------------------------------
// RESEARCH LAB — strategy desk, campaign sweeps, robustness leaderboard,
// run detail with split-sample check, equity curve, trades, auto-review
// fork & re-run. Ranked by robustness, never by return alone.
// ---------------------------------------------------------------------------

type LabView = "desk" | "run" | "board" | "detail";

const LAB_VIEWS: Array<{ id: LabView; label: string }> = [
  { id: "desk", label: "STRATEGY DESK" },
  { id: "run", label: "RUN" },
  { id: "board", label: "LEADERBOARD" },
  { id: "detail", label: "RUN DETAIL" },
];

const SYMBOL_GROUPS: Array<{ label: string; symbols: string[] }> = [
  {
    label: "CRYPTO",
    symbols: [
      "BTCUSDT",
      "ETHUSDT",
      "SOLUSDT",
      "BNBUSDT",
      "XRPUSDT",
      "DOGEUSDT",
      "AVAXUSDT",
      "LINKUSDT",
      "SUIUSDT",
      "PAXGUSDT",
    ],
  },
  {
    label: "FUTURES · INDEX",
    symbols: ["NQ=F", "GC=F", "^VIX"],
  },
  { label: "FOREX", symbols: ["EURUSD=X", "USDJPY=X"] },
];
const ALL_SYMBOLS = SYMBOL_GROUPS.flatMap((g) => g.symbols);

const ALL_TFS = ["15m", "45m", "1h", "3h", "4h", "1d", "1w"];

const DAY_CHOICES: Array<{ days: number; label: string }> = [
  { days: 30, label: "30" },
  { days: 100, label: "100" },
  { days: 180, label: "180" },
  { days: 365, label: "365" },
  { days: 1095, label: "3y deep rerun" },
];

// ---------------------------------------------------------------------------
// API contracts
// ---------------------------------------------------------------------------

interface EntryRule {
  kind: "donchian-break" | "rsi-extreme" | "ts-momentum" | "bb-extreme";
  lookback: number;
  rsiPeriod?: number;
  rsiLongBelow?: number;
  rsiShortAbove?: number;
  bbPeriod?: number;
  bbStd?: number;
  momentumLookback?: number;
  emaFilter?: number;
}

interface ExitRule {
  takeR?: number | null;
  trailAtr?: number | null;
  exitOnChannelMid?: boolean;
  exitOnRsiMid?: boolean;
  exitOnMomentumFlip?: boolean;
}

interface RiskConfig {
  riskPerTrade: number;
  leverageCap: number;
  stopAtr: number;
  sizeMode: "risk" | "leverage";
  maintenanceMargin?: number;
}

interface HtfFilter {
  tf: string;
  type: "ema-trend" | "donchian-mid" | "momentum-sign" | "range-neutral";
  fast: number;
  slow: number;
  adxMax?: number;
}

interface StrategyConfig {
  key: string;
  name: string;
  description: string;
  family: string;
  timeframe: string;
  direction: "long" | "short" | "both";
  entry: EntryRule;
  exit: ExitRule;
  risk: RiskConfig;
  costs?: { feeBpsPerSide?: number; slipBpsPerSide?: number };
  htf?: HtfFilter | null;
  atrPeriod: number;
  warmupBars: number;
}

interface StrategyRow {
  id: string;
  key: string;
  name: string;
  description: string;
  family: string;
  isStarter: boolean;
  parentKey: string | null;
  version: number;
  config: StrategyConfig;
  createdAt: string;
  updatedAt: string;
}

interface StrategiesResponse {
  strategies: StrategyRow[];
  starterCount: number;
}

interface ForkResponse {
  id: string;
  key: string;
  config: StrategyConfig;
}

interface EquityPoint {
  t: number;
  eq: number;
}

interface Trade {
  id: number;
  dir: 1 | -1;
  entryTs: number;
  entryPrice: number;
  exitTs: number;
  exitPrice: number;
  qty: number;
  stop: number;
  target: number | null;
  exitReason: "stop" | "trail" | "target" | "signal-exit" | "liquidation" | "end-of-data";
  pnl: number;
  r: number;
  fees: number;
  equityAfter: number;
  mfeR: number;
  maeR: number;
}

interface SplitHalf {
  trades: number;
  pf: number;
  expectancyR: number;
  net: number;
}

interface RobustnessSplit {
  first: SplitHalf;
  second: SplitHalf;
  consistent: boolean;
  decayed: boolean;
  note: string;
}

interface RobustnessScore {
  score: number;
  grade: string;
  components: { edge: number; significance: number; sample: number; stability: number; risk: number };
}

interface RunMetrics {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  netProfit: number;
  netReturnPct: number;
  profitFactor: number;
  grossProfit: number;
  grossLoss: number;
  totalCosts: number;
  costDragPct: number;
  expectancyR: number;
  avgWinR: number;
  avgLossR: number;
  tStat: number;
  maxDrawdownPct: number;
  maxDrawdownAbs: number;
  exposurePct: number;
  liquidations: number;
  leverageWickouts: number;
  cagrPct: number | null;
  barsInMarket: number;
  finalEquity: number;
}

type RunMetricsStored = RunMetrics & {
  robustness?: RobustnessScore;
  verdict?: string;
  split?: RobustnessSplit;
  engineVersion?: string;
};

interface ReviewFinding {
  severity: "info" | "warn" | "critical";
  message: string;
}

interface ReviewSuggestion {
  title: string;
  detail: string;
  patch: Record<string, unknown>;
  expectedEffect: string;
}

interface AutoReview {
  verdict: string;
  findings: ReviewFinding[];
  suggestions: ReviewSuggestion[];
  generatedAt: number;
}

interface DataQualityInfo {
  provider: string;
  providerSymbol: string;
  bars: number;
  fromTs: number;
  toTs: number;
  requestedDays?: number;
  coveredDays: number;
  testWindowDays?: number;
  warmupDaysConsumed?: number;
  coverage: string;
  session: string;
  resampledFrom?: string | null;
  gapsDetected: number;
  note?: string;
  htfQuality?: DataQualityInfo | null;
}

interface RunDetail {
  id: string;
  symbol: string;
  tf: string;
  status: string;
  error: string | null;
  daysRequested: number;
  fromTs: string | null;
  toTs: string | null;
  barsTested: number | null;
  createdAt: string;
  campaignId: string | null;
  strategy: { key: string; name: string; family: string; config: StrategyConfig } | null;
  metrics: RunMetricsStored | null;
  trades: Trade[];
  equity: EquityPoint[];
  review: AutoReview | null;
  dataQuality: DataQualityInfo | null;
}

interface CampaignTopRow {
  symbol: string;
  tf: string;
  strategyKey: string;
  score: number;
  pf: number;
}

interface CampaignSummaryData {
  verdictCounts?: Record<string, number>;
  passed?: number;
  watch?: number;
  failed?: number;
  insufficient?: number;
  top?: CampaignTopRow[];
  error?: string;
}

interface CampaignRow {
  id: string;
  label: string;
  status: "RUNNING" | "DONE" | "ERROR";
  total: number;
  done: number;
  failed: number;
  days: number;
  symbols?: string[];
  tfs?: string[];
  summary: CampaignSummaryData | null;
  createdAt: string;
  finishedAt: string | null;
}

interface CampaignsResponse {
  campaigns: CampaignRow[];
}

interface CampaignRunRow {
  id: string;
  symbol: string;
  tf: string;
  status: string;
  trades: number;
  profitFactor: number;
  tStat: number;
  netReturnPct: number;
  maxDrawdownPct: number;
  verdict: string;
  robustnessScore: number;
  robustnessGrade: string;
}

interface CampaignDetail extends CampaignRow {
  runs: CampaignRunRow[];
}

interface LeaderboardRow {
  id: string;
  strategyKey: string;
  strategyName: string;
  family: string;
  symbol: string;
  tf: string;
  trades: number;
  pf: number;
  tStat: number;
  netReturnPct: number;
  maxDrawdownPct: number;
  expectancyR: number;
  winRate: number;
  verdict: string;
  score: number;
  grade: string;
  splitNote: string;
  days: number;
  createdAt: string;
  liquidations: number;
  costDragPct: number;
}

interface LeaderboardResponse {
  leaderboard: LeaderboardRow[];
  generatedAt: number;
}

interface HealthLite {
  engineVersion: string;
}

interface ForkCrumb {
  id: string;
  label: string;
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

async function requestJson<T>(url: string, method: "GET" | "POST" | "DELETE", body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (res.status === 401) throw new Error("Session expired — reload to sign in again.");
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string };
      if (j?.error) msg = j.error;
    } catch {
      /* keep the status message */
    }
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

function postJson<T>(url: string, body: unknown): Promise<T> {
  return requestJson<T>(url, "POST", body);
}

/** Poll an endpoint until `isDone(data)` says the stream is terminal, then stop. */
function usePollUntil<T>(url: string | null, intervalMs: number, isDone: (data: T) => boolean) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) return;
    const target = url;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    setData(null);
    setError(null);
    setLoading(true);

    async function tick() {
      try {
        const res = await fetch(target, { cache: "no-store" });
        if (res.status === 401) throw new Error("Session expired — reload to sign in again.");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as T;
        if (!alive) return;
        setData(json);
        setError(null);
        if (isDone(json)) {
          setLoading(false);
          return;
        }
        timer = setTimeout(tick, intervalMs);
      } catch (e) {
        if (!alive) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    }
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [url, intervalMs, isDone]);

  return { data, loading, error };
}

function runTerminal(r: RunDetail): boolean {
  return r.status !== "RUNNING" && r.status !== "PENDING" && r.status !== "QUEUED";
}

function campaignTerminal(c: CampaignDetail): boolean {
  return c.status !== "RUNNING";
}

// ---------------------------------------------------------------------------
// Text builders
// ---------------------------------------------------------------------------

function directionLabel(d: string): string {
  return d === "both" ? "long & short" : d === "long" ? "long only" : "short only";
}

function entrySummary(e: EntryRule): string {
  switch (e.kind) {
    case "donchian-break":
      return `donchian ${e.lookback}-bar break${e.emaFilter ? ` · EMA ${e.emaFilter} filter` : ""}`;
    case "rsi-extreme":
      return `RSI(${e.rsiPeriod ?? "?"}) <${e.rsiLongBelow ?? "?"} / >${e.rsiShortAbove ?? "?"} · BB(${e.bbPeriod ?? "?"}, ${e.bbStd ?? "?"})`;
    case "ts-momentum":
      return `${e.momentumLookback ?? "?"}-bar momentum sign · EMA ${e.emaFilter ?? "—"} filter`;
    case "bb-extreme":
      return `BB(${e.bbPeriod ?? "?"}, ${e.bbStd ?? "?"}) extreme reversion`;
    default:
      return e.kind;
  }
}

function exitSummary(x: ExitRule): string {
  const parts: string[] = [];
  if (x.takeR != null) parts.push(`target ${x.takeR}R`);
  if (x.trailAtr != null) parts.push(`trail ${x.trailAtr}×ATR`);
  if (x.exitOnChannelMid) parts.push("channel-mid exit");
  if (x.exitOnRsiMid) parts.push("RSI-mid exit");
  if (x.exitOnMomentumFlip) parts.push("momentum-flip exit");
  return parts.join(" + ") || "signal-only exit";
}

function riskSummary(r: RiskConfig): string {
  const riskPct = `${(r.riskPerTrade * 100).toFixed(2).replace(/\.?0+$/, "")}% risk`;
  return `stop ${r.stopAtr}×ATR · ${riskPct} · ${r.leverageCap}× cap · ${r.sizeMode === "risk" ? "risk-sized" : "leverage-sized"}`;
}

function htfSummary(h: HtfFilter | null | undefined): string {
  if (!h) return "no higher-timeframe gate";
  switch (h.type) {
    case "ema-trend":
      return `backed by ${h.tf} EMA ${h.fast}>${h.slow}`;
    case "donchian-mid":
      return `${h.tf} donchian-mid gate ${h.fast}/${h.slow}`;
    case "momentum-sign":
      return `${h.tf} momentum-sign gate ${h.fast}/${h.slow}`;
    case "range-neutral":
      return `${h.tf} range-only gate (ADX < ${h.adxMax ?? "?"})`;
    default:
      return `${h.tf} gate`;
  }
}

function patchSummary(patch: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(patch)) {
    if (v !== null && typeof v === "object") {
      for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) {
        parts.push(`${k}.${k2}=${String(v2)}`);
      }
    } else {
      parts.push(`${k}=${String(v)}`);
    }
  }
  return parts.join(" ") || "copy";
}

function pxDecimals(p: number): number {
  if (p >= 50) return 2;
  if (p >= 5) return 3;
  if (p >= 1) return 4;
  return 5;
}

function fmtPx(p: number | null | undefined): string {
  return p == null ? "—" : fmtPrice(p, pxDecimals(p));
}

function pfText(pf: number | null | undefined): string {
  if (pf == null) return "—";
  return pf >= 99 ? "∞" : pf.toFixed(2);
}

function downsampleEquity(pts: EquityPoint[], target: number): EquityPoint[] {
  if (pts.length <= target) return pts;
  const step = pts.length / target;
  const out: EquityPoint[] = [];
  for (let i = 0; i < target; i++) out.push(pts[Math.floor(i * step)]);
  out[out.length - 1] = pts[pts.length - 1];
  return out;
}

function toggleInSet(set: Set<string>, v: string): Set<string> {
  const next = new Set(set);
  if (next.has(v)) next.delete(v);
  else next.add(v);
  return next;
}

// ---------------------------------------------------------------------------
// UI atoms
// ---------------------------------------------------------------------------

function scoreColor(score: number): string {
  return score >= 55 ? "#4bc39a" : score >= 40 ? "#e7b86d" : "#8193a3";
}

function scoreTextClass(score: number): string {
  return score >= 55 ? "text-[#4bc39a]" : score >= 40 ? "text-[#e7b86d]" : "text-[#8193a3]";
}

function gradeClass(grade: string): string {
  switch (grade) {
    case "A":
    case "B":
      return "text-[#4bc39a] border-[#2b5c48] bg-[#123025]";
    case "C":
      return "text-[#e7b86d] border-[#5c4a2b] bg-[#302719]";
    default:
      return "text-[#8193a3] border-[#2b3e4d] bg-[#152330]";
  }
}

function coverageClass(c: string): string {
  switch (c) {
    case "FULL":
      return "text-[#4bc39a] border-[#2b5c48] bg-[#123025]";
    case "PARTIAL":
    case "PROVIDER_LIMIT":
      return "text-[#e7b86d] border-[#5c4a2b] bg-[#302719]";
    case "INSUFFICIENT":
      return "text-[#ef777d] border-[#5c2b31] bg-[#301919]";
    default:
      return "text-[#8193a3] border-[#2b3e4d] bg-[#152330]";
  }
}

function exitReasonClass(reason: string): string {
  switch (reason) {
    case "liquidation":
      return "text-[#ef777d] border-[#5c2b31] bg-[#301919]";
    case "target":
      return "text-[#4bc39a] border-[#2b5c48] bg-[#123025]";
    case "signal-exit":
      return "text-[#73a8e8] border-[#2b4a5c] bg-[#12202c]";
    case "end-of-data":
      return "text-[#8193a3] border-[#2b3e4d] bg-[#152330]";
    default:
      return "text-[#aebdca] border-[#2b3e4d] bg-[#0d1720]";
  }
}

function Pill({
  children,
  className,
  title,
}: {
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-bold tracking-[0.04em] whitespace-nowrap",
        className
      )}
    >
      {children}
    </span>
  );
}

function VerdictBadge({ verdict, big }: { verdict: string; big?: boolean }) {
  return <Pill className={cn(verdictColor(verdict), big && "px-2.5 py-1 text-[12px]")}>{verdict}</Pill>;
}

function MiniBar({ value, max, color, className }: { value: number; max: number; color: string; className?: string }) {
  const pct = Math.max(0, Math.min(100, max > 0 ? (value / max) * 100 : 0));
  return (
    <span className={cn("block h-1.5 rounded-full bg-[#1c2a38] overflow-hidden", className)}>
      <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
    </span>
  );
}

function ScoreBar({ score, width = 46 }: { score: number; width?: number }) {
  return (
    <span className="block h-1.5 rounded-full bg-[#1c2a38] overflow-hidden shrink-0" style={{ width }}>
      <span
        className="block h-full rounded-full"
        style={{ width: `${Math.max(0, Math.min(100, score))}%`, background: scoreColor(score) }}
      />
    </span>
  );
}

function SectionTitle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn("text-[10px] font-extrabold tracking-[0.08em] text-[#aebdca] uppercase", className)}>
      {children}
    </span>
  );
}

function ToggleChip({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={title}
      className={cn(
        "rounded-full border px-2.5 py-1 text-[10px] tracking-wide transition-colors",
        active
          ? "border-[#34506a] bg-[#203244] text-[#e5f0fb]"
          : "border-[#2b3e4d] bg-[#0d1720] text-[#8193a3] hover:border-[#3a5268] hover:text-[#c5d3df]"
      )}
    >
      {children}
    </button>
  );
}

function MiniLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[9px] text-[#73a8e8] hover:text-[#a9c8ee] px-1.5 py-0.5 rounded hover:bg-[#12202c]"
    >
      {children}
    </button>
  );
}

function ErrorLine({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-[#5c2b31] bg-[#2a171c] px-3 py-2 text-[11px] text-[#ef777d]">
      <span className="flex items-center gap-1.5 min-w-0">
        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">{text}</span>
      </span>
      {onRetry && (
        <Button
          size="sm"
          variant="ghost"
          onClick={onRetry}
          className="h-6 px-2 text-[9px] text-[#ef777d] hover:text-[#ffb6ba] shrink-0"
        >
          <RefreshCw className="w-3 h-3" />
          retry
        </Button>
      )}
    </div>
  );
}

function LoadingLine({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 text-[10px] text-[#687e90]">
      <Loader2 className="w-3.5 h-3.5 animate-spin" />
      {text}
    </div>
  );
}

function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <th className={cn("text-left font-semibold text-[#687e90] px-2 py-1 whitespace-nowrap text-[9px] tracking-[0.04em]", className)}>
      {children}
    </th>
  );
}

function Td({ children, className, title }: { children?: ReactNode; className?: string; title?: string }) {
  return (
    <td title={title} className={cn("px-2 py-1 whitespace-nowrap tnum text-[10px]", className)}>
      {children}
    </td>
  );
}

// ---------------------------------------------------------------------------
// Equity curve (recharts area chart)
// ---------------------------------------------------------------------------

function EquityTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;
  const eq = payload[0]?.value;
  const ts = typeof label === "number" ? label : undefined;
  return (
    <div className="rounded-md border border-[#1f303d] bg-[#0b131c] px-2.5 py-1.5 text-[10px] shadow-lg">
      <div className="text-[#687e90]">{ts != null ? `${fmtDate(ts)} ${fmtTime(ts)}` : ""}</div>
      <div className="tnum font-bold text-[#e5f0fb]">{eq != null ? fmtPrice(eq, 0) : "—"}</div>
    </div>
  );
}

function EquityChart({ points, netPositive }: { points: EquityPoint[]; netPositive: boolean }) {
  const rawId = useId();
  const gid = `eq${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;
  const stroke = netPositive ? "#4bc39a" : "#ef777d";
  const data = useMemo(() => downsampleEquity(points, 600), [points]);

  return (
    <div className="w-full" style={{ height: 208 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 6, right: 6, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.32} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="#16222e" />
          <XAxis
            dataKey="t"
            type="number"
            domain={["dataMin", "dataMax"]}
            tickFormatter={(value: number) => fmtDate(value)}
            minTickGap={56}
            tick={{ fill: "#687e90", fontSize: 9 }}
            axisLine={{ stroke: "#1f303d" }}
            tickLine={false}
          />
          <YAxis
            tickFormatter={(value: number) => fmtCompact(value)}
            width={46}
            tick={{ fill: "#687e90", fontSize: 9 }}
            axisLine={false}
            tickLine={false}
            domain={["auto", "auto"]}
          />
          <Tooltip content={<EquityTooltip />} cursor={{ stroke: "#3a5268", strokeDasharray: "3 3" }} />
          <Area
            type="monotone"
            dataKey="eq"
            stroke={stroke}
            strokeWidth={1.4}
            fill={`url(#${gid})`}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// View 1 — Strategy desk
// ---------------------------------------------------------------------------

function StrategyDeskView({
  strategies,
  starterCount,
  loading,
  error,
  seeding,
  seedError,
  onSeed,
  onOpenRun,
  onDeskChanged,
}: {
  strategies: StrategyRow[];
  starterCount: number;
  loading: boolean;
  error: string | null;
  seeding: boolean;
  seedError: string | null;
  onSeed: () => void;
  onOpenRun: (id: string) => void;
  onDeskChanged: () => void;
}) {
  const [quickKey, setQuickKey] = useState<string | null>(null);
  const [quickError, setQuickError] = useState<string | null>(null);
  const [deleteKey, setDeleteKey] = useState<string | null>(null);
  const [confirmKey, setConfirmKey] = useState<string | null>(null);

  useEffect(() => {
    if (!confirmKey) return;
    const t = setTimeout(() => setConfirmKey(null), 4000);
    return () => clearTimeout(t);
  }, [confirmKey]);

  const startersOnDesk = strategies.filter((s) => s.isStarter).length;
  const startersMissing = starterCount > startersOnDesk;

  async function quickTest(s: StrategyRow) {
    setQuickKey(s.key);
    setQuickError(null);
    try {
      const res = await postJson<{ runId: string }>("/api/runs", {
        strategyKey: s.key,
        symbol: "BTCUSDT",
        tf: s.config.timeframe,
        days: 100,
      });
      onOpenRun(res.runId);
    } catch (e) {
      setQuickError(e instanceof Error ? e.message : String(e));
    } finally {
      setQuickKey(null);
    }
  }

  async function deleteStrategy(s: StrategyRow) {
    setDeleteKey(s.key);
    setQuickError(null);
    try {
      await postJson<{ deleted: boolean }>("/api/strategies", { action: "delete", key: s.key });
      setConfirmKey(null);
      onDeskChanged();
    } catch (e) {
      setQuickError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleteKey(null);
    }
  }

  if (error && strategies.length === 0) {
    return (
      <div className="space-y-2.5 fade-in">
        <ErrorLine text={error} />
      </div>
    );
  }

  if (strategies.length === 0) {
    return (
      <div className="h-full min-h-[340px] grid place-items-center fade-in">
        <div className="max-w-md text-center space-y-4 px-4">
          <FlaskConical className="w-8 h-8 mx-auto text-[#3a5268]" />
          <h3 className="text-[16px] font-bold text-[#e5f0fb]">The desk is empty.</h3>
          <p className="text-[11px] leading-relaxed text-[#8193a3]">
            Add the five starter rule sets — a daily Donchian break with a wide trail, a 4H trend rider,
            daily mean reversion, time-series momentum, and the deliberately lethal 300× leverage case
            (on purpose, so the risk model gets measured instead of imagined). Every rule set is data;
            one engine evaluates them all and stores every result, including the losers.
          </p>
          <Button
            onClick={onSeed}
            disabled={seeding}
            className="h-9 px-4 bg-[#123025] text-[#4bc39a] border border-[#2b5c48] hover:bg-[#164030] hover:text-[#6fd7ab] text-[11px] font-bold tracking-wide"
          >
            {seeding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
            {seeding ? "Adding starters…" : "Add starter strategies"}
          </Button>
          {seedError && <ErrorLine text={seedError} />}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2.5 fade-in">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle>
          <FlaskConical className="w-3 h-3 inline mr-1 -mt-0.5" />
          RULE SETS ON THE DESK · {strategies.length}
        </SectionTitle>
        <div className="flex items-center gap-2">
          {startersMissing && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onSeed}
              disabled={seeding}
              className="h-6 px-2 text-[9px] text-[#4bc39a]"
              title="restore missing starter rule sets"
            >
              {seeding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              restore starters
            </Button>
          )}
          <span className="text-[9px] text-[#687e90] hidden sm:inline">every config is data — one engine evaluates them all</span>
        </div>
      </div>

      {error && <ErrorLine text={error} />}
      {loading && <LoadingLine text="refreshing desk…" />}

      <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-2.5">
        {strategies.map((s) => {
          const cfg = s.config;
          const busy = quickKey === s.key;
          return (
            <article
              key={s.id}
              className="flex flex-col gap-2 rounded-lg border border-[#1e303d] bg-[#0d1720] p-3 transition-colors hover:border-[#2b4256]"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h4 className="text-[12px] font-bold text-[#e5f0fb] leading-tight">{s.name}</h4>
                  <div className="mt-0.5 text-[9px] text-[#687e90] truncate" title={s.key}>
                    {s.key} · {cfg.timeframe} · {directionLabel(cfg.direction)}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span
                    className={cn(
                      "chip",
                      s.family === "cautionary" ? "border-[#5c4a2b] text-[#e7b86d]" : ""
                    )}
                  >
                    {s.family}
                  </span>
                  {s.isStarter ? (
                    <Pill className="text-[#4bc39a] border-[#2b5c48] bg-[#123025]">STARTER</Pill>
                  ) : (
                    <Pill
                      className="text-[#73a8e8] border-[#2b4a5c] bg-[#12202c]"
                      title={s.parentKey ? `forked from ${s.parentKey}` : undefined}
                    >
                      FORK v{s.version}
                    </Pill>
                  )}
                </div>
              </div>

              <div className="space-y-1 text-[10px] leading-snug">
                <div>
                  <span className="font-bold text-[#687e90]">ENTRY </span>
                  <span className="text-[#a9bccb]">{entrySummary(cfg.entry)}</span>
                </div>
                <div>
                  <span className="font-bold text-[#687e90]">EXIT · RISK </span>
                  <span className="text-[#a9bccb]">
                    {exitSummary(cfg.exit)} · {riskSummary(cfg.risk)}
                  </span>
                </div>
                <div className="flex items-start gap-1">
                  <ShieldCheck
                    className={cn("w-3 h-3 mt-[3px] shrink-0", cfg.htf ? "text-[#4bc39a]" : "text-[#687e90]")}
                  />
                  <span className={cfg.htf ? "text-[#a9bccb]" : "text-[#687e90]"}>{htfSummary(cfg.htf)}</span>
                </div>
              </div>

              <p className="text-[10px] leading-relaxed text-[#8193a3] flex-1">{s.description}</p>

              <div className="flex items-center justify-between gap-2 pt-1 border-t border-[#18242f]">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => quickTest(s)}
                  disabled={busy || quickKey !== null}
                  className="h-6 px-2 text-[9px] text-[#73a8e8] hover:text-[#a9c8ee]"
                >
                  {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                  {busy ? "running…" : `Test on BTC ${cfg.timeframe} · 100d`}
                </Button>
                {!s.isStarter && (
                  confirmKey === s.key ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => deleteStrategy(s)}
                      disabled={deleteKey !== null}
                      className="h-6 px-2 text-[9px] text-[#ef777d] border border-[#5c2b31] hover:bg-[#2a171c]"
                    >
                      {deleteKey === s.key ? <Loader2 className="w-3 h-3 animate-spin" /> : "confirm delete"}
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConfirmKey(s.key)}
                      aria-label={`Delete ${s.name}`}
                      className="h-6 w-7 p-0 text-[#8193a3] hover:text-[#ef777d]"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )
                )}
              </div>
            </article>
          );
        })}
      </div>

      {quickError && <ErrorLine text={quickError} />}
      {seedError && <ErrorLine text={seedError} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// View 2 — Run (campaign launcher + progress + recent campaigns)
// ---------------------------------------------------------------------------

function CampaignStatusBadge({ status }: { status: string }) {
  const cls =
    status === "RUNNING"
      ? "text-[#e7b86d] border-[#5c4a2b] bg-[#302719]"
      : status === "DONE"
        ? "text-[#4bc39a] border-[#2b5c48] bg-[#123025]"
        : "text-[#ef777d] border-[#5c2b31] bg-[#301919]";
  return (
    <Pill className={cn(cls, status === "RUNNING" && "pulse-dot")}>{status}</Pill>
  );
}

function RunTile({ r, onOpen }: { r: CampaignRunRow; onOpen: (id: string) => void }) {
  const done = r.status === "DONE";
  const failed = r.status === "ERROR";
  return (
    <button
      type="button"
      onClick={() => onOpen(r.id)}
      title={`${r.symbol} ${r.tf} · ${done ? `${r.verdict} · score ${r.robustnessScore.toFixed(0)} · PF ${pfText(r.profitFactor)}` : r.status}`}
      className={cn(
        "flex flex-col items-start gap-1 rounded-lg border bg-[#0b141d] px-2 py-1.5 text-left transition-colors",
        failed
          ? "border-[#5c2b31] hover:border-[#7a3a41]"
          : done
            ? "border-[#233850] hover:border-[#3a5268]"
            : "border-[#1e303d] opacity-70"
      )}
    >
      <span className="flex items-baseline gap-1 w-full min-w-0">
        <span className="text-[10px] font-bold truncate">{r.symbol}</span>
        <span className="text-[9px] text-[#8193a3]">{r.tf}</span>
        {done && (
          <span className={cn("ml-auto text-[10px] font-bold tnum", scoreTextClass(r.robustnessScore))}>
            {r.robustnessScore.toFixed(0)}
          </span>
        )}
      </span>
      {done ? (
        <VerdictBadge verdict={r.verdict} />
      ) : failed ? (
        <Pill className="text-[#ef777d] border-[#5c2b31] bg-[#301919]">ERROR</Pill>
      ) : (
        <span className="text-[9px] text-[#687e90] pulse-dot">{r.status.toLowerCase()}…</span>
      )}
    </button>
  );
}

function CampaignSummaryBlock({ summary }: { summary: CampaignSummaryData }) {
  const counts: Array<{ label: string; n: number; cls: string }> = [
    { label: "PASS", n: summary.passed ?? summary.verdictCounts?.PASS ?? 0, cls: "text-[#4bc39a] border-[#2b5c48] bg-[#123025]" },
    { label: "WATCH", n: summary.watch ?? summary.verdictCounts?.WATCH ?? 0, cls: "text-[#e7b86d] border-[#5c4a2b] bg-[#302719]" },
    { label: "FAIL", n: summary.failed ?? summary.verdictCounts?.FAIL ?? 0, cls: "text-[#ef777d] border-[#5c2b31] bg-[#301919]" },
    { label: "INSUFFICIENT", n: summary.insufficient ?? summary.verdictCounts?.INSUFFICIENT ?? 0, cls: "text-[#8193a3] border-[#2b3e4d] bg-[#152330]" },
  ];
  const top = (summary.top ?? []).slice(0, 10);
  return (
    <div className="space-y-2 fade-in">
      <div className="flex flex-wrap items-center gap-1.5">
        {counts.map((c) => (
          <Pill key={c.label} className={c.cls}>
            {c.label} {c.n}
          </Pill>
        ))}
      </div>
      {top.length > 0 && (
        <div className="overflow-x-auto ami-scroll rounded-lg border border-[#1e303d] bg-[#0b141d]">
          <table className="w-full text-[10px] min-w-[540px]">
            <thead className="bg-[#0e1720]">
              <tr className="border-b border-[#1f303d]">
                <Th>#</Th>
                <Th>symbol</Th>
                <Th>tf</Th>
                <Th>strategy</Th>
                <Th className="text-right">score</Th>
                <Th className="text-right">pf</Th>
              </tr>
            </thead>
            <tbody>
              {top.map((t, i) => (
                <tr key={`${t.symbol}-${t.tf}-${t.strategyKey}`} className="border-b border-[#141f2a] hover:bg-[#0f1a26]">
                  <Td className="text-[#687e90]">{i + 1}</Td>
                  <Td className="font-semibold">{t.symbol}</Td>
                  <Td>{t.tf}</Td>
                  <Td className="max-w-[240px] truncate text-[#8193a3]" title={t.strategyKey}>
                    {t.strategyKey}
                  </Td>
                  <Td className={cn("text-right font-bold", scoreTextClass(t.score))}>{t.score.toFixed(0)}</Td>
                  <Td className="text-right">{pfText(t.pf)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function CampaignProgress({
  campaignId,
  onOpenRun,
  onGoBoard,
}: {
  campaignId: string;
  onOpenRun: (id: string) => void;
  onGoBoard: () => void;
}) {
  const [nonce, setNonce] = useState(0);
  const { data: camp, loading, error } = usePollUntil<CampaignDetail>(
    `/api/campaigns/${encodeURIComponent(campaignId)}?r=${nonce}`,
    2500,
    campaignTerminal
  );

  if (error) {
    return (
      <section className="rounded-lg border border-[#1e303d] bg-[#0d1720] p-3">
        <SectionTitle>CAMPAIGN</SectionTitle>
        <div className="mt-2">
          <ErrorLine text={error} onRetry={() => setNonce((n) => n + 1)} />
        </div>
      </section>
    );
  }
  if (!camp) {
    return (
      <section className="rounded-lg border border-[#1e303d] bg-[#0d1720] p-3">
        {loading ? <LoadingLine text="loading campaign…" /> : <LoadingLine text="campaign unavailable" />}
      </section>
    );
  }

  const pct = camp.total > 0 ? Math.round((camp.done / camp.total) * 100) : 0;
  const durationMs =
    camp.finishedAt && camp.createdAt ? new Date(camp.finishedAt).getTime() - new Date(camp.createdAt).getTime() : null;

  return (
    <section className="rounded-lg border border-[#1e303d] bg-[#0d1720] p-3 space-y-2.5" aria-label="Campaign progress">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <SectionTitle>CAMPAIGN</SectionTitle>
          <div className="text-[11px] font-bold text-[#e5f0fb] truncate" title={camp.label}>
            {camp.label}
          </div>
          <div className="text-[9px] text-[#687e90]">
            {camp.days}d window · {camp.runs.length} stored runs · started {fmtDate(camp.createdAt)} {fmtTime(camp.createdAt)}
            {durationMs != null ? ` · finished in ${fmtCountdown(durationMs)}` : ""}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <CampaignStatusBadge status={camp.status} />
          {camp.status === "DONE" && (
            <Button size="sm" variant="ghost" onClick={onGoBoard} className="h-6 px-2 text-[9px] text-[#73a8e8]">
              <Trophy className="w-3 h-3" />
              open leaderboard
            </Button>
          )}
        </div>
      </div>

      <div>
        <div className="flex justify-between text-[9px] text-[#687e90] mb-1">
          <span>{camp.status === "RUNNING" ? <span className="pulse-dot">running — polling every 2.5s</span> : "complete"}</span>
          <span className="tnum">
            {camp.done}/{camp.total} done{camp.failed > 0 ? ` · ${camp.failed} failed` : ""}
          </span>
        </div>
        <div className="h-2 rounded-full bg-[#1c2a38] overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${pct}%`, background: camp.failed > 0 ? "#e7b86d" : "#4bc39a" }}
          />
        </div>
      </div>

      {camp.runs.length > 0 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-1.5">
          {camp.runs.map((r) => (
            <RunTile key={r.id} r={r} onOpen={onOpenRun} />
          ))}
        </div>
      ) : (
        camp.status === "RUNNING" && (
          <div className="text-[10px] text-[#687e90]">no runs completed yet — tiles appear as markets finish…</div>
        )
      )}

      {camp.status === "DONE" && camp.summary && <CampaignSummaryBlock summary={camp.summary} />}
      {camp.status === "ERROR" && <ErrorLine text={camp.summary?.error ?? "campaign failed"} />}
    </section>
  );
}

function RecentCampaigns({
  data,
  loading,
  error,
  activeId,
  onPick,
}: {
  data: CampaignsResponse | null;
  loading: boolean;
  error: string | null;
  activeId: string | null;
  onPick: (id: string) => void;
}) {
  const campaigns = (data?.campaigns ?? []).slice(0, 8);
  return (
    <section className="space-y-2" aria-label="Recent campaigns">
      <div className="flex items-center justify-between gap-2">
        <SectionTitle>RECENT CAMPAIGNS</SectionTitle>
        <span className="text-[9px] text-[#687e90]">click a campaign to view its results</span>
      </div>
      {error && <ErrorLine text={error} />}
      {loading && !data && <LoadingLine text="loading campaigns…" />}
      {data && campaigns.length === 0 && (
        <div className="rounded-lg border border-[#1e303d] bg-[#0d1720] p-3 text-[10px] text-[#687e90]">
          No campaigns yet — launch a sweep above.
        </div>
      )}
      {campaigns.length > 0 && (
        <div className="overflow-x-auto ami-scroll rounded-lg border border-[#1e303d] bg-[#0b141d]">
          <table className="w-full text-[10px] min-w-[720px]">
            <thead className="bg-[#0e1720]">
              <tr className="border-b border-[#1f303d]">
                <Th>when</Th>
                <Th>label</Th>
                <Th>status</Th>
                <Th className="text-right">runs</Th>
                <Th className="text-right">days</Th>
                <Th className="text-right">symbols</Th>
                <Th>tfs</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr
                  key={c.id}
                  className={cn(
                    "border-b border-[#141f2a] hover:bg-[#0f1a26]",
                    activeId === c.id && "bg-[#101d2a]"
                  )}
                >
                  <Td className="text-[#8193a3]">
                    {fmtDate(c.createdAt)} {fmtTime(c.createdAt)}
                  </Td>
                  <Td className="max-w-[260px] truncate font-semibold" title={c.label}>
                    {c.label}
                  </Td>
                  <Td>
                    <CampaignStatusBadge status={c.status} />
                  </Td>
                  <Td className="text-right">
                    {c.done}/{c.total}
                    {c.failed > 0 ? <span className="text-[#ef777d]"> ({c.failed}x)</span> : null}
                  </Td>
                  <Td className="text-right">{c.days}</Td>
                  <Td className="text-right" title={(c.symbols ?? []).join(", ")}>
                    {c.symbols?.length ?? "—"}
                  </Td>
                  <Td className="text-[#8193a3]">{(c.tfs ?? []).join(" ") || "—"}</Td>
                  <Td>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onPick(c.id)}
                      className="h-5 px-1.5 text-[9px] text-[#73a8e8]"
                    >
                      view
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function RunView({
  strategies,
  strategiesLoading,
  seeding,
  seedError,
  onSeed,
  activeCampaignId,
  onPickCampaign,
  campaigns,
  campaignsLoading,
  campaignsError,
  onOpenRun,
  onCampaignsChanged,
  onGoBoard,
}: {
  strategies: StrategyRow[];
  strategiesLoading: boolean;
  seeding: boolean;
  seedError: string | null;
  onSeed: () => void;
  activeCampaignId: string | null;
  onPickCampaign: (id: string) => void;
  campaigns: CampaignsResponse | null;
  campaignsLoading: boolean;
  campaignsError: string | null;
  onOpenRun: (id: string) => void;
  onCampaignsChanged: () => void;
  onGoBoard: () => void;
}) {
  const [selStrat, setSelStrat] = useState<Set<string>>(new Set());
  const [selSyms, setSelSyms] = useState<Set<string>>(new Set(["BTCUSDT"]));
  const [selTfs, setSelTfs] = useState<Set<string>>(new Set(["1d"]));
  const [days, setDays] = useState(100);
  const [label, setLabel] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const initedRef = useRef(false);

  useEffect(() => {
    if (initedRef.current || strategies.length === 0) return;
    initedRef.current = true;
    setSelStrat(new Set([strategies[0].key]));
  }, [strategies]);

  const scrollToProgress = useCallback(() => {
    progressRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const estimate = selStrat.size * selSyms.size * selTfs.size;
  const missing: string[] = [];
  if (selStrat.size === 0) missing.push("a rule set");
  if (selSyms.size === 0) missing.push("a market");
  if (selTfs.size === 0) missing.push("a timeframe");

  async function startCampaign() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await postJson<{ campaignId: string }>("/api/campaigns", {
        label: label.trim() || undefined,
        strategyKeys: [...selStrat],
        symbols: [...selSyms],
        tfs: [...selTfs],
        days,
      });
      onPickCampaign(res.campaignId);
      onCampaignsChanged();
      setLabel("");
      window.setTimeout(scrollToProgress, 50);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  function pickCampaign(id: string) {
    onPickCampaign(id);
    window.setTimeout(scrollToProgress, 50);
  }

  function setGroup(groupSyms: string[], on: boolean) {
    setSelSyms((prev) => {
      const next = new Set(prev);
      for (const s of groupSyms) {
        if (on) next.add(s);
        else next.delete(s);
      }
      return next;
    });
  }

  return (
    <div className="space-y-2.5 fade-in">
      {/* -------- sweep form -------- */}
      <section className="rounded-lg border border-[#1e303d] bg-[#0d1720] p-3 space-y-3" aria-label="New campaign">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <SectionTitle>
            <Play className="w-3 h-3 inline mr-1 -mt-0.5" />
            NEW SWEEP
          </SectionTitle>
          <span className="text-[9px] text-[#687e90]">one rule set across many markets — every result stored, ranked by robustness</span>
        </div>

        {strategiesLoading && strategies.length === 0 && <LoadingLine text="loading strategies…" />}
        {strategies.length === 0 && !strategiesLoading && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#5c4a2b] bg-[#241d10] px-3 py-2">
            <span className="text-[10px] text-[#e7b86d]">
              The desk is empty — add the five starter rule sets first (including the 300× case, on purpose).
            </span>
            <Button
              size="sm"
              onClick={onSeed}
              disabled={seeding}
              className="h-7 px-3 bg-[#123025] text-[#4bc39a] border border-[#2b5c48] hover:bg-[#164030] text-[10px]"
            >
              {seeding ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
              Add starter strategies
            </Button>
          </div>
        )}
        {seedError && <ErrorLine text={seedError} />}

        {strategies.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-bold tracking-[0.08em] text-[#687e90]">
                STRATEGIES · {selStrat.size}/{strategies.length} selected
              </span>
              <span className="flex gap-0.5">
                <MiniLink onClick={() => setSelStrat(new Set(strategies.map((s) => s.key)))}>all</MiniLink>
                <MiniLink onClick={() => setSelStrat(new Set())}>none</MiniLink>
              </span>
            </div>
            <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-1.5 max-h-56 overflow-y-auto ami-scroll pr-0.5">
              {strategies.map((s) => {
                const cid = `lab-strat-${s.key}`;
                const sel = selStrat.has(s.key);
                return (
                  <div
                    key={s.id}
                    className={cn(
                      "flex items-start gap-2 rounded-lg border p-2 transition-colors",
                      sel ? "border-[#34506a] bg-[#152436]" : "border-[#1e303d] bg-[#0b141d] hover:border-[#2b4256]"
                    )}
                  >
                    <Checkbox
                      id={cid}
                      checked={sel}
                      onCheckedChange={() => setSelStrat((prev) => toggleInSet(prev, s.key))}
                      className="mt-0.5 border-[#3a5268] data-[state=checked]:bg-[#4bc39a] data-[state=checked]:border-[#4bc39a] data-[state=checked]:text-[#08120c]"
                    />
                    <label htmlFor={cid} className="min-w-0 flex-1 cursor-pointer">
                      <span className="block text-[11px] font-semibold leading-tight truncate" title={s.name}>
                        {s.name}
                      </span>
                      <span className="block text-[9px] text-[#687e90] truncate">
                        {s.family} · {s.config.timeframe} · {s.isStarter ? "starter" : "fork"}
                      </span>
                    </label>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-x-4 gap-y-3">
          {/* symbols */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-bold tracking-[0.08em] text-[#687e90]">
                MARKETS · {selSyms.size}/{ALL_SYMBOLS.length}
              </span>
              <span className="flex gap-0.5">
                <MiniLink onClick={() => setGroup(ALL_SYMBOLS, true)}>all</MiniLink>
                <MiniLink onClick={() => setGroup(ALL_SYMBOLS, false)}>none</MiniLink>
              </span>
            </div>
            <div className="space-y-2">
              {SYMBOL_GROUPS.map((g) => {
                const allOn = g.symbols.every((s) => selSyms.has(s));
                return (
                  <div key={g.label}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="text-[8px] font-bold tracking-[0.1em] text-[#687e90]">{g.label}</span>
                      <MiniLink onClick={() => setGroup(g.symbols, !allOn)}>{allOn ? "none" : "all"}</MiniLink>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {g.symbols.map((sym) => (
                        <ToggleChip
                          key={sym}
                          active={selSyms.has(sym)}
                          onClick={() => setSelSyms((prev) => toggleInSet(prev, sym))}
                        >
                          {sym}
                        </ToggleChip>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* tfs + days + label */}
          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-bold tracking-[0.08em] text-[#687e90]">TIMEFRAMES · {selTfs.size}</span>
                <span className="flex gap-0.5">
                  <MiniLink onClick={() => setSelTfs(new Set(ALL_TFS))}>all</MiniLink>
                  <MiniLink onClick={() => setSelTfs(new Set())}>none</MiniLink>
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {ALL_TFS.map((tf) => (
                  <ToggleChip key={tf} active={selTfs.has(tf)} onClick={() => setSelTfs((prev) => toggleInSet(prev, tf))}>
                    {tf}
                  </ToggleChip>
                ))}
              </div>
              <p className="text-[9px] text-[#687e90]">each rule set is re-tested on every selected timeframe</p>
            </div>

            <div className="space-y-1.5">
              <span className="text-[9px] font-bold tracking-[0.08em] text-[#687e90]">LOOKBACK · DAYS</span>
              <div className="flex flex-wrap gap-1">
                {DAY_CHOICES.map((d) => (
                  <ToggleChip
                    key={d.days}
                    active={days === d.days}
                    onClick={() => setDays(d.days)}
                    title={d.days >= 1000 ? "deep rerun pulls extended history — may take minutes" : undefined}
                  >
                    {d.label}
                  </ToggleChip>
                ))}
              </div>
              <p className="text-[9px] text-[#687e90]">deep reruns pull extended history and may take minutes</p>
            </div>

            <div className="space-y-1.5">
              <span className="text-[9px] font-bold tracking-[0.08em] text-[#687e90]">LABEL (OPTIONAL)</span>
              <Input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="campaign label"
                maxLength={80}
                className="h-8 bg-[#0b141d] border-[#2b3e4d] text-[11px] placeholder:text-[#4d6273]"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[#18242f]">
          <div className="text-[9px] text-[#687e90]">
            {selStrat.size}×{selSyms.size}×{selTfs.size} = <span className="tnum font-bold text-[#aebdca]">{estimate}</span> runs
            {selStrat.size > 8 && <span className="text-[#e7b86d]"> · a sweep uses at most 8 rule sets</span>}
            {estimate > 40 && selStrat.size <= 8 && (
              <span className="text-[#e7b86d]"> · heavy sweep — data fetches may take a while</span>
            )}
          </div>
          <Button
            onClick={startCampaign}
            disabled={submitting || missing.length > 0 || strategies.length === 0}
            className="h-8 px-4 bg-[#123025] text-[#4bc39a] border border-[#2b5c48] hover:bg-[#164030] hover:text-[#6fd7ab] text-[11px] font-bold tracking-wide"
          >
            {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            {submitting ? "starting…" : estimate > 0 ? `Run campaign · ${estimate} runs` : "Run campaign"}
          </Button>
        </div>
        {missing.length > 0 && (
          <p className="text-[9px] text-[#e7b86d]">select {missing.join(", ")} to launch the sweep</p>
        )}
        {submitError && <ErrorLine text={submitError} />}
      </section>

      {/* -------- active campaign progress -------- */}
      {activeCampaignId && (
        <div ref={progressRef}>
          <CampaignProgress campaignId={activeCampaignId} onOpenRun={onOpenRun} onGoBoard={onGoBoard} />
        </div>
      )}

      <RecentCampaigns
        data={campaigns}
        loading={campaignsLoading}
        error={campaignsError}
        activeId={activeCampaignId}
        onPick={pickCampaign}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// View 3 — Leaderboard
// ---------------------------------------------------------------------------

function LeaderboardView({ onOpenRun }: { onOpenRun: (id: string) => void }) {
  const board = usePolling<LeaderboardResponse>("/api/leaderboard", 30_000);
  const rows = board.data?.leaderboard ?? [];

  return (
    <div className="space-y-2.5 fade-in">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle>
          <Trophy className="w-3 h-3 inline mr-1 -mt-0.5" />
          ROBUSTNESS LEADERBOARD
        </SectionTitle>
        <span className="chip">{board.data ? `updated ${fmtTime(board.data.generatedAt)}` : "—"}</span>
      </div>
      <p className="text-[9px] text-[#687e90]">
        ranked by robustness — profit factor, t-stat, sample size, split-sample stability, drawdown — never by
        return alone. Best run per strategy × symbol × timeframe. Click a row for the full run detail.
      </p>

      {board.error && <ErrorLine text={board.error} />}
      {board.loading && rows.length === 0 && !board.error && <LoadingLine text="ranking stored runs…" />}
      {rows.length === 0 && !board.loading && !board.error && (
        <div className="rounded-lg border border-[#1e303d] bg-[#0d1720] p-8 text-center text-[11px] text-[#687e90]">
          No stored runs yet — run a campaign or a quick test. Every result is stored, including the losers.
        </div>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto ami-scroll rounded-lg border border-[#1e303d] bg-[#0b141d]">
          <table className="w-full text-[10px] min-w-[1080px]">
            <thead className="bg-[#0e1720]">
              <tr className="border-b border-[#1f303d]">
                <Th>#</Th>
                <Th>score</Th>
                <Th>grade</Th>
                <Th>strategy</Th>
                <Th>sym</Th>
                <Th>tf</Th>
                <Th className="text-right">trades</Th>
                <Th className="text-right">pf</Th>
                <Th className="text-right">t-stat</Th>
                <Th className="text-right">net</Th>
                <Th className="text-right">maxdd</Th>
                <Th>split note</Th>
                <Th>verdict</Th>
                <Th className="text-right">window</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={r.id}
                  tabIndex={0}
                  aria-label={`open run: ${r.strategyName} on ${r.symbol} ${r.tf}, score ${r.score.toFixed(0)}`}
                  onClick={() => onOpenRun(r.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpenRun(r.id);
                    }
                  }}
                  className="border-b border-[#141f2a] hover:bg-[#0f1a26] cursor-pointer focus-visible:bg-[#0f1a26] focus-visible:outline-none"
                >
                  <Td className={cn(i < 3 ? "font-bold text-[#aebdca]" : "text-[#687e90]")}>{i + 1}</Td>
                  <Td>
                    <span className="flex items-center gap-1.5">
                      <span className={cn("tnum font-bold", scoreTextClass(r.score))}>{r.score.toFixed(0)}</span>
                      <ScoreBar score={r.score} />
                    </span>
                  </Td>
                  <Td>
                    <Pill className={gradeClass(r.grade)}>{r.grade}</Pill>
                  </Td>
                  <Td className="max-w-[220px] truncate font-semibold" title={r.strategyName}>
                    {r.strategyName}
                  </Td>
                  <Td>{r.symbol}</Td>
                  <Td>{r.tf}</Td>
                  <Td className="text-right">{r.trades}</Td>
                  <Td className="text-right">{pfText(r.pf)}</Td>
                  <Td className="text-right">{r.tStat >= 99 ? "99+" : r.tStat.toFixed(2)}</Td>
                  <Td className={cn("text-right", pnlClass(r.netReturnPct))}>{fmtPct(r.netReturnPct, 1)}</Td>
                  <Td className="text-right text-[#e7b86d]">{r.maxDrawdownPct.toFixed(1)}%</Td>
                  <Td className="max-w-[170px] truncate text-[#8193a3]" title={r.splitNote}>
                    {r.splitNote || "—"}
                  </Td>
                  <Td>
                    <VerdictBadge verdict={r.verdict} />
                  </Td>
                  <Td className="text-right text-[#8193a3]">{r.days}d</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// View 4 — Run detail
// ---------------------------------------------------------------------------

function RobustnessBlock({ rob }: { rob: RobustnessScore }) {
  const comps: Array<{ key: keyof RobustnessScore["components"]; label: string; max: number }> = [
    { key: "edge", label: "edge", max: 35 },
    { key: "significance", label: "sig", max: 25 },
    { key: "sample", label: "sample", max: 20 },
    { key: "stability", label: "stability", max: 15 },
    { key: "risk", label: "risk", max: 10 },
  ];
  return (
    <div className="shrink-0">
      <div className="flex items-baseline justify-end gap-1.5">
        <span className={cn("text-[24px] leading-none font-extrabold tnum", scoreTextClass(rob.score))}>
          {rob.score.toFixed(0)}
        </span>
        <Pill className={gradeClass(rob.grade)}>GRADE {rob.grade}</Pill>
      </div>
      <div className="mt-1.5 space-y-1">
        {comps.map((c) => (
          <div key={c.key} className="flex items-center gap-1.5" title={`${c.label} component ${rob.components[c.key]}/${c.max}`}>
            <span className="w-[52px] text-right text-[8px] uppercase tracking-[0.06em] text-[#687e90]">{c.label}</span>
            <MiniBar value={rob.components[c.key]} max={c.max} color={scoreColor(rob.score)} className="w-[72px]" />
            <span className="w-[16px] text-[8px] tnum text-[#8193a3]">{rob.components[c.key]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function metricCells(m: RunMetrics): Array<{ label: string; value: string; cls?: string; sub?: string }> {
  return [
    {
      label: "PROFIT FACTOR",
      value: pfText(m.profitFactor),
      cls: m.profitFactor >= 1.3 ? "text-[#4bc39a]" : m.profitFactor < 1 ? "text-[#ef777d]" : undefined,
    },
    { label: "EXPECTANCY", value: `${m.expectancyR >= 0 ? "+" : ""}${m.expectancyR.toFixed(2)}R`, cls: pnlClass(m.expectancyR) },
    {
      label: "T-STAT",
      value: m.tStat >= 99 ? "99+" : m.tStat.toFixed(2),
      cls: Math.abs(m.tStat) >= 2 ? "text-[#4bc39a]" : undefined,
    },
    { label: "TRADES", value: String(m.trades), sub: `${m.wins}W · ${m.losses}L` },
    { label: "WIN RATE", value: `${m.winRate.toFixed(1)}%` },
    { label: "NET RETURN", value: fmtPct(m.netReturnPct), cls: pnlClass(m.netReturnPct) },
    {
      label: "MAX DRAWDOWN",
      value: `${m.maxDrawdownPct.toFixed(1)}%`,
      cls: m.maxDrawdownPct > 25 ? "text-[#ef777d]" : m.maxDrawdownPct > 15 ? "text-[#e7b86d]" : undefined,
    },
    { label: "COST DRAG", value: `${m.costDragPct.toFixed(2)}%` },
    { label: "EXPOSURE", value: `${m.exposurePct.toFixed(0)}%` },
    {
      label: "LIQUIDATIONS",
      value: String(m.liquidations),
      cls: m.liquidations > 0 ? "text-[#ef777d]" : "text-[#4bc39a]",
      sub: m.leverageWickouts > 0 ? `${m.leverageWickouts} wickouts` : undefined,
    },
    {
      label: "CAGR",
      value: m.cagrPct != null ? fmtPct(m.cagrPct) : "N/A",
      cls: m.cagrPct != null ? pnlClass(m.cagrPct) : "text-[#687e90]",
    },
    { label: "FINAL EQUITY", value: fmtPrice(m.finalEquity, 0), sub: `net ${fmtPrice(m.netProfit, 0)}`, cls: pnlClass(m.netProfit) },
  ];
}

function SplitHalfCard({ title, h }: { title: string; h: SplitHalf }) {
  return (
    <div className="rounded-lg border border-[#1e303d] bg-[#0b141d] p-2.5 space-y-1">
      <div className="text-[9px] font-bold tracking-[0.08em] text-[#687e90]">{title}</div>
      <div className="flex justify-between text-[10px]">
        <span className="text-[#8193a3]">trades</span>
        <span className="tnum">{h.trades}</span>
      </div>
      <div className="flex justify-between text-[10px]">
        <span className="text-[#8193a3]">profit factor</span>
        <span className="tnum">{pfText(h.pf)}</span>
      </div>
      <div className="flex justify-between text-[10px]">
        <span className="text-[#8193a3]">expectancy</span>
        <span className={cn("tnum", pnlClass(h.expectancyR))}>
          {h.expectancyR >= 0 ? "+" : ""}
          {h.expectancyR.toFixed(2)}R
        </span>
      </div>
      <div className="flex justify-between text-[10px]">
        <span className="text-[#8193a3]">net</span>
        <span className={cn("tnum", pnlClass(h.net))}>{fmtPrice(h.net, 0)}</span>
      </div>
    </div>
  );
}

function SplitSection({ split }: { split: RobustnessSplit }) {
  const badge = split.decayed ? (
    <Pill className="text-[#ef777d] border-[#5c2b31] bg-[#301919]">DECAYED</Pill>
  ) : split.consistent ? (
    <Pill className="text-[#4bc39a] border-[#2b5c48] bg-[#123025]">CONSISTENT</Pill>
  ) : (
    <Pill className="text-[#e7b86d] border-[#5c4a2b] bg-[#302719]">ONE-HALF-EDGE</Pill>
  );

  return (
    <section className="rounded-lg border border-[#1e303d] bg-[#0d1720] p-3 space-y-2" aria-label="Split-sample check">
      <div className="flex items-center justify-between">
        <SectionTitle>SPLIT-SAMPLE CHECK</SectionTitle>
        {badge}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <SplitHalfCard title="FIRST HALF" h={split.first} />
        <SplitHalfCard title="SECOND HALF" h={split.second} />
      </div>
      {split.note && <p className="text-[10px] text-[#8193a3] leading-relaxed">{split.note}</p>}
    </section>
  );
}

function TradesTable({ trades }: { trades: Trade[] }) {
  return (
    <div className="max-h-[320px] overflow-auto ami-scroll rounded-lg border border-[#1e303d] bg-[#0b141d]">
      <table className="w-full text-[10px] min-w-[860px]">
        <thead className="sticky top-0 bg-[#0e1720] z-10">
          <tr className="border-b border-[#1f303d]">
            <Th>#</Th>
            <Th>dir</Th>
            <Th>entry time</Th>
            <Th className="text-right">entry</Th>
            <Th>exit time</Th>
            <Th className="text-right">exit</Th>
            <Th>reason</Th>
            <Th className="text-right">r</Th>
            <Th className="text-right">pnl</Th>
            <Th className="text-right">mfe r</Th>
            <Th className="text-right">mae r</Th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t, i) => (
            <tr key={t.id} className="border-b border-[#141f2a] hover:bg-[#0f1a26]">
              <Td className="text-[#687e90]">{i + 1}</Td>
              <Td>
                <span className={cn("font-bold", t.dir === 1 ? "text-[#4bc39a]" : "text-[#ef777d]")}>
                  {t.dir === 1 ? "LONG" : "SHORT"}
                </span>
              </Td>
              <Td className="text-[#8193a3]">
                {fmtDate(t.entryTs)} {fmtTime(t.entryTs)}
              </Td>
              <Td className="text-right">{fmtPx(t.entryPrice)}</Td>
              <Td className="text-[#8193a3]">
                {fmtDate(t.exitTs)} {fmtTime(t.exitTs)}
              </Td>
              <Td className="text-right">{fmtPx(t.exitPrice)}</Td>
              <Td>
                <Pill className={exitReasonClass(t.exitReason)}>{t.exitReason}</Pill>
              </Td>
              <Td className={cn("text-right font-semibold", pnlClass(t.r))}>
                {t.r >= 0 ? "+" : ""}
                {t.r.toFixed(2)}
              </Td>
              <Td className={cn("text-right", pnlClass(t.pnl))}>{fmtPrice(t.pnl, 2)}</Td>
              <Td className="text-right text-[#4bc39a]">{t.mfeR.toFixed(2)}</Td>
              <Td className="text-right text-[#ef777d]">{t.maeR.toFixed(2)}</Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DataQualitySection({ dq, warmupBars }: { dq: DataQualityInfo; warmupBars: number | null }) {
  const htf = dq.htfQuality;
  return (
    <section className="rounded-lg border border-[#1e303d] bg-[#0d1720] p-2.5" aria-label="Data quality">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[9px] text-[#8193a3]">
        <span className="font-extrabold tracking-[0.08em] text-[#aebdca]">DATA QUALITY</span>
        <span title={dq.providerSymbol}>
          provider <span className="text-[#c5d3df] font-semibold">{dq.provider}</span> ({dq.providerSymbol})
        </span>
        <span className="tnum">{dq.bars} bars</span>
        <Pill className={coverageClass(dq.coverage)}>{dq.coverage}</Pill>
        {dq.resampledFrom && <span>resampled from {dq.resampledFrom}</span>}
        <span className="tnum">covered {dq.coveredDays}d of {dq.requestedDays ?? dq.coveredDays}d</span>
        <span className="tnum">test window {dq.testWindowDays ?? "—"}d</span>
        <span className="tnum">warmup {dq.warmupDaysConsumed != null ? `${dq.warmupDaysConsumed}d` : warmupBars != null ? `${warmupBars} bars` : "—"}</span>
        <span className={dq.gapsDetected === 0 ? "text-[#4bc39a]" : "text-[#ef777d] tnum"}>
          {dq.gapsDetected === 0 ? "no gaps" : `${dq.gapsDetected} gaps`}
        </span>
        <span>{dq.session}</span>
        {htf && (
          <span title={`HTF feed: ${htf.provider} ${htf.providerSymbol}`}>
            htf feed <span className={htf.coverage === "FULL" ? "text-[#4bc39a]" : "text-[#e7b86d]"}>{htf.coverage}</span>
          </span>
        )}
        {dq.note && (
          <span className="truncate max-w-[280px]" title={dq.note}>
            {dq.note}
          </span>
        )}
      </div>
    </section>
  );
}

function FindingIcon({ severity }: { severity: ReviewFinding["severity"] }) {
  if (severity === "critical") return <AlertOctagon className="w-3.5 h-3.5 shrink-0 text-[#ef777d]" />;
  if (severity === "warn") return <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-[#e7b86d]" />;
  return <Info className="w-3.5 h-3.5 shrink-0 text-[#73a8e8]" />;
}

function ReviewSection({
  review,
  canFork,
  busyIdx,
  phase,
  error,
  onFork,
}: {
  review: AutoReview;
  canFork: boolean;
  busyIdx: number | null;
  phase: "fork" | "run";
  error: string | null;
  onFork: (idx: number, s: ReviewSuggestion) => void;
}) {
  return (
    <section className="rounded-lg border border-[#1e303d] bg-[#0d1720] p-3 space-y-2.5" aria-label="Auto review">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle>AUTO-REVIEW</SectionTitle>
        <span className="text-[9px] text-[#687e90]">generated {fmtDate(review.generatedAt)} {fmtTime(review.generatedAt)}</span>
      </div>
      <p className="text-[11px] font-bold text-[#e5f0fb]">{review.verdict}</p>

      {review.findings.length > 0 && (
        <ul className="space-y-1">
          {review.findings.map((f, i) => (
            <li key={i} className="flex items-start gap-1.5 text-[10px] leading-relaxed">
              <span className="mt-[1px]">
                <FindingIcon severity={f.severity} />
              </span>
              <span
                className={cn(
                  f.severity === "critical"
                    ? "text-[#f0a4a8]"
                    : f.severity === "warn"
                      ? "text-[#e2c48c]"
                      : "text-[#a9c8ee]"
                )}
              >
                {f.message}
              </span>
            </li>
          ))}
        </ul>
      )}

      {review.suggestions.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
          {review.suggestions.slice(0, 4).map((s, idx) => {
            const busy = busyIdx === idx;
            return (
              <div key={idx} className="flex flex-col gap-1.5 rounded-lg border border-[#253a4a] bg-[#0c1a26] p-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[11px] font-bold text-[#e5f0fb] leading-tight">{s.title}</span>
                  <GitBranch className="w-3 h-3 text-[#687e90] shrink-0 mt-0.5" />
                </div>
                <p className="text-[10px] text-[#8193a3] leading-relaxed">{s.detail}</p>
                <p className="text-[10px] text-[#4bc39a] leading-relaxed">expected effect — {s.expectedEffect}</p>
                <p className="text-[9px] text-[#687e90] font-mono truncate" title={patchSummary(s.patch)}>
                  patch: {patchSummary(s.patch)}
                </p>
                <Button
                  size="sm"
                  onClick={() => onFork(idx, s)}
                  disabled={busy || busyIdx !== null || !canFork}
                  title={canFork ? "fork this rule set with the patch and re-run the same market & window" : "strategy no longer on the desk — cannot fork"}
                  className="h-7 px-3 self-start bg-[#12202c] text-[#73a8e8] border border-[#2b4a5c] hover:bg-[#16283a] hover:text-[#a9c8ee] text-[10px] font-semibold"
                >
                  {busy ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <GitBranch className="w-3 h-3" />
                  )}
                  {busy ? (phase === "fork" ? "forking…" : "re-running…") : "Fork & re-run"}
                </Button>
              </div>
            );
          })}
        </div>
      )}
      {error && <ErrorLine text={error} />}
    </section>
  );
}

function RunDetailView({
  runId,
  forkStack,
  onBack,
  onForked,
  onGoBoard,
  onRunDeleted,
}: {
  runId: string;
  forkStack: ForkCrumb[];
  onBack: () => void;
  onForked: (newRunId: string, fromLabel: string, fromRunId: string) => void;
  onGoBoard: () => void;
  onRunDeleted: (runId: string) => void;
}) {
  const [nonce, setNonce] = useState(0);
  const { data: run, error, loading } = usePollUntil<RunDetail>(
    `/api/runs/${encodeURIComponent(runId)}?r=${nonce}`,
    2500,
    runTerminal
  );
  const health = usePolling<HealthLite>("/api/health", 120_000);

  const [forkBusyIdx, setForkBusyIdx] = useState<number | null>(null);
  const [forkPhase, setForkPhase] = useState<"fork" | "run">("fork");
  const [forkError, setForkError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!confirmDelete) return;
    const t = setTimeout(() => setConfirmDelete(false), 4000);
    return () => clearTimeout(t);
  }, [confirmDelete]);

  async function forkAndRerun(idx: number, s: ReviewSuggestion) {
    if (!run?.strategy) {
      setForkError("strategy no longer on the desk — cannot fork");
      return;
    }
    setForkBusyIdx(idx);
    setForkPhase("fork");
    setForkError(null);
    try {
      const fork = await postJson<ForkResponse>("/api/strategies", {
        action: "fork",
        key: run.strategy.key,
        patch: s.patch,
      });
      setForkPhase("run");
      const res = await postJson<{ runId: string }>("/api/runs", {
        strategyKey: fork.key,
        symbol: run.symbol,
        tf: run.tf,
        days: run.daysRequested,
      });
      onForked(res.runId, `${run.strategy.name} · ${run.symbol} ${run.tf}`, run.id);
    } catch (e) {
      setForkError(e instanceof Error ? e.message : String(e));
    } finally {
      setForkBusyIdx(null);
    }
  }

  async function doDelete() {
    if (!run) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await requestJson<{ deleted: boolean }>(`/api/runs/${encodeURIComponent(run.id)}`, "DELETE");
      onRunDeleted(run.id);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
      setDeleting(false);
    }
  }

  if (error) {
    return (
      <div className="space-y-2.5 fade-in">
        <ErrorLine text={error} onRetry={() => setNonce((n) => n + 1)} />
        <Button size="sm" variant="ghost" onClick={onGoBoard} className="h-7 px-2 text-[10px] text-[#8193a3]">
          <ArrowLeft className="w-3 h-3" />
          back to leaderboard
        </Button>
      </div>
    );
  }

  if (!run) {
    return (
      <div className="py-10 grid place-items-center fade-in">
        {loading ? <LoadingLine text={`loading run ${runId.slice(0, 8)}…`} /> : <LoadingLine text="run unavailable" />}
      </div>
    );
  }

  if (run.status === "ERROR") {
    return (
      <div className="space-y-2.5 fade-in">
        <section className="rounded-lg border border-[#5c2b31] bg-[#221416] p-4 space-y-1.5">
          <div className="flex items-center gap-2">
            <AlertOctagon className="w-4 h-4 text-[#ef777d]" />
            <span className="text-[12px] font-bold text-[#ef777d]">RUN ERROR</span>
          </div>
          <p className="text-[10px] text-[#f0a4a8] break-words">{run.error ?? "unknown error"}</p>
          <p className="text-[9px] text-[#8193a3]">
            {run.symbol} {run.tf} · {run.daysRequested}d window · {fmtDate(run.createdAt)} {fmtTime(run.createdAt)}
          </p>
        </section>
        {deleteError && <ErrorLine text={deleteError} />}
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => setNonce((n) => n + 1)} className="h-7 px-2 text-[10px] text-[#73a8e8]">
            <RefreshCw className="w-3 h-3" />
            retry
          </Button>
          <Button size="sm" variant="ghost" onClick={onGoBoard} className="h-7 px-2 text-[10px] text-[#8193a3]">
            back to leaderboard
          </Button>
        </div>
      </div>
    );
  }

  if (run.status !== "DONE") {
    return (
      <div className="py-12 grid place-items-center fade-in">
        <div className="text-center space-y-2">
          <Loader2 className="w-5 h-5 animate-spin mx-auto text-[#e7b86d]" />
          <div className="text-[11px] text-[#aebdca] font-semibold">
            backtest running — {run.symbol} {run.tf}
          </div>
          <div className="text-[10px] text-[#687e90]">polling every 2.5s — results land here when the engine finishes</div>
        </div>
      </div>
    );
  }

  // ---- DONE: full detail -----------------------------------------------------
  const m = run.metrics;
  const rob = m?.robustness ?? null;
  const split = m?.split ?? null;
  const verdict = m?.verdict ?? "UNKNOWN";
  const engine = m?.engineVersion ?? health.data?.engineVersion ?? null;
  const cfg = run.strategy?.config ?? null;
  const parentCrumb = forkStack[forkStack.length - 1];

  return (
    <div className="space-y-2.5 fade-in" key={run.id}>
      {parentCrumb && (
        <div className="flex flex-wrap items-center gap-2 text-[10px]">
          <Button
            size="sm"
            variant="ghost"
            onClick={onBack}
            className="h-6 px-2 text-[10px] text-[#73a8e8] hover:text-[#a9c8ee]"
          >
            <ArrowLeft className="w-3 h-3" />
            back
          </Button>
          <GitBranch className="w-3 h-3 text-[#687e90]" />
          <span className="text-[#8193a3]">
            forked from <span className="text-[#c5d3df] font-semibold">{parentCrumb.label}</span>
            {forkStack.length > 1 ? ` · ${forkStack.length} forks deep` : ""}
          </span>
        </div>
      )}

      {/* header */}
      <section className="rounded-lg border border-[#1e303d] bg-[#0d1720] p-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[15px] font-bold text-[#e5f0fb] leading-tight">
                {run.strategy?.name ?? "(strategy removed)"}
              </h3>
              <VerdictBadge verdict={verdict} big />
            </div>
            {run.strategy?.config.description && (
              <p className="mt-1 text-[9px] text-[#687e90] line-clamp-2 max-w-[520px]" title={run.strategy.config.description}>
                {run.strategy.config.description}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="chip">{run.symbol}</span>
              <span className="chip">{run.tf}</span>
              {run.strategy && <span className="chip">{run.strategy.family}</span>}
              <span className="chip">{run.daysRequested}d window</span>
              {run.barsTested ? <span className="chip">{run.barsTested} bars</span> : null}
              {run.fromTs && run.toTs && (
                <span className="chip">
                  {fmtDate(run.fromTs)} → {fmtDate(run.toTs)}
                </span>
              )}
              <span className="chip">
                {fmtDate(run.createdAt)} {fmtTime(run.createdAt)}
              </span>
              {engine && <span className="chip">{engine}</span>}
              {run.campaignId && (
                <span className="chip" title={run.campaignId}>
                  IN CAMPAIGN
                </span>
              )}
            </div>
          </div>
          <div className="flex items-start gap-3 shrink-0">
            {rob && <RobustnessBlock rob={rob} />}
            <div className="flex flex-col gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={onGoBoard}
                aria-label="Close run detail"
                className="h-6 w-7 p-0 text-[#8193a3] hover:text-[#e5f0fb]"
              >
                <X className="w-3.5 h-3.5" />
              </Button>
              {confirmDelete ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={doDelete}
                  disabled={deleting}
                  className="h-6 px-1.5 text-[9px] text-[#ef777d] border border-[#5c2b31] hover:bg-[#2a171c]"
                >
                  {deleting ? <Loader2 className="w-3 h-3 animate-spin" /> : "confirm"}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmDelete(true)}
                  aria-label="Delete run"
                  className="h-6 w-7 p-0 text-[#8193a3] hover:text-[#ef777d]"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          </div>
        </div>
        {deleteError && (
          <div className="mt-2">
            <ErrorLine text={deleteError} />
          </div>
        )}
      </section>

      {!m && (
        <div className="rounded-lg border border-[#1e303d] bg-[#0d1720] p-4 text-[11px] text-[#687e90]">
          No metrics stored for this run.
        </div>
      )}

      {/* metrics grid */}
      {m && (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
          {metricCells(m).map((c) => (
            <div key={c.label} className="rounded-lg border border-[#1e303d] bg-[#0d1720] px-2.5 py-2">
              <div className="text-[9px] font-bold tracking-[0.06em] text-[#687e90]">{c.label}</div>
              <div className={cn("mt-0.5 text-[15px] font-bold tnum text-[#e5f0fb]", c.cls)}>{c.value}</div>
              {c.sub && <div className="text-[9px] text-[#687e90] tnum">{c.sub}</div>}
            </div>
          ))}
        </div>
      )}

      {/* split-sample */}
      {split && <SplitSection split={split} />}

      {/* equity curve */}
      <section className="rounded-lg border border-[#1e303d] bg-[#0d1720] p-3 space-y-2" aria-label="Equity curve">
        <div className="flex items-center justify-between">
          <SectionTitle>EQUITY CURVE · NET OF COSTS</SectionTitle>
          {m && (
            <span className="text-[9px] text-[#687e90] tnum">
              {fmtPrice(run.equity[0]?.eq ?? m.finalEquity - m.netProfit, 0)} → {fmtPrice(m.finalEquity, 0)}
            </span>
          )}
        </div>
        {run.equity.length >= 2 ? (
          <EquityChart points={run.equity} netPositive={(m?.netProfit ?? 0) >= 0} />
        ) : (
          <div className="text-[10px] text-[#687e90] py-6 text-center">not enough equity data to plot</div>
        )}
      </section>

      {/* trades */}
      <section className="space-y-2" aria-label="Trades">
        <div className="flex items-center justify-between">
          <SectionTitle>TRADES · {run.trades.length}</SectionTitle>
          <span className="text-[9px] text-[#687e90]">fills at next-bar open · fees + slippage both directions</span>
        </div>
        {run.trades.length > 0 ? (
          <TradesTable trades={run.trades} />
        ) : (
          <div className="rounded-lg border border-[#1e303d] bg-[#0d1720] p-4 text-[10px] text-[#687e90]">
            No trades in this window — the rule set stayed flat.
          </div>
        )}
      </section>

      {/* auto-review */}
      {run.review ? (
        <ReviewSection
          review={run.review}
          canFork={!!run.strategy}
          busyIdx={forkBusyIdx}
          phase={forkPhase}
          error={forkError}
          onFork={forkAndRerun}
        />
      ) : (
        <section className="rounded-lg border border-[#1e303d] bg-[#0d1720] p-3 text-[10px] text-[#687e90]">
          No auto-review stored for this run.
        </section>
      )}

      {/* data quality */}
      {run.dataQuality ? (
        <DataQualitySection dq={run.dataQuality} warmupBars={cfg?.warmupBars ?? null} />
      ) : (
        <section className="rounded-lg border border-[#1e303d] bg-[#0d1720] p-2.5 text-[9px] text-[#687e90]">
          No data-quality record stored for this run.
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lab panel — root
// ---------------------------------------------------------------------------

export function LabPanel({
  selectedRunId,
  onSelectRun,
}: {
  selectedRunId: string | null;
  onSelectRun: (id: string | null) => void;
}) {
  const [view, setView] = useState<LabView>("desk");
  const [runId, setRunId] = useState<string | null>(null);
  const [forkStack, setForkStack] = useState<ForkCrumb[]>([]);
  const [strategyBust, setStrategyBust] = useState(0);
  const [campaignBust, setCampaignBust] = useState(0);
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null);
  const [seeding, setSeeding] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);

  const strategiesUrl = strategyBust > 0 ? `/api/strategies?r=${strategyBust}` : "/api/strategies";
  const campaignsUrl = campaignBust > 0 ? `/api/campaigns?limit=20&r=${campaignBust}` : "/api/campaigns?limit=20";

  const strategies = usePolling<StrategiesResponse>(strategiesUrl, 60_000);
  const campaigns = usePolling<CampaignsResponse>(campaignsUrl, 15_000);

  // Remember the last run id we signalled outward so an echo of our own
  // selection (or a fork) does not clobber the fork breadcrumb stack.
  const lastSignaledRef = useRef<string | null>(null);

  useEffect(() => {
    if (selectedRunId && selectedRunId !== lastSignaledRef.current) {
      lastSignaledRef.current = selectedRunId;
      setRunId(selectedRunId);
      setForkStack([]);
      setView("detail");
    }
  }, [selectedRunId]);

  const signalRun = useCallback(
    (id: string | null) => {
      lastSignaledRef.current = id;
      onSelectRun(id);
    },
    [onSelectRun]
  );

  const openRun = useCallback(
    (id: string) => {
      setRunId(id);
      setForkStack([]);
      setView("detail");
      signalRun(id);
    },
    [signalRun]
  );

  const goView = useCallback(
    (v: LabView) => {
      setView(v);
      if (v !== "detail") signalRun(null);
    },
    [signalRun]
  );

  const seedStarters = useCallback(async () => {
    setSeeding(true);
    setSeedError(null);
    try {
      await postJson<{ created: number; skipped: number }>("/api/strategies", { action: "seed-starters" });
      setStrategyBust((n) => n + 1);
    } catch (e) {
      setSeedError(e instanceof Error ? e.message : String(e));
    } finally {
      setSeeding(false);
    }
  }, []);

  const handleForked = useCallback(
    (newRunId: string, fromLabel: string, fromRunId: string) => {
      setForkStack((s) => [...s, { id: fromRunId, label: fromLabel }]);
      setRunId(newRunId);
      signalRun(newRunId);
      setStrategyBust((n) => n + 1);
    },
    [signalRun]
  );

  const handleBackToFork = useCallback(() => {
    const prev = forkStack[forkStack.length - 1];
    if (!prev) return;
    setForkStack(forkStack.slice(0, -1));
    setRunId(prev.id);
    signalRun(prev.id);
  }, [forkStack, signalRun]);

  const handleRunDeleted = useCallback(() => {
    setRunId(null);
    setForkStack([]);
    goView("board");
  }, [goView]);

  // follow the newest running campaign once after mount, so a reload during
  // a sweep keeps showing live progress
  const autoFollowedRef = useRef(false);
  useEffect(() => {
    if (autoFollowedRef.current || activeCampaignId !== null || !campaigns.data) return;
    const running = campaigns.data.campaigns.find((c) => c.status === "RUNNING");
    if (running) {
      autoFollowedRef.current = true;
      setActiveCampaignId(running.id);
    }
  }, [campaigns.data, activeCampaignId]);

  const strategyList = strategies.data?.strategies ?? [];
  const starterCount = strategies.data?.starterCount ?? 0;

  const headChip =
    view === "desk"
      ? `${strategyList.length} RULE SETS`
      : view === "run"
        ? "SWEEP · 15 MARKETS · 7 TFS"
        : view === "board"
          ? "ROBUSTNESS 0–100"
          : runId
            ? `RUN ${runId.slice(0, 8)}`
            : "";

  return (
    <section className="panel flex-1 min-h-0 flex flex-col overflow-hidden" aria-label="Research lab">
      <div className="panel-head">
        <div className="flex items-center gap-1 min-w-0 overflow-x-auto ami-scroll">
          {LAB_VIEWS.map((v) => (
            <Button
              key={v.id}
              size="sm"
              variant="ghost"
              disabled={v.id === "detail" && !runId}
              onClick={() => goView(v.id)}
              aria-pressed={view === v.id}
              className={cn(
                "h-6 px-2.5 text-[10px] tracking-[0.05em] whitespace-nowrap",
                view === v.id ? "bg-[#203244] text-[#e5edf4]" : "text-[#8193a3]"
              )}
            >
              {v.label}
            </Button>
          ))}
        </div>
        <span className="chip hidden sm:inline-block shrink-0">{headChip}</span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto ami-scroll p-2.5 sm:p-3">
        {view === "desk" && (
          <StrategyDeskView
            strategies={strategyList}
            starterCount={starterCount}
            loading={strategies.loading}
            error={strategies.error}
            seeding={seeding}
            seedError={seedError}
            onSeed={seedStarters}
            onOpenRun={openRun}
            onDeskChanged={() => setStrategyBust((n) => n + 1)}
          />
        )}
        {view === "run" && (
          <RunView
            strategies={strategyList}
            strategiesLoading={strategies.loading}
            seeding={seeding}
            seedError={seedError}
            onSeed={seedStarters}
            activeCampaignId={activeCampaignId}
            onPickCampaign={setActiveCampaignId}
            campaigns={campaigns.data}
            campaignsLoading={campaigns.loading}
            campaignsError={campaigns.error}
            onOpenRun={openRun}
            onCampaignsChanged={() => setCampaignBust((n) => n + 1)}
            onGoBoard={() => goView("board")}
          />
        )}
        {view === "board" && <LeaderboardView onOpenRun={openRun} />}
        {view === "detail" && runId && (
          <RunDetailView
            runId={runId}
            forkStack={forkStack}
            onBack={handleBackToFork}
            onForked={handleForked}
            onGoBoard={() => goView("board")}
            onRunDeleted={handleRunDeleted}
          />
        )}
        {view === "detail" && !runId && (
          <div className="py-10 grid place-items-center text-[11px] text-[#687e90]">
            No run selected — open one from the leaderboard or the dock.
          </div>
        )}
      </div>
    </section>
  );
}
