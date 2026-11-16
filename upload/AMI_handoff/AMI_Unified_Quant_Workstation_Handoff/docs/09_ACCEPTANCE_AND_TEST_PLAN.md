# 09 — Acceptance and verification plan

A work package should define its own exact changed files, commands, dataset/run IDs, tests and limitations. Passing code tests is not evidence of alpha or profitability.

## WP17 — Unified Workstation UX

- [ ] Existing `#market-view` implementation and evidence reviewed; no duplicate conflicting dashboard added.
- [ ] Workspace layout is persistent within approved settings scope and resettable.
- [ ] 1/2/4/6 chart layouts work at supported desktop widths.
- [ ] Charts can select separate instruments/timeframes without state leakage.
- [ ] Optional synchronized crosshair/time range works and is visibly enabled/disabled.
- [ ] Every chart displays instrument/contract, source, freshness and data-quality state.
- [ ] Right sidebar displays sourced values; unavailable values are `N/A`/`NOT_CONNECTED`, not fabricated zero.
- [ ] Dock panels switch/filter without losing chart/layout state.
- [ ] Keyboard focus, contrast and non-color status labels are verified.
- [ ] Refresh/restart does not unlock paper/live state or create execution side effects.
- [ ] Fixture/demo values cannot be confused with real market data.
- [ ] Existing Market View explicit chart load and provider gating remain intact.
- [ ] Unit/component tests, typecheck, lint, production build and responsive visual checks pass.

## WP18 — Module topology

- [ ] Architecture graph clearly distinguishes declared vs observed nodes/edges.
- [ ] Runtime status sourced from actual health/heartbeat data with observation timestamp.
- [ ] Disabled/mock/not-configured/degraded states are distinct.
- [ ] Clicking a node opens version, dependencies, permissions, costs, health and evidence.
- [ ] Decision lineage reproduces exact input/output IDs from an actual run.
- [ ] Missing lineage is rendered unknown/incomplete, not inferred.

## WP19 — Strategy audit

- [ ] Baseline source/config/data hashes recorded.
- [ ] Existing runs reproduced or non-reproducibility reasons recorded.
- [ ] Every recoverable trial counted; missing history disclosed.
- [ ] Costs/fill assumptions documented and tested.
- [ ] Causality/no-lookahead tests pass.
- [ ] Metrics include net expectancy, PF, drawdown, MAE/MFE and per-regime results.
- [ ] Result split/holdout rules documented; holdout remains locked for tuning.
- [ ] Losing/inconclusive versions remain preserved.
- [ ] Independent review distinguishes software correctness from strategy profitability.

## WP20–22 — Futures foundations

- [ ] MNQ, NQ, MGC and GC listed contracts resolve to exact expiry and provider security IDs.
- [ ] Multiplier, tick size/value, lot increment, quote unit and currency conversion tests pass.
- [ ] Expiration/last trade/first notice/delivery rules validated where applicable.
- [ ] Session, maintenance break, holiday, DST and early-close tests pass.
- [ ] Continuous series is separate from tradable contracts; roll mapping has no lookahead.
- [ ] Historical data gaps, corrections, source timestamps and data rights documented.
- [ ] Stale/future/duplicate/out-of-order/sequence-gap tests fail closed.
- [ ] Order book cannot be used until resynchronized after a sequence gap.
- [ ] Fees, spread, slippage, latency, partial fills and gap risk included.
- [ ] Replay is deterministic against a frozen dataset/config hash.
- [ ] Paper sizing and P&L reflect contract multipliers/tick economics correctly.

## WP23–26 — Research integrations

- [ ] Provider has isolated environment and pinned revision.
- [ ] License, dependencies, platform support and security have been audited.
- [ ] Cost and resource ceilings approved before paid calls/weights.
- [ ] Adapter supports health, timeout, errors, provenance and no-network fixtures.
- [ ] Output validates against versioned AMI schema.
- [ ] Model/agent has no order or risk mutation capability.
- [ ] Missing/stale/conflicting inputs cause abstention.
- [ ] Qlib result links to exact AMI input snapshot and model/config hash.
- [ ] VeighNa addon/gateway licenses are assessed individually.
- [ ] Freqtrade is not embedded under the current GPL-excluding policy.
- [ ] Academic replication has full source, data, citation, license and trial-count provenance.

## WP27–28 — Cross-market and forward paper

- [ ] Each instrument has its own strategy version and independent verdict.
- [ ] BTC results are not used as a proxy for futures results.
- [ ] MNQ/MGC market sessions, event regimes and fees are represented.
- [ ] Paper OMS restart, partial fills, cancel/unknown states and reconciliation are tested.
- [ ] Paper service/scheduler overlap and fixture relabeling remain protected.
- [ ] Operational soak includes data gaps, provider disconnect, stale feed and uncertain lifecycle.
- [ ] No automatic promotion or live path exists.
- [ ] Owner reviews full evidence pack before changing status.

## Status reporting

Use repository status vocabulary: `NOT_STARTED`, `BLOCKED`, `PARTIAL`, `IMPLEMENTED_UNVERIFIED`, `VERIFIED`, `ACCEPTED`, `DEFERRED_NOT_VERIFIED`, `REJECTED`. `ACCEPTED` requires owner review and must not be self-assigned by the implementing agent.
