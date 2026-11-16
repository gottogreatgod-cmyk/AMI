# 08 — Research report: the unified campaign results

**Engine:** `ami-engine-1.0.1` (liquidation model fixed to price-fraction semantics with a margin-bounded loss — see the correction note at the end)
**Data:** live OHLC streamed per run from Binance Spot and Yahoo Finance public feeds · 15 markets · 7 timeframes (15m, 45m, 1h, 3h, 4h, 1d, 1w) · every run backed by a higher-timeframe confluence gate
**Windows:** Phase 1 = last 100 days (monitor); Phase 2 = last 3 years (deep rerun of qualifying strategies)
**Costs:** crypto 12–14 bps round trip; futures/FX ~2.4 bps; stop-before-target; fills at next open; liquidation modelled against implied leverage
**All results net of costs. Everything reproducible in the app: the demo analyst account holds every run, winner and loser alike.**

---

## 1. Executive summary

1. **The 300× lesson reproduced exactly.** The deliberate 15m ×300 leverage preset was wiped out (<−95%) on **99 of 105** market/timeframe combinations in the 100-day sweep, with 108 modelled liquidations. At 300×, the liquidation wick is ±0.33% of price — inside the noise of a single 15-minute candle — so the ATR×1.5 stop is decorative. On the one market where it survived the window on a lucky +404% single trade, the engine refused to bless it (`INSUFFICIENT`, n=1).
2. **Four configurations passed every gate over 3 years — and all four are gold.** Trend-following and time-series momentum on gold, expressed in **both** venues (PAXG 24/7 token and GC=F front-month futures), were the only rule sets that cleared PF ≥ 1.3, t ≥ 2, split-sample consistency, DD ≤ 25%, and zero liquidations simultaneously.
3. **The slow-survive thesis is proven with numbers.** Average net result by timeframe over 3 years (all strategies): 15m **−54%**, 45m −12%, 1h −10%, 3h +0.2%, 4h +2.8%, 1d +2.8%, 1w +0.7%. Cost drag tells the same story from the other side: 19% of gross turnover on 15m vs 1–2% on 1d/1w.
4. **The split-sample check caught a live curve-fit.** Time-series momentum on EUR/USD looked excellent in the 100-day window (PF 1.66–4.19 across 1h/3h/4h, 58 trades on 1h). Over 3 years the same configuration loses −28.7% (PF 0.73, n=361) and the first/second-half split flags the short-window result as a one-half edge. This is exactly the failure mode the scoring was built to catch — an edge that only existed in one slice of history.
5. **The handoff's reference survivor reproduced closely.** Donchian 1D break + 3×-ATR trail + 3× cap on BTC 1d over 3 years: **n=15, PF 3.80, net +15.7%, max DD 4.5%** (the handoff's recorded reference was PF 3.2 with 13 trades and 1.9% DD). The engine honestly flags decay across halves (PF 5.08 → 2.20) — still profitable, weaker than it was.

---

## 2. Phase 1 — the 100-day monitor sweep

**525 runs** (5 strategies × 15 markets × 7 timeframes), zero provider failures.

| Verdict | Count | Meaning |
|---|---|---|
| FAIL | 158 | no edge after costs (or blown up) |
| INSUFFICIENT | 294 | sample too small to claim anything — mostly 1d/1w strategies inside a 100-day window |
| WATCH | 73 | profitable and consistent, but not statistically proven |

The INSUFFICIENT dominance on high timeframes is the correct behaviour: a daily strategy cannot produce 8+ trades in 100 days, and the engine says so instead of squeezing a sample. The PASS class is empty at 100 days by design — no configuration can clear the statistical bar that fast.

**300× preset detail (100 days):** wiped on 99/105 combos; survivors are low-trade lottery tickets correctly marked INSUFFICIENT. Single-trade liquidations on daily series showed −22% to −45% outcomes (one 0.33% wick against a full-leverage position) — the exact geometry the preset exists to demonstrate.

**Notable 100-day WATCH results:** donchian-4h-trend-rider on GC=F 15m (n=38, PF 1.78, +13.5%); tsmom on EUR/USD 1h (n=58, PF 1.66, +11.1%) — the latter later exposed as regime-specific by Phase 2.

