# 03 — Unified engine specification

One engine evaluates every rule set on every market at every timeframe. Strategies are **data** (`StrategyConfig` JSON); the engine is **code**. This document is the exact semantics implemented in `src/lib/engine/backtest.ts`, `scoring.ts`, and `review.ts`.

## Execution model

```
for each closed bar i (after warmup):
  1. process fills queued at this bar's OPEN (from signals on bar i-1)
  2. if in position:
       a. liquidation check   — exchange acts before your stop
       b. stop check          — gap-aware: opening beyond the stop fills at the open (worse)
       c. target check        — gap beyond the target fills at the open (better)
       d. MFE/MAE update in R
  3. close-of-bar decisions:
       - trailing stop tighten (ATR × trail, from closed data, never loosens)
       - signal exits → queue exit at next open
       - if flat and not halted: entry signals → gate by HTF filter → queue fill at next open
  4. mark-to-market equity for drawdown series
end: force-close at last close ("end-of-data"), flagged
```

Ordering guarantees (the product, not implementation trivia):

- **Liquidation before stop before target.** If a bar's range touches both stop and target, the stop fills. If it touches the liquidation price, the liquidation happens — the exchange does not wait for your stop.
- **Stop-before-target is the conservative reading** of ambiguous bars; it biases results against the strategy, which is the only acceptable direction for research.
- **One position at a time.** No pyramiding. An opposite signal exits at next open; a new entry can only trigger from a later bar's close. No same-bar stop-and-reverse fills.

## Position sizing and the liquidation model

Two modes, chosen by the rule set (`risk.sizeMode`):

### `risk` (recommended) — size from the stop

```
stopDist   = ATR(signalBar) × stopAtr
qtyRisk    = (equity × riskPerTrade) / stopDist
qtyCap     = (equity × leverageCap) / entryPrice
qty        = min(qtyRisk, qtyCap)
```

The cap exists as a safety. For sane ATR multiples it never binds — the notional implied by a 1% risk and a 2–3% stop is well under 3× equity. **When it does bind, it shortens the wick that ends the position instead of shortening the risk** — exactly the mechanism the workstation exists to demonstrate.

### `leverage` (cautionary presets) — size from the cap

```
qty = (equity × leverageCap) / entryPrice
```

This reproduces how a 300× preset actually dies: at 300×, the liquidation move

```
liqMove = (1 / leverage) × (1 − maintenanceMarginRatio)
        = (1/300) × (1 − 0.005) ≈ 0.3317%
```

is *smaller than the ATR stop distance*, so the first adverse 0.33% wick ends the position at a loss of `(1 − MMR) ≈ 99.5%` of the margin — with leverage-sized notional, effectively the account. The engine halts further entries once equity ≤ 2% of start (account blown).

Liquidation P&L: `−qty × liqMove − fees − 5 bps liquidation penalty` (buster fee approximation). Every liquidation is counted, surfaced in metrics (`liquidations`), penalized in the robustness score, and called out by auto-review before anything else.

## Costs

Per side, per instrument (fee bps + slippage bps on entry notional and exit notional):

- Crypto (Binance spot): 4 + 2 bps majors, 4 + 3 bps alts → ≈ 12–14 bps round trip.
- Futures/FX (continuous research series): ≈ 1.2 bps/side all-in.
- VIX research object: 4 bps/side.

A 15m strategy paying 12 bps round-trip needs an average edge per trade above that before it makes anything. Cost drag (`totalCosts / grossTurnover`) is a first-class metric; auto-review flags anything above 35%.

## Higher-timeframe confluence gate

Every starter strategy declares an `htf` filter, so every run is backed by a higher timeframe:

| Type | Gate semantics |
|---|---|
| `ema-trend` | HTF EMA(fast) vs EMA(slow) — longs only when bullish, shorts only when bearish |
| `donchian-mid` | HTF close vs Donchian(slow) midline |
| `momentum-sign` | sign of HTF close − close[N bars back] |
| `range-neutral` | HTF ADX(fast) < adxMax ⇒ entries allowed (ranging regime); trending ⇒ blocked |

