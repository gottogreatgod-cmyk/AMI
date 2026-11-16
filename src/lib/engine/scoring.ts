// ---------------------------------------------------------------------------
// Scoring — deliberately not by return.
//
// Profit factor, t-statistic, trade count, drawdown, and a split-sample check
// comparing the first half of trades with the second. An edge that only
// exists in one half gets marked down; that's what catches curve-fitting.
// ---------------------------------------------------------------------------

import type {
  EquityPoint,
  RunMetrics,
  RobustnessScore,
  RobustnessSplit,
  SplitHalf,
  Timeframe,
  Trade,
} from "./types";
import type { Diagnostics } from "./backtest";

function halfOf(trades: Trade[], from: number, to: number): SplitHalf {
  const slice = trades.slice(from, to);
  const gross = slice.reduce((a, t) => a + t.pnl, 0);
  const gp = slice.filter((t) => t.pnl > 0).reduce((a, t) => a + t.pnl, 0);
  const gl = slice.filter((t) => t.pnl < 0).reduce((a, t) => a + Math.abs(t.pnl), 0);
  const rSum = slice.reduce((a, t) => a + t.r, 0);
  return {
    trades: slice.length,
    pf: gl === 0 ? (gp > 0 ? 99 : 0) : gp / gl,
    expectancyR: slice.length ? rSum / slice.length : 0,
    net: gross,
  };
}

export function splitSample(trades: Trade[]): RobustnessSplit {
  if (trades.length < 4) {
    return {
      first: halfOf(trades, 0, Math.ceil(trades.length / 2)),
      second: halfOf(trades, Math.ceil(trades.length / 2), trades.length),
      consistent: trades.length > 0,
      decayed: false,
      note: trades.length < 4 ? "Sample too small for a meaningful split check." : "",
    };
  }
  const mid = Math.ceil(trades.length / 2);
  const first = halfOf(trades, 0, mid);
  const second = halfOf(trades, mid, trades.length);
  const sameSign = Math.sign(first.expectancyR) === Math.sign(second.expectancyR);
  const bothProfitable = first.pf >= 1 && second.pf >= 1;
  const decayed = first.pf > 1.2 && second.pf < 0.6 * first.pf;
  const consistent = sameSign && bothProfitable;
  let note = "";
  if (decayed) {
    note = `Edge decay: first-half PF ${first.pf.toFixed(2)} vs second-half PF ${second.pf.toFixed(2)} — the edge only existed in the past.`;
  } else if (!sameSign) {
    note = "One-half edge: expectancy flips sign between halves — likely curve-fit.";
  } else if (bothProfitable) {
    note = `Consistent: PF ${first.pf.toFixed(2)} → ${second.pf.toFixed(2)} across both halves.`;
  } else {
    note = "Both halves lose after costs.";
  }
  return { first, second, consistent, decayed, note };
}

export function computeMetrics(
  trades: Trade[],
  equityCurve: EquityPoint[],
  diagnostics: Diagnostics,
  daysSpan: number
): RunMetrics {
  const n = trades.length;
  const wins = trades.filter((t) => t.pnl > 0);
  const losses = trades.filter((t) => t.pnl < 0);
  const grossProfit = wins.reduce((a, t) => a + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((a, t) => a + t.pnl, 0));
  const netProfit = grossProfit - grossLoss;
  const totalCosts = trades.reduce((a, t) => a + t.fees, 0);
  const rVals = trades.map((t) => t.r);
  const meanR = n ? rVals.reduce((a, b) => a + b, 0) / n : 0;
  let tStat = 0;
  if (n > 1) {
    const varr = rVals.reduce((a, b) => a + (b - meanR) ** 2, 0) / (n - 1);
    const sd = Math.sqrt(varr);
    if (sd > 1e-12) tStat = (meanR / sd) * Math.sqrt(n);
    else if (meanR > 0) tStat = 99;
  }

  // mark-to-market drawdown
  let peak = -Infinity;
  let maxDDAbs = 0;
  let maxDDPct = 0;
  for (const p of equityCurve) {
    if (p.eq > peak) peak = p.eq;
    const ddAbs = peak - p.eq;
    if (ddAbs > maxDDAbs) {
      maxDDAbs = ddAbs;
      maxDDPct = peak > 0 ? (ddAbs / peak) * 100 : 0;
    }
  }

  const starting = diagnostics.startingEquity;
  const final = starting + netProfit;
  const cagr =
    daysSpan > 60 && starting > 0 && final > 0
      ? ((final / starting) ** (365 / daysSpan) - 1) * 100
      : null;

  return {
    trades: n,
    wins: wins.length,
    losses: losses.length,
    winRate: n ? (wins.length / n) * 100 : 0,
    netProfit,
    netReturnPct: (netProfit / starting) * 100,
    profitFactor: grossLoss === 0 ? (grossProfit > 0 ? 99 : 0) : grossProfit / grossLoss,
    grossProfit,
    grossLoss,
    totalCosts,
    costDragPct: grossProfit > 0 ? (totalCosts / (grossProfit + grossLoss)) * 100 : 0,
    expectancyR: meanR,
    avgWinR: wins.length ? wins.reduce((a, t) => a + t.r, 0) / wins.length : 0,
    avgLossR: losses.length ? losses.reduce((a, t) => a + t.r, 0) / losses.length : 0,
    tStat,
    maxDrawdownPct: maxDDPct,
    maxDrawdownAbs: maxDDAbs,
    exposurePct: diagnostics.totalBars > 0 ? (diagnostics.barsInMarket / diagnostics.totalBars) * 100 : 0,
    liquidations: trades.filter((t) => t.exitReason === "liquidation").length,
    leverageWickouts: diagnostics.liquidationBoundEntries,
    cagrPct: cagr,
    barsInMarket: diagnostics.barsInMarket,
    finalEquity: final,
  };
}