## 3. Phase 2 — the 3-year deep rerun

**420 runs** (4 qualifying strategies × 15 markets × 7 timeframes; 1 transient provider error — EUR/USD 1h tsmom — filled by a single rerun). Verdicts: **4 PASS · 134 WATCH · 218 FAIL · 63 INSUFFICIENT**. Zero liquidations anywhere (all Phase-2 strategies size from the stop — the mechanism works).

### The four PASS configurations

| Strategy | Market | TF | Trades | PF | t-stat | Net 3y | Max DD | CAGR | Split (PF 1st→2nd) |
|---|---|---|---|---|---|---|---|---|---|
| Donchian 1D trail (3×) | **PAXG gold** | 3h | 105 | 1.88 | 2.50 | **+40.1%** | 10.4% | 11.4% | 2.36 → 1.59 |
| Donchian 1D trail (3×) | **GC=F gold** | 1h | 134 | 1.63 | 2.03 | **+34.2%** | 10.0% | 15.9% | 1.53 → 1.73 |
| Donchian 4H rider | **PAXG gold** | 1d | 17 | 6.09 | 2.28 | **+17.8%** | 3.8% | 4.3% | 6.56 → 5.78 |
| TSmom + vol target | **GC=F gold** | 1d | 21 | 6.05 | 2.43 | **+18.5%** | 2.9% | 5.0% | 5.27 → 7.18 |

Read the confluence, not just the rows: **gold, in both venues, with both trend families (breakout and momentum), at multiple speeds (1h–1d)** — that is four independent expressions of one hypothesis, which is a much stronger statement than any single backtest. The 2023–2026 window contained a persistent gold uptrend; these strategies are trend-harvesters, and gold trended.

### The near-miss cluster (WATCH, grade A, score 79–89)

| Strategy | Market | TF | n | PF | Net | DD | Note |
|---|---|---|---|---|---|---|---|
| Donchian 1D trail | PAXG | 4h | 82 | 1.94 | +29% | 10% | t=2.0, PF halves 2.4→1.4 |
| Donchian 1D trail | PAXG | 1d | 19 | 4.02 | +13% | 3% | small sample |
| Donchian 1D trail | GC=F | 4h | 42 | 2.14 | +16% | 7% | t=1.5 |
| Donchian 4H rider | BTC | 3h | 88 | 1.79 | +36% | 8% | t=1.8 |
| Donchian 1D trail | GC=F | 1h | — | — | — | — | promoted to PASS above |
| Donchian 4H rider | GC=F | 4h/3h/1h | 38–124 | 1.46–1.86 | +11–26% | 6–11% | the gold complex again |
| TSmom | GC=F | 4h/1h | 90/305 | 1.80/1.35 | +21/+35% | 8% | more gold |
| TSmom | PAXG | 1d | 48 | 1.96 | +13% | 4% | more gold |
| Donchian 1D trail | NQ=F | 1d | 12 | 3.06 | +5% | 2% | small sample, real PF |
| Donchian 1D trail | BTC | 4h | 74 | 1.60 | +21% | 6% | the crypto trend baseline |
| TSmom | DOGE | 4h/3h | 169/232 | 1.52/1.46 | +25/+31% | 8–10% | alt momentum, real |

### Timeframe economics (all Phase-2 runs, 3 years)

| TF | avg cost drag | avg net | profitable share |
|---|---|---|---|
| 15m | 19% | **−54.4%** | 4/60 |
| 45m | 11% | −12.0% | 15/60 |
| 1h | 9% | −10.1% | 11/59 |
| 3h | 5% | +0.2% | 27/60 |
| 4h | 5% | **+2.8%** | 32/60 |
| 1d | 2% | **+2.8%** | 33/60 |
| 1w | 1% | +0.7% | 27/60 |

**Where the edge lives: 3h and slower.** Faster than that, the venue gets paid before you do. This is the single most actionable structural finding of the program.

### The curve-fit that was caught

| Configuration | 100-day result | 3-year result |
|---|---|---|
| TSmom on EUR/USD 1h | PF 1.66, n=58, +11.1% | **PF 0.73, n=361, −28.7%**, split: one-half edge |

