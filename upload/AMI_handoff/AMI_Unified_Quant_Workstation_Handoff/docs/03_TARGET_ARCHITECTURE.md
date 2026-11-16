# 03 — Target platform architecture

## Authoritative ownership

AMI Core is the only owner of canonical instruments, decision proposals, strategy eligibility, risk authorization, paper order lifecycle, positions, P&L and audit records. Every external engine is an isolated research provider.

## Logical layers

### A. User experience

- Unified Quant Workstation.
- Multi-chart canvas, metric/risk sidebar, intelligence panel, runtime/module graph and event dock.
- Saved layouts and workspace state.
- Explicit MONITOR / REPLAY / PAPER mode presentation. LIVE controls are absent/locked.

### B. Market and reference data plane

- Provider adapters for existing Kraken market data and separately gated futures providers.
- Instrument master and contract resolver.
- UTC timestamps plus original exchange timestamps, receive timestamps and ingestion timestamps.
- Canonical market events: candles, trades, quotes, order-book snapshots/deltas, session state and contract metadata.
- Sequence integrity, gap detection, resynchronization and stale/future-data rejection.
- Historical immutable raw capture, normalized canonical store and deterministic replay.

### C. Feature plane

- Versioned feature definitions and feature snapshots.
- Causal multi-timeframe aggregation; higher timeframes use only completed source bars.
- Session-aware futures VWAP, volume, volatility, spread, depth and optional order-flow features.
- Input event IDs, feature-set version, as-of time, warm-up coverage, missing/stale flags.

### D. Research providers

- Existing AMI technical/structure strategies.
- Qlib: isolated ML/factor research worker.
- VeighNa: selective futures/event-driven contract evaluation; no full framework takeover.
- Freqtrade: research/reference only due GPL-3.0 conflict with the current AMI permissive-only policy.
- Academic strategy registry: paper provenance, rules, data requirements, license and replication plan.
- Optional forecasting/multi-agent engines only behind declared contracts, bounded budgets, timeouts and explicit enablement.

### E. Evidence and decision fusion

Normalize each provider response into typed `Forecast`, `AgentAssessment` or `EvidenceItem` contracts. Preserve provider/model version, data as-of, source IDs, feature IDs, prompt/config hash, run ID, costs, warnings and limitations.

Fusion evaluates:
- freshness and completeness;
- identity/instrument/timeframe consistency;
- provider reliability and calibration;
- correlated evidence (avoid counting the same underlying data several times);
- agreement and disagreement;
- missing inputs and abstention conditions.

Fusion emits a proposal or abstains with `WATCH` / `NO_TRADE`. No external component writes to orders, changes risk or changes strategy settings.

### F. Strategy and independent risk

Each strategy has a permanent ID, semantic version, config hash, registered hypothesis, permitted instruments, event requirements, entry/exit definitions, cost model, evaluation splits and status. Strategies propose; AMI risk evaluates. Risk checks include data health, account/portfolio state, gross/net exposure, per-trade and aggregate risk, drawdown, daily loss, correlated positions, margin model, spread, slippage, commissions, exchange filters, maintenance/limit state, duplicate plans, kill switch and operational health.

### G. Paper OMS and ledger

Paper-only OMS models new/acknowledged/partial/filled/cancelled/rejected/expired/unknown states, partial fills, fees, spread, slippage, latency, stop/target behavior, position reconciliation and immutable audit events. Unknown order/position state fails closed. Paper results must not be relabelled as live or retrospectively simulated.

### H. Validation and operations

Historical replay, chronological development/validation/locked holdout, walk-forward tests, forward paper, resource monitoring, recovery, run manifests, experiment ledger and reproducible reports.

## Canonical data lineage

`provider -> raw event -> normalized canonical event -> feature snapshot -> research output -> fusion proposal -> strategy plan -> risk decision -> paper order/fill -> position/PnL -> evaluation report`

Every node in the chain should carry stable IDs and versioned lineage. A chart overlay, UI badge or agent summary must not be treated as a decision input unless the source event and computation are recorded in AMI-owned contracts.

## Suggested contracts

- `Instrument`: canonical ID, venue, product type, symbol root, contract month, expiry, currency, multiplier, tick/lot increments, quantity units, status, timezone/session calendar and source metadata.
- `MarketEvent`: event ID, event type, instrument ID, venue, source, exchange time, receive time, sequence/update ID, schema version, payload, provenance and quality flags.
- `Candle`: interval, UTC open/close, OHLCV, source, final/closed flag and availability time.
- `OrderBookSnapshot/Delta`: instrument, depth, price/size, sequence/checksum, snapshot lineage and resync state.
- `FeatureSnapshot`: as-of time, instrument, feature-set version, input event IDs, warm-up, stale/missing flags.
- `Forecast`: engine/model/config version, instrument, as-of, horizon, units, quantiles/distribution, sample semantics and calibration.
- `DecisionProposal`: direction/bias, setup, horizon, entry, stop, targets, expected net R, expiry, evidence IDs, confidence grade or uncalibrated label, abstention and lineage.
- `RiskDecision`: accepted/rejected, checks, limits, size, exposure, portfolio impact, margin assumptions and veto reasons.
- `PaperOrder/Fill/Position/PnLEvent/AuditEvent`: immutable lifecycle records with run, strategy, instrument, source and execution-cost lineage.

## Service boundaries

Keep AMI's existing TypeScript/Bun application as orchestration and authority. Python research providers run as supervised isolated workers with loopback-only endpoints or the repository's approved local worker mechanism. Never share Python virtual environments with the main runtime. Each adapter needs health check, timeout, retry policy, typed errors, provider version, data freshness, budget controls, fixture/no-network tests and output validation.