export function robustnessScore(m: RunMetrics, split: RobustnessSplit): RobustnessScore {
  const edge = (Math.min(m.profitFactor, 2.5) / 2.5) * 35;
  const significance = (Math.max(0, Math.min(m.tStat, 3)) / 3) * 25;
  const sample = (Math.min(m.trades, 30) / 30) * 20;
  let stability = 8;
  if (split.consistent) stability = 15;
  if (split.decayed) stability = 4;
  if (Math.sign(split.first.expectancyR) !== Math.sign(split.second.expectancyR) && m.trades >= 8) stability = 3;
  let risk = 10;
  if (m.maxDrawdownPct > 15) risk -= 4;
  if (m.maxDrawdownPct > 25) risk -= 4;
  if (m.maxDrawdownPct > 40) risk -= 4;
  if (m.liquidations > 0) risk -= Math.min(6, m.liquidations * 2);
  risk = Math.max(0, risk);
  const score = Math.max(0, Math.min(100, edge + significance + sample + stability + risk));
  const grade = score >= 70 ? "A" : score >= 55 ? "B" : score >= 40 ? "C" : "D";
  return {
    score,
    grade,
    components: {
      edge: Math.round(edge),
      significance: Math.round(significance),
      sample: Math.round(sample),
      stability: Math.round(stability),
      risk: Math.round(risk),
    },
  };
}

export type Verdict = "PASS" | "WATCH" | "FAIL" | "INSUFFICIENT";

export function verdictOf(m: RunMetrics, split: RobustnessSplit): Verdict {
  if (m.trades < 8) return "INSUFFICIENT";
  if (m.liquidations > 0 && m.netProfit < 0) return "FAIL";
  if (m.profitFactor >= 1.3 && m.tStat >= 2 && split.consistent && m.maxDrawdownPct <= 25 && m.liquidations === 0) {
    return "PASS";
  }
  if (m.netProfit < 0 && (m.trades >= 15 || m.liquidations > 0)) return "FAIL";
  return "WATCH";
}

export function summarizeRun(
  symbol: string,
  tf: Timeframe,
  trades: Trade[],
  equityCurve: EquityPoint[],
  diagnostics: Diagnostics,
  daysSpan: number
) {
  const metrics = computeMetrics(trades, equityCurve, diagnostics, daysSpan);
  const split = splitSample(trades);
  const robustness = robustnessScore(metrics, split);
  const verdict = verdictOf(metrics, split);
  return { metrics, split, robustness, verdict };
}

/** Downsample an equity curve to at most `maxPoints` for storage/UI. */
export function downsampleEquity(curve: EquityPoint[], maxPoints = 400): EquityPoint[] {
  if (curve.length <= maxPoints) return curve;
  const step = curve.length / maxPoints;
  const out: EquityPoint[] = [];
  for (let i = 0; i < maxPoints; i++) {
    out.push(curve[Math.floor(i * step)]);
  }
  out.push(curve[curve.length - 1]);
  return out;
}