A hundred days of FX momentum was a regime, not an edge. The split-sample check on the 3-year run flags the expectancy flip explicitly. Without that gate, this configuration would have been promoted on the short window and given back 40% of the account.

---

## 4. Findings & recommendations

**F1 — Trade gold's trend, in both venues, slowly.** The only 4-PASS cluster. Practical expression: Donchian 1D trail (3×) on GC=F 1h or PAXG 3h–4h; TSmom on GC=F 1d. Watch the obvious risk: the 3-year window is one persistent gold regime; the BTC 1d decay flag (5.08 → 2.20 halves) is the template for what a maturing trend looks like — re-verify quarterly, don't marry it.

**F2 — Minimum viable speed is 3h.** Below that, cost drag (9–19% of turnover) exceeds any edge these families produced. The 15m/45m/1h space is where accounts go to die by a thousand bips. If a fast strategy is ever registered again, it must demonstrate PF ≥ 1.5 *gross of the 12–14 bps round trip* before it's even worth measuring.

**F3 — Sizing from the stop eliminates liquidations entirely.** Across 420 risk-sized runs: zero liquidations. The leverage cap bound on a minority of entries and simply shortened the wick that ended those positions. The 300× preset's 99/105 wipeout rate is the control group that proves why.

**F4 — Crypto majors trend enough to pay for 4h–1d trend following, modestly.** BTC 4h (PF 1.60, +21%, 6% DD), BTC 3h rider (+36%), DOGE momentum (PF 1.5, +25–31%). Real, unspectacular, compatible with the "slow survivors" thesis. The alt complex (SOL/AVAX/LINK/SUI) was noisier: occasional strong rows, mostly FAIL — treat as unproven.

**F5 — The engine's anti-curve-fitting gates work as designed.** Three concrete demonstrations in this program: the EUR/USD 100-day mirage (F4 above), the +404% single-trade INSUFFICIENT refusal, and the BTC 1d decay flag on a genuinely profitable config.

**Recommendations for the next research cycle:**
1. Register the gold complex formally (one hypothesis: "gold trends persist at daily scale in both venues") and run the walk-forward + longer-window verification, including a bear-gold stress window (2013–2015 needs a paid/entitled data source — flagged as a data gate, not hand-waved).
2. Add a 2h timeframe and a vol-target overlay on the 4h momentum family (the strongest crypto rows were all 3h–4h).
3. Explore *why* PAXG 3h out-earned GC=F 1h with the same rules (24/7 trading vs session gaps) — the venue difference is itself a finding worth isolating.
4. Keep the 300× preset in the starter set forever. It is the fastest honest lesson in the product.

---

## 5. Correction note (engine provenance)

During Phase 2 QA, the liquidation model was found to apply the liquidation distance as an absolute price offset rather than a **fraction of entry price**, and the liquidation loss was not bounded by the posted margin. Both were corrected (engine `v1.0.1`), verified against first principles (300× ⇒ ±0.33% wick; 500× ⇒ ±0.20%; loss capped at 99.5% of margin), and **both phases were re-run from scratch** on the fixed engine. The numbers in this report are all from the corrected engine. The bug's observable signature (fake near-entry liquidations inflating losses on low-timeframe risk-sized runs) is documented here because run history integrity matters more than a clean narrative.

## 6. Reproducibility

- Phase 1 campaign id `cmwiia1vk002hoioxjh3uwx6r` (525 runs), Phase 2 campaign id `cmwiifez400vpoioxduaafiij` (420 runs) + one fill run — all visible in the demo analyst's LAB → campaign history and leaderboard, with full trade lists, equity curves, split-sample panels, auto-reviews, and data-quality records.
- Raw aggregates: `docs/research-data-phase1.json`, `docs/research-data-phase2.json`.
- No locked holdout was accessed; no parameter was tuned against Phase 2 results — Phase 2 selection was rule-based from Phase 1 output. The two candidate configurations that Phase 2 promoted (gold complex) should now be treated as **development-window findings**; a genuinely locked forward window remains the next gate, exactly as the handoff's lifecycle demands.