Causality: at a decision time T (the signal bar's close), the engine binary-searches the last HTF bar whose **close time ≤ T**. HTF buckets close at their last constituent bar's close, so Friday-short buckets and Monday data cannot leak backwards. If HTF data cannot be loaded, the run proceeds but the review records that entries were **not** gated — visible, not silent.

## Metrics (`scoring.ts`)

All computed net of costs unless stated:

| Metric | Definition |
|---|---|
| `profitFactor` | Σ(winning trades' net P&L) / \|Σ(losing trades' net P&L)\| (99 guard when no losses) |
| `expectancyR` | mean of per-trade R (R = planned risk at entry) |
| `tStat` | mean(R) / se(R) × √n — the t-statistic of the trade R series |
| `winRate`, `avgWinR`, `avgLossR` | distribution shape |
| `netReturnPct` | net P&L / starting equity (default start 10,000 USD) |
| `maxDrawdownPct` | peak-to-trough on the **mark-to-market** equity series (per-bar, not per-trade) |
| `costDragPct` | total fees+slips / gross turnover |
| `exposurePct` | bars in market / total bars |
| `liquidations` | count of forced liquidations |
| `leverageWickouts` | entries where the liquidation distance was inside the stop distance |
| `cagrPct` | annualized net return when the window > 60 days |

## Split-sample robustness check

Trades are split chronologically in half. Each half gets its own PF, expectancy-R, and trade count.

- **consistent** — both halves profitable and same-sign expectancy.
- **decayed** — first-half PF > 1.2 and second-half PF < 0.6 × first ("the edge only existed in the past").
- **one-half edge** — expectancy sign flips between halves → likely curve-fit.

The note text is surfaced verbatim in the run detail UI.

## Robustness score (the leaderboard ranking)

```
edge         = min(PF, 2.5) / 2.5 × 35
significance = clamp(t-stat, 0, 3) / 3 × 25
sample       = min(trades, 30) / 30 × 20
stability    = consistent 15 · decayed 4 · one-half edge 3 · else 8
risk         = 10 − dd penalties (>15%: −4, >25%: −4, >40%: −4) − 2 per liquidation (max −6)
score        = clamp(sum, 0, 100)  →  grade A ≥ 70 · B ≥ 55 · C ≥ 40 · D
```

Deliberately **not** ranked by return. A lucky 3-trade +400% run scores `INSUFFICIENT`, sits at the bottom, and the verdict text says why.

## Verdicts

| Verdict | Condition |
|---|---|
| `INSUFFICIENT` | trades < 8 — no statistical claim is valid |
| `PASS` | PF ≥ 1.3 ∧ t ≥ 2 ∧ consistent ∧ DD ≤ 25% ∧ zero liquidations |
| `FAIL` | net < 0 with (trades ≥ 15 or any liquidation) |
| `WATCH` | everything else — promising but unproven |

## Auto-review (`review.ts`)

Every run generates findings (severity-tagged) and **up to four concrete suggestions**, each a parameter patch that can be forked and re-run with one click:

- Liquidations or leverage sizing → "Size from the stop, cap at 3×" (switches sizeMode, cap 3, risk 1%).
- Cost drag > 35% → "Move 15m → 1h" (next timeframe up).
- PF < 1.15 with n ≥ 10 and stopAtr < 2.8 → "Widen ATR stop 1.8× → 2.9×" (stop outside single-bar noise).
- PF < 1.15 and no HTF gate → "Add a 4h EMA(50>200) higher-timeframe gate".
- Profitable but DD > 15% → "Cut risk per trade in half".
- Clean pass → "Rerun over 3 years" (regime coverage, not more tuning).

The verdict line is blunt on purpose: `LIQUIDATION RISK — restructure sizing before anything else`, `NO EDGE AFTER COSTS — restructure or stop trading this variant`, `INSUFFICIENT SAMPLE — no conclusion is valid yet`, `CANDIDATE — stable in-sample; verify over a longer window`.

## Signal state (live desk)

The same engine, evaluated on the newest **closed** bar, powers the Signals dock, the sidebar signal strip, and the analyst's engine-signal line: entry-rule state (long/short/flat), HTF gate state, ATR%, RSI, Donchian bounds, and the as-of timestamp. It is display-only research state — it places nothing, promises nothing.
