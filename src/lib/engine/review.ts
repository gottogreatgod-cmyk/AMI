// ---------------------------------------------------------------------------
// Auto-review — every run produces findings and up to four concrete changes.
// Each suggestion is a measurable parameter fork ("widen ATR stop 1.8× →
// 2.9×", "move to 4h"), so each one becomes a measured answer when re-run,
// not an opinion.
// ---------------------------------------------------------------------------

import type { AutoReview, ReviewSuggestion, RunMetrics, RobustnessSplit, StrategyConfig, Timeframe } from "./types";

const TF_ORDER: Timeframe[] = ["15m", "45m", "1h", "3h", "4h", "1d", "1w"];

function nextTf(tf: Timeframe): Timeframe | null {
  const i = TF_ORDER.indexOf(tf);
  if (i < 0 || i >= TF_ORDER.length - 1) return null;
  return TF_ORDER[i + 1];
}

export function autoReview(
  cfg: StrategyConfig,
  tf: Timeframe,
  m: RunMetrics,
  split: RobustnessSplit,
  costsBpsPerSide: number
): AutoReview {
  const findings: AutoReview["findings"] = [];
  const suggestions: ReviewSuggestion[] = [];

  const roundTripBps = costsBpsPerSide * 2;
  const avgTradeNotionalBps = m.trades > 0 ? (m.totalCosts / Math.max(m.grossProfit + m.grossLoss, 1e-9)) * 10_000 : 0;
  const liqMoveAtCap = (1 / cfg.risk.leverageCap) * (1 - (cfg.risk.maintenanceMargin ?? 0.005)) * 100;

  // ---- findings -----------------------------------------------------------
  if (m.liquidations > 0) {
    findings.push({
      severity: "critical",
      message: `${m.liquidations} liquidation${m.liquidations > 1 ? "s" : ""} modelled. At ${cfg.risk.leverageCap}× the liquidation wick is only ±${liqMoveAtCap.toFixed(2)}% away — inside the noise of a single ${tf} candle.`,
    });
  }
  if (cfg.risk.sizeMode === "leverage") {
    findings.push({
      severity: "critical",
      message: `Position is sized from leverage (${cfg.risk.leverageCap}× notional), not from the stop. One ±${liqMoveAtCap.toFixed(2)}% wick ends the position regardless of the ATR stop.`,
    });
  }
  if (m.costDragPct > 35 && m.trades >= 10) {
    findings.push({
      severity: "warn",
      message: `Cost drag ${m.costDragPct.toFixed(0)}% of gross turnover — the edge is being paid to the venue (≈${avgTradeNotionalBps.toFixed(1)} bps of cost per unit traded vs ${roundTripBps} bps round-trip).`,
    });
  }
  if (m.trades < 8) {
    findings.push({
      severity: "warn",
      message: `Only ${m.trades} trades — statistically insufficient (t-stat ${m.tStat.toFixed(2)} needs n ≥ 8 before any claim).`,
    });
  }
  if (split.decayed) {
    findings.push({ severity: "warn", message: split.note });
  } else if (m.trades >= 8 && Math.sign(split.first.expectancyR) !== Math.sign(split.second.expectancyR)) {
    findings.push({ severity: "warn", message: split.note });
  }
  if (m.maxDrawdownPct > 25) {
    findings.push({
      severity: "warn",
      message: `Max drawdown ${m.maxDrawdownPct.toFixed(1)}% — above the 25% research ceiling.`,
    });
  }
  if (m.profitFactor >= 1.3 && split.consistent && m.tStat >= 2) {
    findings.push({
      severity: "info",
      message: `Net PF ${m.profitFactor.toFixed(2)} across ${m.trades} trades with consistent halves (t=${m.tStat.toFixed(2)}) — a candidate for the 3-year verification rerun.`,
    });
  }
  if (m.trades === 0) {
    findings.push({
      severity: "warn",
      message: "No trades generated — lookback/warmup too large for the available history on this timeframe.",
    });
  }

  // ---- suggestions (measurable forks, max 4) ------------------------------
  if (m.liquidations > 0 || cfg.risk.sizeMode === "leverage") {
    suggestions.push({
      title: "Size from the stop, cap at 3×",
      detail:
        "Switch sizing to risk-based (1% of equity per trade from the stop distance) with a 3× leverage cap. Sizing from the stop means the cap never binds — it only shortens the wick that ends the position, instead of the position ending the account.",
      patch: { risk: { ...cfg.risk, sizeMode: "risk", riskPerTrade: 0.01, leverageCap: 3 } },
      expectedEffect: "Eliminates liquidations; drawdown becomes stop-driven instead of margin-driven.",
    });
  }
  if (m.costDragPct > 35 && m.trades >= 10) {
    const up = nextTf(tf);
    if (up) {
      suggestions.push({
        title: `Move ${tf} → ${up}`,
        detail: `Churn is eating the edge: ${m.trades} trades paid ${(m.totalCosts / 100).toFixed(1)} in costs on ${(m.grossProfit + m.grossLoss).toFixed(0)} gross turnover. A higher timeframe trades less and pays less.`,
        patch: { timeframe: up },
        expectedEffect: "Fewer, larger trades; cost drag should fall proportionally to trade count.",
      });
    }
  }
  if (m.trades >= 10 && m.profitFactor < 1.15 && cfg.risk.stopAtr < 2.8) {
    suggestions.push({
      title: `Widen ATR stop ${cfg.risk.stopAtr}× → ${(Math.max(cfg.risk.stopAtr * 1.6, 2.9)).toFixed(1)}×`,
      detail:
        "Tight stops die inside single-bar noise. Widening the stop moves it outside the average bar's range so only genuine adverse movement exits the trade.",
      patch: { risk: { ...cfg.risk, stopAtr: Math.round(Math.max(cfg.risk.stopAtr * 1.6, 2.9) * 10) / 10 } },
      expectedEffect: "Fewer noise stopouts; win rate and average win duration should rise.",
    });
  }
  if (m.trades >= 10 && m.profitFactor < 1.15 && !cfg.htf) {
    suggestions.push({
      title: "Add a 4h EMA(50>200) higher-timeframe gate",
      detail:
        "Every run should be backed by a higher timeframe. Gating entries to the 4h trend removes counter-trend trades that are the usual source of clustered losses.",
      patch: { htf: { tf: "4h", type: "ema-trend", fast: 50, slow: 200 } },
      expectedEffect: "Fewer counter-trend entries; expectancy per trade should improve at the cost of trade count.",
    });
  }
  if (m.trades >= 10 && m.profitFactor >= 1.3 && split.consistent && m.maxDrawdownPct > 15) {
    suggestions.push({
      title: `Cut risk per trade ${(cfg.risk.riskPerTrade * 100).toFixed(2)}% → ${((cfg.risk.riskPerTrade * 100) / 2).toFixed(2)}%`,
      detail: `The edge holds (${m.profitFactor.toFixed(2)} PF) but drawdown reached ${m.maxDrawdownPct.toFixed(1)}%. Halving risk halves the drawdown for the same rule set.`,
      patch: { risk: { ...cfg.risk, riskPerTrade: cfg.risk.riskPerTrade / 2 } },
      expectedEffect: "Drawdown scales roughly linearly with risk; PF and expectancy unchanged.",
    });
  }
  if (suggestions.length === 0 && m.trades >= 8 && m.profitFactor >= 1.3 && split.consistent) {
    suggestions.push({
      title: "Rerun over 3 years",
      detail:
        "This configuration is profitable and stable in-sample. The correct next step is the 3-year rerun to check the edge survives more regimes, not more tuning.",
      patch: {},
      expectedEffect: "Regime coverage: 2023 chop, 2024 trend, 2025-26 volatility.",
    });
  }

  const capped = suggestions.slice(0, 4);
  const verdict =
    m.liquidations > 0
      ? "LIQUIDATION RISK — restructure sizing before anything else"
      : m.trades < 8
        ? "INSUFFICIENT SAMPLE — no conclusion is valid yet"
        : m.profitFactor >= 1.3 && split.consistent
          ? "CANDIDATE — stable in-sample; verify over a longer window"
          : m.profitFactor < 1 && m.trades >= 15
            ? "NO EDGE AFTER COSTS — restructure or stop trading this variant"
            : "INCONCLUSIVE — needs either more data or a structural change";

  return { verdict, findings, suggestions: capped, generatedAt: Date.now() };
}
