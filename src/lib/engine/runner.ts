// ---------------------------------------------------------------------------
// Run orchestrator — the single path every backtest takes:
//   provider fetch → closed bars only → unified engine → scoring →
//   split-sample robustness → auto-review → persisted Run.
// No other code path may evaluate strategies.
// ---------------------------------------------------------------------------

import type {
  AutoReview,
  Bar,
  DataQuality,
  EquityPoint,
  RunMetrics,
  RobustnessScore,
  RobustnessSplit,
  StrategyConfig,
  Timeframe,
  Trade,
} from "./types";
import { TF_MS, ENGINE_VERSION } from "./types";
import { getBars } from "@/lib/data/providers";
import { getInstrument } from "@/lib/data/instruments";
import { runBacktest, buildHtfStates, computeWarmup } from "./backtest";
import { autoReview } from "./review";
import { downsampleEquity, summarizeRun } from "./scoring";
import { atr as atrSeries, donchian as donchianSeries, rsi as rsiSeries } from "./indicators";

export const MAX_STORED_TRADES = 1000;

export interface RunPayload {
  symbol: string;
  tf: Timeframe;
  engineVersion: string;
  metrics: RunMetrics;
  split: RobustnessSplit;
  robustness: RobustnessScore;
  verdict: "PASS" | "WATCH" | "FAIL" | "INSUFFICIENT";
  equity: EquityPoint[];
  trades: Trade[];
  review: AutoReview;
  dataQuality: DataQuality & { htfQuality?: DataQuality | null };
  diagnosticsSummary: {
    barsTested: number;
    warmup: number;
    insufficientData: boolean;
    leverageCappedEntries: number;
    liquidationBoundEntries: number;
  };
  fromTs: number;
  toTs: number;
}

/** How much HTF history to fetch so the HTF filter has its own warmup. */
function htfFetchDays(cfg: StrategyConfig, tradingDays: number): number {
  if (!cfg.htf) return 0;
  const htfWarmupDays = ((cfg.htf.slow + 10) * TF_MS[cfg.htf.tf]) / 86_400_000;
  return Math.ceil(tradingDays + htfWarmupDays * 1.2);
}

