# 02 — Architecture and data-flow specification

## 1. Ownership boundaries

| Capability | Owner | External frameworks may |
|---|---|---|
| Canonical instrument definitions | AMI Core | Suggest mappings; never mutate silently |
| Market-data normalization and quality gate | AMI Core | Supply raw data through adapters |
| Feature snapshots and lineage | AMI Core | Produce research features in isolated jobs |
| Strategy registry and status | AMI Core | Propose registered hypotheses |
| Prediction/forecast experiments | AMI research adapter | Return versioned, attributable forecasts |
| Evidence fusion | AMI Core | Return candidate evidence |
| Risk authorization and sizing | AMI Core only | No override or write access |
| Paper OMS and portfolio ledger | AMI Core only | No independent execution path |
| Charts and system map | UI reads canonical APIs | No authority over core state |

## 2. Canonical end-to-end flow

1. Provider emits source events with source timestamps and identifiers.
2. Adapter validates transport shape, provider identity, instrument identity and payload bounds.
3. Canonical normalizer maps the source contract to AMI instrument/event contracts.
4. Data-quality gate checks sequence, timestamps, duplicates, gaps, price/quantity precision and session/contract status.
5. Canonical store persists data and provenance. Replay consumes the same normalized event path.
6. Feature builder computes causal features using only data available as of the decision timestamp.
7. Analytical engines consume feature snapshots and return typed outputs with lineage.
8. Fusion checks freshness, agreement/disagreement, model calibration, source correlation and missing inputs.
9. Strategy builds an explicit proposal with entry, invalidation, targets, expiry and net cost assumptions.
10. Independent risk gate evaluates account/portfolio state, quantity, exposure, loss limits, liquidity, spread, fees and kill switch.
11. Paper OMS simulates order lifecycle and fills. It must distinguish planned, submitted-to-simulator, acknowledged, partially filled, filled, canceled, rejected, expired and unknown states.
12. Portfolio/P&L ledger records fees, slippage, realized/unrealized P&L and all state transitions.
13. Reports reconcile run inputs, event IDs, versions, outputs and metrics.

## 3. Event quality rules

- Source timestamp and receive timestamp are separate required fields where supported.
- Exchange sequence gaps invalidate dependent order-book state until a valid snapshot/resync.
- Invalid or future data must not become available to historical decisions.
- Higher timeframes must be native or causally aggregated; incomplete higher-timeframe bars are not final.
- Duplicates and conflicting event IDs are quarantined/rejected with explicit reason codes.
- Decimal price/quantity handling must preserve exchange precision; do not round via binary floating-point before tick/lot validation.
- For futures, reject expired or non-tradable contracts for tradable workflows. Continuous back-adjusted series are research-only.
- Provider outages, stale data, maintenance and session boundaries have explicit status/flags.

## 4. Required module contracts

Every module reports: `moduleId`, `moduleVersion`, `contractVersion`, `enabled`, `configured`, `health`, `lastHeartbeatAt`, `lastSuccessAt`, `latencyMs`, `resourceUse`, `dependencies[]`, `permissions[]`, `lastError`, `statusReason`.

Every adapter exposes: `healthCheck`, `capabilities`, `normalize`, `request/replay`, `close`, deterministic fixture support, typed errors and source version.

## 5. Decision lineage

For each proposal and simulated trade, persist:

- provider/source identifiers and event hashes;
- canonical instrument and contract identity;
- feature-set version and snapshot ID;
- all contributing model/agent outputs and their versions;
- strategy ID/version/config hash;
- fusion version and evidence IDs;
- risk engine version, limits and decision reasons;
- paper OMS version, simulated orders/fills and cost assumptions;
- final P&L and outcome classification.

A user must be able to select a trade on the chart and navigate backward to its decision lineage in the System view.

## 6. Fail-closed reason codes (examples)

`DATA_STALE`, `DATA_GAP`, `SEQUENCE_GAP`, `FUTURE_TIMESTAMP`, `INSTRUMENT_MISMATCH`, `CONTRACT_EXPIRED`, `CONTRACT_UNKNOWN`, `SESSION_CLOSED`, `BAR_NOT_CLOSED`, `INSUFFICIENT_WARMUP`, `MISSING_FEATURE`, `MODEL_UNAVAILABLE`, `MODEL_UNCALIBRATED`, `EVIDENCE_CONFLICT`, `PROVENANCE_MISSING`, `SPREAD_TOO_WIDE`, `SLIPPAGE_TOO_HIGH`, `FEES_EXCEED_EDGE`, `RISK_LIMIT_EXCEEDED`, `DUPLICATE_PROPOSAL`, `OMS_STATE_UNKNOWN`, `KILL_SWITCH_ACTIVE`, `PAPER_MODE_DISABLED`.

## 7. Suggested logical service boundaries

- `instrument-registry`
- `provider-adapters`
- `canonical-market-store`
- `historical-replay`
- `feature-snapshot-service`
- `strategy-registry`
- `research-runner`
- `forecast-adapter-host`
- `evidence-fusion`
- `risk-authority`
- `paper-oms`
- `portfolio-ledger`
- `system-observability`
- `workstation-api`

These are logical boundaries, not a requirement to split the current application into microservices. Prefer modular in-process packages unless isolation, resource limits or dependency incompatibility justify a worker.
