# 01 — Master implementation specification

## 1. Product definition

AMI is a local-first, Windows-native quantitative trading research and paper-execution platform. It combines canonical market data, market visualization, modular strategy research, optional model/agent analysis, an evidence-fusion layer, independent risk authorization and a reproducible paper-trading ledger.

The workstation is the primary user experience. Architecture, runtime state and decision lineage are exposed as connected views inside that workstation, not as unrelated standalone applications.

## 2. Product principles

- **One authoritative core:** AMI owns canonical domain objects, strategy state, risk and paper execution.
- **Adapter isolation:** External projects run in isolated packages/workers and return versioned AMI contracts.
- **Point-in-time integrity:** No future bars, partial higher-timeframe candles or post-event information may leak into historical decisions.
- **Cost-aware evaluation:** Fees, spread, slippage, funding where relevant, contract multipliers and realistic fills are included.
- **Abstention is valid:** Stale, contradictory, incomplete or unvalidated evidence leads to WATCH/NO_TRADE, not forced action.
- **Reproducibility:** Experiments are registered before comparative runs; all attempts are counted.
- **No silent promotion:** Strategy status changes require defined gates and explicit owner review.
- **Observability:** Every module exposes status, freshness, version, dependencies, last run, errors and resource use.
- **Safe defaults:** Monitor/replay/paper only; live execution is absent or locked.

## 3. Target system layers

### Layer A — AMI Core (authoritative)

Owns canonical instrument registry, market event admission, feature snapshots, strategy registry, strategy evaluation, decision proposal, risk checks, position sizing, paper OMS, portfolio state, audit/event ledger, P&L accounting, kill switch and promotion status.

### Layer B — Market data plane

Adapters for Kraken (existing crypto work), CME/COMEX futures data, and future sources. Responsibilities include instrument resolution, market event normalization, timestamp preservation, quality validation, sequence handling, historical capture, replay and provider health.

### Layer C — Research and intelligence sources

Public research/news/context connectors may add timestamped evidence. They must be source-attributed, bounded, freshness-aware and read-only. They cannot create orders, alter AMI risk settings or bypass provenance checks.

### Layer D — Analytical engines

Native technical/structure/momentum engines, statistical/factor research, microstructure experiments, Qlib worker and other approved model/agent adapters. Each engine produces typed evidence/forecast outputs with model version, configuration, timestamps, input lineage and limitations.

### Layer E — Evidence fusion

Normalize outputs; check identity, freshness, completeness and provenance; de-duplicate correlated evidence; preserve disagreements; evaluate calibration and missing inputs; produce one proposal or abstain. Uncalibrated confidence values must not be presented as probabilities.

### Layer F — Strategy, risk and paper execution

Strategies propose trade plans. Independent AMI risk decides eligibility, size and vetoes. Paper OMS simulates orders/fills/positions and writes immutable events. No external framework owns the execution authority.

### Layer G — Validation and operations

Chronological splits, walk-forward, locked holdouts, deterministic replay, paper forward testing, monitoring, recovery, reports, resource controls and certification.

## 4. Canonical lifecycle

`Provider -> raw event -> canonical normalization -> quality/freshness gate -> canonical storage/replay -> feature snapshot -> analytical engines -> evidence fusion -> strategy proposal -> AMI risk gate -> paper OMS -> fill/position/P&L ledger -> evaluation/reporting`

A strategy may be displayed, evaluated or rejected without producing an order. A signal is not an order. A proposed plan is not a risk approval. A risk-eligible plan is not proof of a fill. A local UI status must not be treated as an exchange/broker acknowledgement.

## 5. Canonical data contracts

The platform should maintain versioned schemas for:

- `InstrumentDefinition`: stable instrument ID, asset class, venue, product type, root symbol, full contract symbol, currency, multiplier, tick size, tick value, lot/quantity increment, expiry, first notice/last trade dates where relevant, session calendar, timezone, status, source and effective interval.
- `MarketEvent`: event ID, event type, instrument ID, venue, product, source, source timestamp, receive timestamp, sequence/update ID, schema version, payload, quality flags and provenance.
- `Trade`: source trade ID, instrument, price, quantity, side/aggressor if available, exchange time, receive time and sequence.
- `Quote`: bid/ask price and size, event times, source sequence, spread and validity flags.
- `OrderBookSnapshot` / `OrderBookDelta`: instrument, depth, ordered levels, sequence lineage, checksum, snapshot ID, gap/resync state and quality flags.
- `Candle`: open/close time, interval, OHLCV, source, final/closed status, receive time, revision lineage and quality flags.
- `FeatureSnapshot`: instrument, as-of time, feature-set version, source event IDs, warm-up coverage, missing/stale flags and causal aggregation metadata.
- `EvidenceItem`: source, evidence ID/hash, claim type, payload, source URL/identifier, observed/published/ingested times, freshness, reliability, limitations and input lineage.
- `Forecast`: model/provider/config version, instrument, as-of time, horizon, output units, quantiles/distribution, sample semantics, calibration and lineage.
- `DecisionProposal`: proposal ID, instrument, strategy/version/config hash, direction/bias, setup, entry/stop/targets, horizon/expiry, expected gross/net reward-risk, invalidation, evidence IDs, confidence status, abstention reason and lineage.
- `RiskDecision`: accept/reject, risk engine version, limits checked, proposed quantity, account/portfolio snapshot, exposure, expected loss, costs, veto reasons and timestamp.
- `PaperOrder`, `PaperFill`, `PaperPosition`, `PortfolioSnapshot`, `PnLEvent`, `AuditEvent`: complete simulated lifecycle, idempotency keys, fees, partial fills, remaining quantities and immutable history.

