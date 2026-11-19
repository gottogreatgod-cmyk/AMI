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
import {
  runBacktest,
  buildHtfStates,
  computeWarmup,
  evaluateClosedBar,
  htfStateAt,
  hasHtfWarmup,
  requiredHtfWarmupBars,
} from "./backtest";
import { autoReview } from "./review";
import { downsampleEquity, summarizeRun } from "./scoring";

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
  const htfWarmupDays = ((requiredHtfWarmupBars(cfg) + 10) * TF_MS[cfg.htf.tf]) / 86_400_000;
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
      // The engine fails closed when a configured HTF dataset is unavailable.
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
  const htfReady =
    !effectiveCfg.htf ||
    hasHtfWarmup(
      htfBars,
      effectiveCfg,
      bars[computeWarmup(effectiveCfg)]?.ct ?? Number.NEGATIVE_INFINITY
    );
  if (effectiveCfg.htf && !htfReady) {
    review.findings.push({
      severity: "critical",
      message: `HTF filter ${effectiveCfg.htf.tf} is unavailable or lacks enough closed history at the first decision bar. The run is marked insufficient and no entries are allowed.`,
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

  const lowerWarmupDays = Math.ceil(((computeWarmup(cfg) + 30) * TF_MS[tf]) / 86_400_000);
  const days = Math.max(opts.days ?? 120, lowerWarmupDays);
  const { bars } = await getBars(symbol, tf, { days });
  if (bars.length === 0) throw new Error(`No closed bars are available for ${symbol} ${tf}`);

  const n = bars.length;
  const i = n - 1;
  const warmup = computeWarmup(cfg);
  const evaluation = evaluateClosedBar(bars, i, cfg);
  const atrPct = evaluation.atr > 0 && bars[i].c > 0 ? (evaluation.atr / bars[i].c) * 100 : 0;

  let gate = 1;
  let htfReady = true;
  let htfState: SignalState["htfState"] = "n/a";
  if (cfg.htf) {
    const htfWarmupDays = Math.ceil(
      ((requiredHtfWarmupBars(cfg) + 10) * TF_MS[cfg.htf.tf]) / 86_400_000
    );
    const htfDays = Math.max(days, htfWarmupDays);
    let htfBars: Bar[] | null = null;
    try {
      const result = await getBars(symbol, cfg.htf.tf, { days: htfDays });
      htfBars = result.bars;
    } catch {
      htfBars = null;
    }
    htfReady = hasHtfWarmup(htfBars, cfg, bars[i].ct);

    if (htfReady && htfBars) {
      const htf = buildHtfStates(htfBars, cfg);
      gate = htfStateAt(htf, bars[i].ct);
      if (cfg.htf.type === "range-neutral") {
        htfState = gate >= 1 ? "range-ok" : "trending";
      } else {
        htfState = gate === 1 ? "bull" : gate === -1 ? "bear" : "neutral";
      }
    }
  }

  const htfAllowsSignal =
    !cfg.htf ||
    (htfReady &&
      (cfg.htf.type === "range-neutral"
        ? gate >= 1
        : evaluation.signal === 1
          ? gate === 1
          : evaluation.signal === -1
            ? gate === -1
            : false));
  const validSignal = n > warmup && htfAllowsSignal ? evaluation.signal : 0;

  let note = "";
  if (n <= warmup) note = "history shorter than strategy warmup";
  else if (cfg.htf && !htfReady) note = `HTF ${cfg.htf.tf} history unavailable or too short; signal suppressed (fail-closed)`;

  return {
    symbol,
    tf,
    strategyKey: cfg.key,
    strategyName: cfg.name,
    bias: validSignal === 1 ? "long" : validSignal === -1 ? "short" : null,
    htfState: cfg.htf && !htfReady ? "n/a" : htfState,
    lastPrice: bars[i].c,
    atrPct,
    rsi: evaluation.rsi,
    donchianUpper: evaluation.donchianUpper,
    donchianLower: evaluation.donchianLower,
    asOfTs: bars[i].ct,
    note,
  };
}
