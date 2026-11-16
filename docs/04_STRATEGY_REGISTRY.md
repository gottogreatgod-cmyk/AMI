# 04 — Strategy registry (the starter set)

Five rule sets ship with the app, seeded per user by the **"Add starter strategies"** button on the empty desk. Four are research families worth measuring; one is a lesson with numbers attached, on purpose. Every rule set is a `StrategyConfig` (see `src/lib/engine/strategies.ts`) — the engine has no strategy-specific code.

---

## 1. Donchian 1D Range Break + Trail (3×) — `donchian-1d-trail-3x`

| | |
|---|---|
| Family | trend |
| Timeframe | 1d |
| Direction | both |
| Entry | close breaks the prior **20-day Donchian channel** in the direction of the 200-EMA regime |
| Stop | ATR(14) × 3, trailing (tighten-only) |
| Target | none — the trail is the exit |
| Sizing | risk 1% of equity from the stop, 3× cap |
| HTF gate | 1w EMA(10) > EMA(30) for longs, inverse for shorts |

Rationale: the slow configuration class that survives costs. Over the 2026-11 100-day sweep it cannot accumulate a sample (INSUFFICIENT everywhere — correct); over 3 years it trades ~13–30 times per market with the geometry that produced the handoff's reference result (PF 3.2, 13 trades, 1.9% drawdown on BTC 1d).

## 2. 15m Momentum Breakout ×300 (cautionary) — `breakout-15m-300x`

| | |
|---|---|
| Family | cautionary |
| Timeframe | 15m |
| Direction | both |
| Entry | close breaks the 24-bar Donchian channel, 1h EMA(20)>EMA(60) gate |
| Stop | ATR × 1.5 |
| Target | 2R |
| Sizing | **leverage mode — 300× notional** |
| HTF gate | 1h ema-trend |

The deliberate lesson. At 300× the liquidation wick is ±0.33% — inside the noise of a single 15m candle — so the ATR×1.5 stop is decorative: the first 0.33% adverse wick takes ~99.5% of the margin. Measured across 15 markets: on 15m series it destroys the account (-100%) wherever it trades enough; on daily series it either liquidates on trade one or prints absurd lottery variance (+404% single trade) that the INSUFFICIENT verdict refuses to bless. It exists to be measured, not traded.

## 3. 4H Donchian Trend Rider — `donchian-4h-trend-rider`

| | |
|---|---|
| Family | trend |
| Timeframe | 4h |
| Entry | close breaks the 40-bar channel in the direction of the 200-EMA regime |
| Stop | ATR × 2.5, trailing |
| Sizing | risk 1%, 5× cap |
| HTF gate | 1d EMA(50) > EMA(200) |

The middle gears: enough trades to reach significance inside a 100-day window on crypto, slow enough to pay less than a third of the 15m presets' cost drag per unit of edge.

## 4. Daily Extremes Mean Reversion — `rsi2-daily-reversion`

| | |
|---|---|
| Family | mean-reversion |
| Timeframe | 1d |
| Entry | RSI(2) < 10 **and** close ≤ Bollinger(20, 2.2) lower band (mirror for shorts) |
| Exit | RSI recovers above 55 |
| Stop | ATR × 2 |
| Sizing | risk 0.75%, 3× cap |
| HTF gate | 1w **range-neutral**: ADX(14) < 25 required (fade only in ranges) |

The classic short-horizon reversal family with the regime filter that makes it testable: fading extremes inside weekly ranges, blocked when the weekly is trending.

## 5. Time-Series Momentum + Vol Target — `tsmom-90-vol-target`

| | |
|---|---|
| Family | momentum |
| Timeframe | 4h |
| Entry | sign of the 90-bar return aligned with price vs EMA(100) |
| Exit | momentum flip, or ATR × 3 trail |
| Sizing | risk 1%, 4× cap |
| HTF gate | 1w momentum sign |

Time-series momentum is the most robustly documented anomaly family across assets and decades; this is its bar-based, cost-paying, HTF-gated expression. In the 100-day sweep it was the only family with a stable multi-timeframe edge out-of-the-box (EUR/USD 1h/3h/4h, PF 1.66–4.19, consistent halves) — the 3-year rerun tests whether that survives regimes.

---

## Forks

Every auto-review suggestion is a patch on these configs. "Fork & re-run" creates a child strategy (`key-fXXXX`, `parentKey` recorded, version+1, name carries the change like "— tf→4h, stop 2.9×ATR") and immediately re-runs it on the same market/timeframe/window, so a suggestion becomes a measured comparison, not an opinion. Fork lineage is visible on the desk; starters cannot be deleted (forks can).

## Registration discipline

Mirrors the handoff's experiment-lifecycle rules in lightweight form:

- Configs are versioned data; a semantic change is a new fork, never an edit of history (runs store the config snapshot they executed).
- All trials count. Campaigns store FAIL and INSUFFICIENT runs with full metrics — the leaderboard is best-per-combo, but the run history keeps the losers queryable.
- No automatic promotion: `PASS` is a research verdict, not an authorization. Paper-only remains paper-only; there is no execution path to promote into.
