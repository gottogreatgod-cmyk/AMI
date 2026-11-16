# 05 — Strategy failure analysis and research discipline

## 1. The immediate question

When a strategy loses, the platform must explain whether the failure came from:
- a weak or false hypothesis;
- incorrect/ambiguous signal definitions;
- entry timing or stop geometry;
- regime mismatch;
- unrealistic fill assumptions;
- commissions, spread or slippage;
- data gaps, look-ahead or repainting;
- excessive parameter search/selection bias;
- insufficient sample size;
- implementation defects or incorrect contract economics.

Do not respond to losing strategies by automatically adding more indicators or AI agents.

## 2. Strategy identity and experiment registration

Each strategy has a permanent ID and semantic version. A behavior change creates a new version or strategy ID, never a silent mutation.

Before comparative testing register:
- hypothesis and economic rationale;
- exact entry, exit, stop, target and expiry definitions;
- instrument universe chosen independently of results;
- timeframe and market-session treatment;
- data manifests, date ranges and source hashes;
- development/validation/holdout partition;
- cost and execution model version;
- finite parameter/variant set;
- baseline comparator;
- sample sufficiency and uncertainty approach;
- evaluation metrics and drawdown criteria;
- stopping rules and known confounds;
- owner/reviewer and registration timestamp.

Count every variant run, including failed and abandoned variants. Do not widen a grid after inspecting results without a new registration.

## 3. Metrics to record

### Return and risk
- gross and net P&L;
- expectancy per trade in R and currency;
- profit factor;
- maximum drawdown (currency, percent and R);
- average/median win and loss;
- win rate with sample count;
- exposure, turnover and holding time;
- risk-adjusted measures only with stated methodology and assumptions.

### Trade behavior
- MAE/MFE distribution;
- entry-to-adverse/favorable excursion;
- exit reason distribution;
- stop gap and slippage beyond expected stop;
- partial-fill/partial-exit behavior;
- trade clustering and overlapping exposure;
- long/short asymmetry.

### Robustness
- walk-forward fold dispersion;
- regime/session/weekday/hour breakdown;
- instrument breakdown;
- cost/slippage sensitivity;
- parameter neighborhood stability;
- bootstrap or other uncertainty intervals where appropriate;
- out-of-sample vs development degradation;
- correlation with other strategies and portfolio contribution.

### Data/operations
- bar/event coverage and gap rate;
- latency/freshness;
- source and schema version;
- rejected/invalid candidate reasons;
- data and execution-model hashes.

A confidence score is not a calibrated probability unless validated against realized outcomes for the relevant strategy/instrument/horizon population.

## 4. Evaluation protocol

- Chronological split. The AMI project notes use a 60/20/20 development/validation/locked holdout proposal; confirm the existing canonical split specification and do not overwrite it.
- Use walk-forward analysis within development and validation.
- Purging/embargo may be required when labels/trades overlap or horizons cross split boundaries; document the method.
- Lock holdout data and do not tune on it.
- Use an execution simulator matched to data granularity. Candle-only replay cannot claim depth-aware or high-frequency fill realism.
- Include all relevant fees, spread, slippage, gaps and partial fills.
- Run deterministic reruns and compare hashes.
- Require minimum sample sizes defined before testing; do not set them after seeing the outcome.
- Compare with a simple baseline and a no-trade benchmark.

## 5. Strategy family queue

| Family | Candidate hypothesis | Required data | Starting treatment |
|---|---|---|---|
| Trend | Donchian 20/55 breakout with ATR sizing | Daily/4h bars | Baseline research only |
| Momentum | Time-series/cross-sectional momentum | Consistent multi-instrument bars | Register finite universe first |
| Structure | One exact sweep/break/retest hypothesis | Causal multi-timeframe bars | Avoid vague multi-confluence scoring |
| Mean reversion | Reversion after volatility extreme | Bars and realistic spread | Deferred until range regime is defined |
| Volatility overlay | Sizing/filter based on volatility state | Bars | Test incremental effect, not standalone edge |
| Order flow | Imbalance/microprice/trade delta | Trades, quotes, depth with sequence | Research-only until depth feed accepted |
| ML forecast | Quantile/distribution forecasts | Point-in-time features/labels | Compare against naive baselines |

## 6. Status lifecycle

`IDEA -> REGISTERED -> DEVELOPMENT -> VALIDATION -> INCONCLUSIVE / REJECTED / OOS_SUPPORTED -> PAPER_VALIDATING -> OWNER_REVIEW -> PROMOTED`

- `INCONCLUSIVE`: insufficient or unstable evidence.
- `REJECTED`: failed predefined criteria or falsified hypothesis.
- `OOS_SUPPORTED`: passed predefined out-of-sample gates; not yet an execution authorization.
- `PAPER_VALIDATING`: forward paper phase, with no real orders.
- `PROMOTED`: only after owner decision and all separate authorization requirements.

## 7. Failure analysis engine output

For each registered run, create an explanation record:
- result summary and exact data window;
- sample count and number of trials;
- net expectancy and uncertainty;
- cost breakdown;
- drawdown and risk-limit breaches;
- dominant failure/rejection reasons;
- MAE/MFE and entry/exit geometry diagnostics;
- market-regime/session breakdown;
- robustness and data-quality flags;
- verdict with reason and next bounded experiment recommendation.

The next experiment must be a new registered hypothesis. Do not allow the model to silently tune until it finds a winner.

## 8. Initial AMI audit

The repository's strategy notes describe `ami_continuation_v1` as frozen and not promoted, with a previous continuation geometry experiment reported as inconclusive/losing. Reproduce the current canonical experiment records and reconcile all reports before relying on historical summary numbers. Preserve old run IDs and label missing artifacts accurately. Do not reconstruct or backfill performance evidence and present it as originally measured.
