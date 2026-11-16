# 08 — Implementation roadmap and work packages

The package proposes a new `WP17` onward sequence. Do not renumber existing WP01–WP16 or existing platform stages. Append and map new work to the master ledger after reconciliation.

## Parallel workstreams

- **Stream A — Workstation UX:** can start with read-only UI mapping and a shell, using fixture data explicitly labeled as such.
- **Stream B — Strategy audit:** can independently reproduce and diagnose existing strategies without changing them.
- **Stream C — Futures data:** starts with contract/data-provider research and schemas; no strategy evaluation until upstream data acceptance.
- **Stream D — Framework adapters:** only after provider/data contracts and budget/license/resource gates are ready.

## Proposed work packages

| ID | Name | Main outputs | Dependencies | Priority |
|---|---|---|---|---|
| WP17 | Unified Workstation UX | Full-screen shell, persistent layout, multi-chart grid, metric/risk sidebar, bottom dock | Read-only UI audit; current Market View preservation | Critical |
| WP18 | Live Module Topology | Architecture/runtime/decision-lineage graph, inspector drawers and provenance | WP17; actual module registry/health contracts | High |
| WP19 | Strategy Performance Audit | Reproducible results, losses/rejection breakdown, cause analysis, frozen baselines | Existing ledger/data snapshots | Critical |
| WP20 | Futures Instrument Master | MNQ/NQ/MGC/GC metadata, contracts, expiry and calendars | Metadata provider selection and validation | Critical |
| WP21 | Futures Historical/Live Adapter | Historical bars, quotes/trades and provider health with source lineage | WP20; provider/data/license/cost gates | Critical |
| WP22 | Futures Replay & Cost Model | Causal replay, contract rolls, spread/slippage/fees, paper fills | WP20–21 | Critical |
| WP23 | Research Provider Contract | Versioned adapter SDK, worker supervision, health, fixtures, budgets | Existing runtime and resource review | High |
| WP24 | Qlib Research Worker | Isolated training/inference/benchmark adapter | WP23; point-in-time data and resource approval | High |
| WP25 | VeighNa Evaluation | Compatibility/license report and narrowly scoped futures/event adapter recommendation | WP20, WP23; per-addon license review | Medium/High |
| WP26 | Strategy Replication Registry | Paper-based hypothesis catalog, provenance, registration and result linking | WP19; data-rights/license review | High |
| WP27 | Cross-market Benchmarking | BTC + MNQ + MGC benchmark matrix; instrument-specific verdicts | WP19–22; frozen registrations | High |
| WP28 | Forward Paper Validation | Live-feed paper runs, operational metrics, reconciliations and review | Accepted data + risk/paper chain | Critical |

## WP17 detailed plan — first implementation target

### Scope
- Reconcile current UI routes/components/APIs and existing `#market-view`.
- Preserve the explicit Load chart behavior and its current display-only separation.
- Define workstation state/layout schema and component ownership.
- Build the persistent top command bar, left rail, center chart canvas, right sidebar, module graph region and bottom dock.
- Implement 1/2/4/6 layout presets using existing chart capabilities where safe.
- Add fixture-driven chart cards only in test/demo contexts; label all example values.
- Provide disabled/locked visual treatment for any execution control; do not add live controls.

### Out of scope
- Real CME/COMEX adapter, broker, order route or live credentials.
- Strategy rule changes or strategy promotion.
- New paid providers, models or large dependencies.
- Replacing current AMI tab route behavior before parity and migration review.

### Acceptance
See WP17 section in `docs/09_ACCEPTANCE_AND_TEST_PLAN.md`.

## Dependency order

1. Recheck repo state and reconcile source of truth.
2. WP17 design + UI shell; WP19 strategy audit may run in parallel.
3. WP18 actual module registry/health observability.
4. WP20 contract master and metadata/calendar validation.
5. WP21 provider data adapter and historical data quality.
6. WP22 deterministic futures replay and realistic cost/fill model.
7. WP23 generic research-worker contract; WP24/25 only after approval.
8. WP26 paper replication registry.
9. WP27 cross-market registered benchmarks.
10. WP28 forward paper validation and independent owner review.

## Resource discipline

Run bounded test selections first. Do not install multiple Python stacks concurrently. Measure disk/RAM before dependencies or model weights. Keep model weights optional. No provider spend is authorized by this roadmap.