export async function executeRun(
  symbol: string,
  tf: Timeframe,
  cfg: StrategyConfig,
  opts: { days: number; maxBars?: number; startingEquity?: number }
): Promise<RunPayload> {
  const inst = getInstrument(symbol);
  if (!inst) throw new Error(`Unknown instrument ${symbol}`);

  const effectiveCfg: StrategyConfig = { ...cfg, timeframe: tf };

  // Fetch the test window PLUS the strategy's warmup in this timeframe, so a
  // "last 100 days" run tests 100 days of signals after a proper warmup.
  const warmupDays = Math.ceil((computeWarmup(effectiveCfg) * TF_MS[tf]) / 86_400_000);
  const fetchDays = opts.days + Math.ceil(warmupDays * 1.3) + 5;
  const { bars, quality } = await getBars(symbol, tf, { days: fetchDays, maxBars: opts.maxBars });
  if (bars.length < computeWarmup(effectiveCfg) + 30) {
    // Not enough history for this timeframe — return an explicit INSUFFICIENT run.
    const emptyMetrics = emptyMetricsFor(opts.startingEquity ?? 10_000);
    return {
      symbol,
      tf,
      engineVersion: ENGINE_VERSION,
      metrics: emptyMetrics,
      split: {
        first: { trades: 0, pf: 0, expectancyR: 0, net: 0 },
        second: { trades: 0, pf: 0, expectancyR: 0, net: 0 },
        consistent: false,
        decayed: false,
        note: "Insufficient bars for the strategy's warmup on this timeframe.",
      },
      robustness: {
        score: 0,
        grade: "D",
        components: { edge: 0, significance: 0, sample: 0, stability: 0, risk: 0 },
      },
      verdict: "INSUFFICIENT",
      equity: [{ t: quality.toTs || Date.now(), eq: opts.startingEquity ?? 10_000 }],
      trades: [],
      review: {
        verdict: "INSUFFICIENT DATA — the exchange holds too little history at this timeframe for this rule set",
        findings: [
          {
            severity: "warn",
            message: `Only ${bars.length} closed bars available (need ${computeWarmup(effectiveCfg) + 30}). ${quality.note ?? ""}`.trim(),
          },
        ],
        suggestions: [],
        generatedAt: Date.now(),
      },
      dataQuality: { ...quality, requestedDays: opts.days, testWindowDays: opts.days },
      diagnosticsSummary: {
        barsTested: bars.length,
        warmup: computeWarmup(effectiveCfg),
        insufficientData: true,
        leverageCappedEntries: 0,
        liquidationBoundEntries: 0,
      },
      fromTs: quality.fromTs,
      toTs: quality.toTs,
    };
  }

  // HTF data for the confluence gate
  let htfBars: Bar[] | null = null;
  let htfQuality: DataQuality | null = null;
  if (effectiveCfg.htf) {
    const htfDays = htfFetchDays(effectiveCfg, opts.days);
    try {
      const res = await getBars(symbol, effectiveCfg.htf.tf, {
        days: Math.max(htfDays, 30),
        maxBars: opts.maxBars,
      });
      htfBars = res.bars;
      htfQuality = res.quality;
    } catch {
      htfBars = null; // filter degrades closed: no HTF data → engine's htfStateAt returns permissive? No —
      // buildHtfStates(null) → htfStateAt returns 1 (permissive). We keep honest: mark in review.
    }
  }

  const out = runBacktest(symbol, tf, bars, htfBars, effectiveCfg, inst, opts.startingEquity ?? 10_000);
  const daysSpan = Math.max(1, quality.coveredDays);
  const { metrics, split, robustness, verdict } = summarizeRun(
    symbol,
    tf,
    out.trades,
    out.equityCurve,
    out.diagnostics,
    daysSpan
  );
  const costsBpsPerSide =
    (effectiveCfg.costs?.feeBpsPerSide ?? inst.feeBpsPerSide) +
    (effectiveCfg.costs?.slipBpsPerSide ?? inst.slipBpsPerSide);
  const review = autoReview(effectiveCfg, tf, metrics, split, costsBpsPerSide);
  if (effectiveCfg.htf && !htfBars) {
    review.findings.push({
      severity: "warn",
      message: `HTF filter ${effectiveCfg.htf.tf} could not be loaded — entries were NOT gated by the higher timeframe for this run.`,
    });
  }

  const storedTrades = out.trades.length > MAX_STORED_TRADES ? out.trades.slice(-MAX_STORED_TRADES) : out.trades;

  return {
    symbol,
    tf,
    engineVersion: ENGINE_VERSION,
    metrics,
    split,
    robustness,
    verdict,
    equity: downsampleEquity(out.equityCurve),
    trades: storedTrades,
    review,
    dataQuality: {
      ...quality,
      requestedDays: opts.days,
      testWindowDays: opts.days,
      warmupDaysConsumed: warmupDays,
      htfQuality,
    },
    diagnosticsSummary: {
      barsTested: bars.length,
      warmup: out.diagnostics.warmup,
      insufficientData: out.diagnostics.insufficientData,
      leverageCappedEntries: out.diagnostics.leverageCappedEntries,
      liquidationBoundEntries: out.diagnostics.liquidationBoundEntries,
    },
    fromTs: quality.fromTs,
    toTs: quality.toTs,
  };
}

function emptyMetricsFor(startingEquity: number): RunMetrics {
  return {
    trades: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    netProfit: 0,
    netReturnPct: 0,
    profitFactor: 0,
    grossProfit: 0,
    grossLoss: 0,
    totalCosts: 0,
    costDragPct: 0,
    expectancyR: 0,
    avgWinR: 0,
    avgLossR: 0,
    tStat: 0,
    maxDrawdownPct: 0,
    maxDrawdownAbs: 0,
    exposurePct: 0,
    liquidations: 0,
    leverageWickouts: 0,
    cagrPct: null,
    barsInMarket: 0,
    finalEquity: startingEquity,
  };
}

// ---------------------------------------------------------------------------
// Live signal state (Signals dock + analyst confluence) — same engine,
// evaluated on the newest CLOSED bar. Nothing here places orders.
// ---------------------------------------------------------------------------
export interface SignalState {
  symbol: string;
  tf: Timeframe;
  strategyKey: string;
  strategyName: string;
  bias: "long" | "short" | "flat" | null;
  htfState: "bull" | "bear" | "neutral" | "n/a" | "range-ok" | "trending";
  lastPrice: number;
  atrPct: number;
  rsi: number | null;
  donchianUpper: number | null;
  donchianLower: number | null;
  asOfTs: number;
  note: string;
}

