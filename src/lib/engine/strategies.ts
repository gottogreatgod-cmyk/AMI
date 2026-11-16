// ---------------------------------------------------------------------------
// Starter strategy registry — the five rule sets, including the 300× case,
// on purpose. Every config is data; the engine is one.
// ---------------------------------------------------------------------------

import type { StrategyConfig } from "./types";

export const STARTER_STRATEGIES: StrategyConfig[] = [
  {
    key: "donchian-1d-trail-3x",
    name: "Donchian 1D Range Break + Trail (3×)",
    description:
      "Daily close breaks the prior 20-day Donchian channel; ATR(14)×3 trailing stop; sized from the stop at 1% risk with a 3× cap; backed by the weekly trend (EMA 10 > 30). The slow configuration class that survives costs.",
    family: "trend",
    timeframe: "1d",
    direction: "both",
    entry: { kind: "donchian-break", lookback: 20, emaFilter: 200 },
    exit: { takeR: null, trailAtr: 3 },
    risk: { riskPerTrade: 0.01, leverageCap: 3, stopAtr: 3, sizeMode: "risk" },
    htf: { tf: "1w", type: "ema-trend", fast: 10, slow: 30 },
    atrPeriod: 14,
    warmupBars: 220,
  },
  {
    key: "breakout-15m-300x",
    name: "15m Momentum Breakout ×300 (cautionary)",
    description:
      "THE DELIBERATE LESSON. 15m close breaks the 24-bar Donchian channel; ATR×1.5 stop; sized at 300× notional. At 300×, liquidation is a ±0.33% wick away — inside the noise of a single 15m candle. This rule set exists to be measured, not traded.",
    family: "cautionary",
    timeframe: "15m",
    direction: "both",
    entry: { kind: "donchian-break", lookback: 24 },
    exit: { takeR: 2, trailAtr: null },
    risk: { riskPerTrade: 0.01, leverageCap: 300, stopAtr: 1.5, sizeMode: "leverage" },
    htf: { tf: "1h", type: "ema-trend", fast: 20, slow: 60 },
    atrPeriod: 14,
    warmupBars: 80,
  },
  {
    key: "donchian-4h-trend-rider",
    name: "4H Donchian Trend Rider",
    description:
      "4h close breaks the 40-bar channel in the direction of the 200-EMA regime; ATR×2.5 trailing stop; 1% risk from the stop, 5× cap; backed by the daily EMA(50>200) trend.",
    family: "trend",
    timeframe: "4h",
    direction: "both",
    entry: { kind: "donchian-break", lookback: 40, emaFilter: 200 },
    exit: { takeR: null, trailAtr: 2.5 },
    risk: { riskPerTrade: 0.01, leverageCap: 5, stopAtr: 2.5, sizeMode: "risk" },
    htf: { tf: "1d", type: "ema-trend", fast: 50, slow: 200 },
    atrPeriod: 14,
    warmupBars: 240,
  },
  {
    key: "rsi2-daily-reversion",
    name: "Daily Extremes Mean Reversion",
    description:
      "RSI(2) below 10 with price at/below the lower Bollinger(20, 2.2) band, only when the weekly regime is ranging (ADX(14) < 25); ATR×2 stop; exits when RSI recovers above 55 or the channel mid is reclaimed.",
    family: "mean-reversion",
    timeframe: "1d",
    direction: "both",
    entry: {
      kind: "rsi-extreme",
      lookback: 20,
      rsiPeriod: 2,
      rsiLongBelow: 10,
      rsiShortAbove: 90,
      bbPeriod: 20,
      bbStd: 2.2,
    },
    exit: { takeR: null, trailAtr: null, exitOnRsiMid: true },
    risk: { riskPerTrade: 0.0075, leverageCap: 3, stopAtr: 2, sizeMode: "risk" },
    htf: { tf: "1w", type: "range-neutral", fast: 14, slow: 14, adxMax: 25 },
    atrPeriod: 14,
    warmupBars: 40,
  },
  {
    key: "tsmom-90-vol-target",
    name: "Time-Series Momentum + Vol Target",
    description:
      "Sign of the 90-bar return aligned with price vs EMA(100) enters in the momentum direction; ATR×3 trailing stop; 1% base risk from the stop with a 4× cap; backed by the weekly momentum sign.",
    family: "momentum",
    timeframe: "4h",
    direction: "both",
    entry: { kind: "ts-momentum", lookback: 40, momentumLookback: 90, emaFilter: 100 },
    exit: { takeR: null, trailAtr: 3, exitOnMomentumFlip: true },
    risk: { riskPerTrade: 0.01, leverageCap: 4, stopAtr: 3, sizeMode: "risk" },
    htf: { tf: "1w", type: "momentum-sign", fast: 10, slow: 20 },
    atrPeriod: 14,
    warmupBars: 140,
  },
];

export function validateConfig(cfg: StrategyConfig): string[] {
  const errs: string[] = [];
  if (!cfg.key) errs.push("key required");
  if (!cfg.name) errs.push("name required");
  if (!(cfg.risk.riskPerTrade > 0 && cfg.risk.riskPerTrade <= 0.1)) errs.push("riskPerTrade must be in (0, 10%]");
  if (!(cfg.risk.leverageCap > 0 && cfg.risk.leverageCap <= 500)) errs.push("leverageCap must be in (0, 500]");
  if (!(cfg.risk.stopAtr > 0 && cfg.risk.stopAtr <= 20)) errs.push("stopAtr must be in (0, 20]");
  if (!["risk", "leverage"].includes(cfg.risk.sizeMode)) errs.push("sizeMode must be risk|leverage");
  if (!["15m", "45m", "1h", "3h", "4h", "1d", "1w"].includes(cfg.timeframe)) errs.push("bad timeframe");
  if (cfg.entry.lookback < 2 || cfg.entry.lookback > 500) errs.push("entry.lookback must be in [2, 500]");
  if (cfg.exit.takeR != null && (cfg.exit.takeR < 0.5 || cfg.exit.takeR > 20)) errs.push("takeR must be in [0.5, 20]");
  if (cfg.htf) {
    if (cfg.htf.tf === cfg.timeframe) errs.push("htf.tf must differ from trading timeframe");
    if (cfg.htf.fast < 2 || cfg.htf.slow > 400 || cfg.htf.fast > cfg.htf.slow) {
      errs.push("htf fast/slow params invalid (need 2 <= fast <= slow <= 400)");
    }
  }
  return errs;
}
