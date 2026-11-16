# 06 — Strategy failure analysis and quantitative validation

## Treat losses as evidence

The AMI project documents an earlier continuation hypothesis as `NOT_PROMOTED / INSUFFICIENT_EVIDENCE`. The recorded diagnosis was structural: the entry was positioned late in the continuation leg while the stop spanned the broader pullback, causing poor reward-to-risk geometry and rejection/weak net results. The documentation says not to adopt the tested target geometries or keep tuning that exact hypothesis without a newly registered hypothesis.

This is one documented example, not proof that all modules fail for the same reason. Audit each strategy independently.

## Required strategy audit

For every existing strategy version:
1. Capture strategy ID, semantic version, source/config hash and exact commit/data snapshot.
2. Reproduce the latest reported run using original data and assumptions.
3. Count every registered and unregistered historical trial that can be recovered; label gaps in the ledger.
4. Inspect candidate funnel and rejection reason distribution.
5. Reconstruct entry, stop, targets, expiry, partial exits and position-size calculations at decision time.
6. Check candle causality, higher-timeframe availability, symbol mapping, session boundaries and timezone.
7. Apply commissions, exchange fees, spread, slippage, gaps, partial fills and latency assumptions appropriate to the venue/product.
8. Measure performance by instrument, timeframe, session, market regime, direction and year.
9. Inspect MAE/MFE and exit behavior; identify whether losses are entry, stop geometry, target geometry, adverse selection, fees or regime related.
10. Freeze the conclusion. Any semantic change gets a new strategy version and new registration.

## Metrics

- Net expectancy in R and account currency.
- Gross and net profit factor.
- Max drawdown and drawdown duration.
- Sharpe/Sortino only with method, frequency and limitations stated.
- Trade count, exposure, turnover and time-in-market.
- Win/loss size distributions, median and tail quantiles.
- MAE/MFE and post-exit path diagnostics.
- Spread, commission, slippage and fill-rate distributions.
- Performance by year, instrument, session and regime.
- Parameter sensitivity and stability, not only best result.
- Bootstrap or other uncertainty estimates where appropriate.
- Trial count and multiple-testing context.

Win rate, signal volume, planned reward/risk and AI confidence are diagnostics, not standalone selection criteria. Net expectancy after costs, drawdown constraints, sample sufficiency and reproducibility determine evidence strength.

## Hypothesis families to research separately

- Trend following: Donchian breakouts, time-series momentum, moving-average regimes.
- Cross-sectional momentum: relative strength across a defined universe.
- Market structure: one precise setup per registration (e.g. breakout/retest, sweep/reclaim, protected-level break).
- Mean reversion: range/extreme hypotheses with explicit regime filters.
- Volatility: compression/expansion or volatility targeting as an overlay, not presumed alpha.
- Order flow: imbalance/microprice/volume delta only when required trade/quote/depth data exists.
- Statistical/factor models: factor definitions, data vintages, survivorship controls and point-in-time membership.
- ML forecast: baseline model, fixed features/horizons, leakage tests, calibration and incremental-value ablation.

Do not assume a BTC hypothesis transfers to MNQ, NQ, MGC or GC. Each market requires separate evidence.

## Experiment lifecycle

1. Register hypothesis, economic rationale, exact rules, finite variants, instrument universe, timeframe, data range, cost model, baseline, metrics, minimum sample, stopping rules and statistical method before running comparisons.
2. Use chronological splits; the current AMI spec recommends development/validation/locked holdout with walk-forward inside development/validation. Purge/embargo overlapping outcomes where the label horizon requires it.
3. Keep locked holdout inaccessible during tuning. Open only after strategy semantics are frozen and review is authorized.
4. Count all trials. Keep failed and abandoned experiments in the ledger.
5. Re-run with data/config hashes to prove reproducibility.
6. Conduct paper forward validation with realistic spread/slippage/fees/fill handling.
7. Independent review and explicit owner approval are needed for promotion. This package does not authorize live trading.

## Status vocabulary

`RESEARCH`, `BACKTESTING`, `INCONCLUSIVE`, `REJECTED`, `OOS_SUPPORTED`, `PAPER_VALIDATING`, `PROMOTED` may be useful UI labels, but map them to the existing AMI master ledger vocabulary. Do not silently replace current owner-approved statuses. Only owner acceptance sets `ACCEPTED` in the authoritative project ledger.