export async function currentSignalState(
  symbol: string,
  tf: Timeframe,
  cfg: StrategyConfig,
  opts: { days?: number } = {}
): Promise<SignalState> {
  const inst = getInstrument(symbol);
  if (!inst) throw new Error(`Unknown instrument ${symbol}`);
  const days = opts.days ?? Math.min(120, 120);
  const { bars } = await getBars(symbol, tf, { days });
  const { bars: htfBars } = cfg.htf
    ? await getBars(symbol, cfg.htf.tf, { days: Math.max(days, 200) })
    : { bars: null as Bar[] | null };

  const n = bars.length;
  const i = n - 1;
  const warmup = computeWarmup(cfg);

  // Reuse engine internals via a tiny evaluation window
  const { entrySignal, seriesInfo } = evaluateHead(bars, cfg);
  const htf = htfBars ? buildHtfStates(htfBars, cfg) : null;
  const gate = htfStateFor(htf, bars[i].ct);
  const atrPct = seriesInfo.atr > 0 ? (seriesInfo.atr / bars[i].c) * 100 : 0;

  let htfState: SignalState["htfState"] = "n/a";
  if (cfg.htf) {
    if (cfg.htf.type === "range-neutral") htfState = gate >= 1 ? "range-ok" : "trending";
    else htfState = gate === 1 ? "bull" : gate === -1 ? "bear" : "neutral";
  }

  return {
    symbol,
    tf,
    strategyKey: cfg.key,
    strategyName: cfg.name,
    bias: n > warmup ? (entrySignal === 1 ? "long" : entrySignal === -1 ? "short" : null) : null,
    htfState,
    lastPrice: bars[i].c,
    atrPct,
    rsi: seriesInfo.rsi ?? null,
    donchianUpper: seriesInfo.donchianUpper ?? null,
    donchianLower: seriesInfo.donchianLower ?? null,
    asOfTs: bars[i].ct,
    note: n <= warmup ? "history shorter than warmup" : "",
  };
}

// Internal helper: evaluate the entry signal on the last closed bar and
// expose a few series values for display.
function evaluateHead(bars: Bar[], cfg: StrategyConfig) {
  const n = bars.length;
  const i = n - 1;
  const closes = bars.map((b) => b.c);
  const a = atrSeries(bars, cfg.atrPeriod);
  const dc = donchianSeries(bars, cfg.entry.lookback);
  const rsiVals = cfg.entry.kind === "rsi-extreme" || cfg.exit.exitOnRsiMid ? rsiSeries(closes, cfg.entry.rsiPeriod ?? 2) : null;

  // Simplified re-evaluation of the entry rule on the head bar:
  let sig: 0 | 1 | -1 = 0;
  const c = bars[i].c;
  if (i >= cfg.entry.lookback) {
    switch (cfg.entry.kind) {
      case "donchian-break":
        if (!Number.isNaN(dc.upper[i]) && c > dc.upper[i]) sig = 1;
        else if (!Number.isNaN(dc.lower[i]) && c < dc.lower[i]) sig = -1;
        break;
      case "rsi-extreme": {
        const r = rsiVals?.[i];
        if (r != null && !Number.isNaN(r)) {
          if (r < (cfg.entry.rsiLongBelow ?? 10)) sig = 1;
          else if (r > (cfg.entry.rsiShortAbove ?? 90)) sig = -1;
        }
        break;
      }
      case "ts-momentum": {
        const lb = cfg.entry.momentumLookback ?? 90;
        if (i >= lb) {
          const mom = c - bars[i - lb].c;
          sig = mom > 0 ? 1 : mom < 0 ? -1 : 0;
        }
        break;
      }
      default:
        sig = 0;
    }
  }

  return {
    entrySignal: sig,
    seriesInfo: {
      atr: a[i],
      rsi: rsiVals ? rsiVals[i] : null,
      donchianUpper: Number.isNaN(dc.upper[i]) ? null : dc.upper[i],
      donchianLower: Number.isNaN(dc.lower[i]) ? null : dc.lower[i],
    },
  };
}

function htfStateFor(htf: ReturnType<typeof buildHtfStates> | null, decisionTs: number): number {
  if (!htf) return 0;
  const { closeTs, state } = htf;
  let lo = 0;
  let hi = closeTs.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (closeTs[mid] <= decisionTs) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans < 0 ? 0 : state[ans];
}