All times are UTC internally. Preserve source time and receive time separately. Never substitute ingestion time for source event time. Use explicit units in field names, e.g. `timestampMs` or ISO UTC; do not mix seconds and milliseconds.

## 6. Instrument identity and futures requirements

Use separate identities for:

- Root symbol (`MNQ`, `NQ`, `MGC`, `GC`).
- Specific dated futures contract (for example, an exchange/vendor-qualified contract month).
- Continuous research series (for example, `MNQ.CONTINUOUS.BACK_ADJUSTED`), explicitly non-tradable.
- Cash index, ETF, CFD, spot metal or synthetic proxy, each with its own asset/product type.

A proxy may be used for context only if clearly labelled. It must never be silently relabelled as the futures contract.

## 7. Workstation composition

The workstation consists of:

- Global top command bar: mode, data health, instrument search, workspace selector, alerts and system state.
- Compact left market/watchlist rail: pinned instruments, market sessions and saved groups.
- Main chart canvas: configurable 1/2/4/6 chart layouts; independent instrument/timeframe; linked crosshair/time range; chart presets and drawings.
- Right metrics sidebar: portfolio, daily/weekly P&L, drawdown, exposure, expectancy, risk utilization, feed latency, strategy health and active vetoes.
- Lower intelligence/system dock: tabbed or split panels for strategy intelligence, topology, event log, experiment results and paper order lifecycle.
- Three connected modes: MARKET, INTELLIGENCE and SYSTEM. Switching mode changes panel focus, not the entire application context.
- Saved layouts per user/profile; keyboard shortcuts; resizable/collapsible panels; compact-density option.

## 8. System graph

A live dependency graph represents sources, adapters, normalizers, stores, feature builders, strategy engines, models, fusion, risk, OMS, reports and UI consumers. Each node exposes status, version, last heartbeat, last successful run, freshness, dependencies, resource usage, recent errors and permission scope.

Provide three graph perspectives:

1. **Architecture:** static dependency/ownership graph.
2. **Runtime:** current health, state, latency, blocked/degraded nodes.
3. **Decision lineage:** exact event IDs, feature snapshot, model outputs, strategy version, risk decision and paper fills contributing to a proposal.

Graph nodes are inspectable; graph edges represent typed contracts, not merely UI links. Clicking an edge should show schema version, direction, last event and validation state.

## 9. Strategy families to research

- Trend following: Donchian breakout, moving-average regime filters.
- Market structure: protected levels, breakouts, liquidity sweeps, fair-value-gap hypotheses.
- Mean reversion: volatility extremes, failed expansion, overreaction.
- Momentum: time-series and cross-sectional momentum.
- Order flow: imbalance, microprice, trade delta, depth features.
- Volatility: compression/expansion, volatility regime and risk overlays.
- Statistical: factors, robust regression, regime/state classification.
- ML forecasting: Qlib or other approved isolated prediction workers.
- Multi-agent research: structured evidence challenge/critique, never execution authority.

Each strategy family must have its own identifier/version, exact hypothesis, instrument universe, data contract, sample split, cost model and promotion criteria. Do not assume an edge transfers between BTC, MNQ, NQ, MGC and GC.

## 10. Integration model

External projects must implement an adapter with:

- health check and readiness state;
- timeout, retry/backoff and typed error contract;
- version and dependency pin;
- request/response schema version;
- instrument and timeframe identity checks;
- input/output timestamps and lineage;
- cost/resource limits;
- no-network test mode or fixture mode;
- explicit disabled/not-configured states;
- no direct access to AMI risk or OMS mutations.

Keep TypeScript/Bun AMI orchestration and core contracts separate from Python-only research workers. Run local workers on loopback by default with bounded requests and supervised lifecycle. Do not couple the main domain types to vendor response shapes.

## 11. Non-functional requirements

- Windows-native and local-first; no WSL/Docker requirement unless owner explicitly revises policy.
- Preserve the current runtime/package conventions; avoid unnecessary dependency churn.
- Measure disk/RAM before large installs, data pulls or model weights.
- Keep source provenance and run artifacts reproducible.
- Support deterministic replay and crash-safe publication/recovery.
- Use append-only audit events or equivalent immutable lineage.
- Fail closed on invalid, stale, incomplete, future-dated, conflicting or unbound market/decision inputs.
- Support keyboard-first operation and a responsive but desktop-optimized dense UI.
- Test UI behavior with fixture data; never make test fixture mode appear as live data.

## 12. Definition of done

A feature is not complete because the source exists or a UI renders. It is complete only for the stated scope when:

- contracts are versioned and schema-validated;
- implementation, tests and call paths are traced;
- exact commands and test counts are recorded;
- real vs mock vs fixture behavior is clearly differentiated;
- source/data/licence/cost/resource assumptions are recorded;
- error, stale, missing, duplicate and interruption cases are tested;
- dependent ledgers, evidence indexes and handoffs are updated;
- no safety gate has been weakened;
- owner review has occurred before any `ACCEPTED` status.
