# AMI FTC · Next implementation execution brief

**Branch:** `ami/ftc-next-integration-readiness`  
**Baseline:** `ami/repair-p0-chart-and-signal-integrity` at `ab2d51c03073847be40f85d7fecdf577cf7cf07a`  
**Latest verified CI at baseline:** run #406 (`44200139419`), conclusion `success`  
**Program:** AMI Final Test Candidate — research, monitoring, conditional opportunities and paper trading only  
**Live broker routing:** permanently disabled for this FTC scope.

This brief turns the implementation snapshot into executable work packages. It is additive to `docs/11_FINAL_EXECUTION_PLAN.md`; the governing plan remains authoritative.

## Working rules

1. Work only on this feature branch. Do not merge PR #1 or change `main`.
2. Each package must live in a separate module with narrow interfaces, unit tests and a package-level acceptance report.
3. Preserve provider and instrument identity through every layer. `NAS100-DUKA` is a CFD, `XAUUSD-DUKA` is OTC spot metal, `NQZ6` is a dated CME sample; `NQ=F` is continuous futures research only.
4. A successful build or synthetic fixture does not certify market coverage, provider access, fees, margin, sessions or trading performance.
5. Missing/stale/ambiguous data or unverified economics fail closed. No silent defaults, source splicing, synthetic gap bars or optimistic fills.
6. Never route live orders. A future paper order requires a distinct, explicit user action.
7. Preserve failed imports, losing runs and trial history. Never overwrite an immutable dataset revision or research result.
8. Every agent/implementation loop must report files, behavior, tests/counts, CI URL, limitations, rollback and PASS/BLOCKED/FAIL. Do not mark a package complete until its acceptance gate passes.

## Phase A — provider data certification

### FTC-150.1 — real Dukascopy historical import
- Use the existing pinned `dukascopy-node@1.51.1` downloader and importer. Do not introduce a parallel downloader.
- Import manageable H1/D1 windows for both `XAUUSD-DUKA` and `NAS100-DUKA`, requesting bid and ask separately.
- Verify actual provider output by interval and range. Record the exact source export, side, provider instrument ID, requested/actual UTC coverage, source hash, normalized hash, row count and import version.
- Run manifest verification and report session-calendar-aware missing intervals; until calendars are independently established, call them unclassified gaps.
- Verify resumed/partial downloads do not duplicate rows or mutate an existing dataset revision. A changed file must create a new immutable revision.
- Expand to M15/M5 only after the first import is stable and storage/runtime capacity is measured.
- Never commit market archives; store local data in ignored `data/market-data/`.

**Acceptance:** PASS only when real bid+ask data for each primary instrument has been imported, hash-verified, source-replayed, quality-audited, and coverage/session limitations reported. Provider unavailable, terms unclear or data incomplete => BLOCKED, not fabricated coverage.

### FTC-150.2 — NQZ6 actual sample verification
- Download only the pinned official sample, verify the publisher ZIP SHA-256 before extraction and respect the manifest restrictions.
- Use the existing Python importer in an isolated runtime with pinned PyArrow.
- Reconcile source tick count, ordering, contract identity, tick size, tick-derived OHLC, trade counts and minute volume.
- Parse and independently reconcile the volume CSV row by row; do not rely only on the published continuous reference bars.
- Keep NQZ6 isolated from `NAS100-DUKA`, `NQ=F` and the generic Dukascopy dataset catalogue.
- Do not redistribute data or derivatives; retain only permitted internal research outputs.

**Acceptance:** real archive import, hashes, schema and row reconciliation pass. Otherwise NQZ6 remains an unimported code path.

## Phase B — runtime data plane and chart desk

### FTC-210.1 — monitor supervisor and health contract
Create a separate supervisor/service module around the existing experimental worker:
- explicit process states: NOT_STARTED, STARTING, FRESH, STALE, ERROR, STOPPING, STOPPED;
- worker heartbeat distinct from last provider tick and last successful provider request;
- session/calendar-aware freshness policy with UNKNOWN when calendar is not verified;
- bounded retry with exponential backoff and jitter, process restart limits, graceful shutdown and lock preventing duplicate workers;
- atomic snapshot schema versioning, corruption detection and last-known-good snapshot age;
- metrics: provider request duration, tick age, poll interval, last success/error, restart count and clock skew;
- instrument allowlist and provider symbol equality checks;
- stale/disconnected/unknown status must suppress new opportunity transitions.

Do not claim WebSocket streaming. The current documented `getRealTimeRates` adapter is experimental polling.

### FTC-210.2 — closed-bar recovery/reconciliation
- Keep tick, bid candle, ask candle, forming candle and closed candle as separate typed values.
- Track source timestamp and local receive timestamp separately.
- Reject duplicate/out-of-order events; do not silently rewrite a finalized candle.
- At reconnect, fetch bounded historical overlap from the same provider/instrument/price side, reconcile by candle open time, and record discrepancies.
- Never bridge missing market intervals with fabricated bars.
- Make replay deterministic with injected clock, provider adapter and test fixtures.

**Acceptance:** worker restart, provider timeout, stale tick, duplicate poll, clock skew, closed market, out-of-order data, partial bid/ask data and backfill overlap tests pass.

### FTC-300.1 — provider-neutral chart feed
Implement a provider-neutral chart-feed contract, independent from React:
- seed once with verified historical closed bars;
- update a distinct forming candle from monitor data only when source identity and freshness allow it;
- finalize one bar exactly once at interval close;
- reconcile finalized candle with same-source historical REST response;
- expose bid/ask/spread only when both sides are present and fresh;
- maintain data lineage/status on every update.

The adapter must not treat polling snapshots as a streaming transport. UI should display **EXPERIMENTAL POLLING** with age and status.

### FTC-300.2 — Lightweight Charts lifecycle
- Replace repeated full `setData` usage for unchanged series with a controlled incremental `update` path where valid.
- Use full `setData` only for initial load, explicit dataset/symbol/timeframe switch, or verified full reconciliation.
- On source switch immediately clear prior data and show loading; never show old dataset as provider candles.
- Preserve closed-bar immutability and marker/price-line/zone cleanup order.
- Guard effects against stale asynchronous responses and unmount.
- Test 1/2/4 panels, hidden tabs, resize, dataset revision switch, provider switch, empty/error response, duplicate close and component unmount.

**Acceptance:** update path changes last/forming candle without full-history reload; close finalizes once; reconnect reconciliation leaves no duplicate/missing bar; no stale source flash.

## Phase C — browser and API confidence

### FTC-320.1 — Playwright foundation
- Add pinned Playwright dependency and configuration compatible with the repository's Bun/Next setup.
- Create deterministic seeded auth/database fixtures; do not depend on external provider calls in CI.
- Add a webServer config with isolated test database and stable secrets.
- Store traces/screenshots/videos only on failure as workflow artifacts.
- Add accessibility checks for critical chart and opportunity controls.
- Add CI jobs separate from fast unit tests if runtime is significant.

### FTC-320.2 — e2e scenarios
- login/session gating and logout;
- desk 1/2/4 layout and responsive focused-chart mode;
- provider source ↔ exact dataset ID switch, PASS default, REVIEW explicit opt-in;
- symbol/timeframe change and stale response race;
- manual refresh, hidden tab and resume;
- monitor status labels for NOT_STARTED/FRESH/STALE/ERROR;
- opportunity manual create/list, duplicate idempotency and changed-terms conflict;
- calculator verified synthetic fixture, unverified economics => NO_TRADE, invalid quote pair => rejection;
- ensure no live order endpoint/control exists.

**Acceptance:** all core flows pass in CI; test fixtures assert provider and data-class labels, not only that a chart renders.

## Phase D — automatic opportunities and trade plan

### FTC-420.1 — trusted closed-bar opportunity worker
Create an isolated worker module that:
- reads only finalized bars from an approved source;
- validates instrument, timeframe, dataset/provider identity, quote side and freshness;
- evaluates causal structure/strategy rules and HTF gate at the correct decision timestamp;
- emits candidate evidence and contradiction records with source timestamps and calculation versions;
- creates candidates idempotently using stable setup identity;
- applies the existing pure lifecycle reducer and append-only Prisma store;
- persists a watermark before a bar can be replayed with altered values;
- suppresses on stale feed, incomplete bid/ask, REVIEW/REJECTED data, invalid session, missing HTF, event/risk block or invalid economics;
- uses leases/locks and compare-and-swap so multiple workers cannot process the same instrument partition concurrently.

Do not place candidates in TRIGGERED based on a forming candle. Do not add probability scores without out-of-sample calibration.

### FTC-420.2 — opportunity UI and notification layer
- Right rail renders lifecycle, evidence, contradictions, provider/data class, source age, dataset revision and suppression reasons.
- Detail view links original bar timestamps to chart crosshair.
- Persist user dismissal/mute preferences without mutating immutable evidence.
- Notifications are deduplicated by opportunity transition ID; retrying delivery cannot create duplicate alerts.
- All user-visible actions remain research-only and cannot submit orders.

### FTC-410.2 — calculator integration
- Keep calculation pure and separate from HTTP/UI.
- Add trusted FX adapter only after source, pair direction, timestamp/freshness and rate methodology are independently verifiable.
- Persist a user account currency and explicit risk settings; never assume account equity/currency.
- Recompute quantity/risk after tick/lot rounding and include commissions/slippage on both legs.
- Keep XAUUSD/NAS100/NQZ6 NO_TRADE until full contract, costs, margin, currency and session metadata are verified.
- UI must display NO_TRADE reasons and calculation version; never hide unavailable values.

## Phase E — research integrity

### FTC-500.1 — immutable run provenance
Extend Run persistence and runner with a versioned provenance object:
- exact dataset ID and raw/normalized hashes, or provider source and bounded request identity;
- canonical instrument metadata version and data class;
- quote-side/mid construction rule and volume semantics;
- session calendar/version and UTC policy;
- strategy key/version plus immutable config hash;
- engine/build commit and dependency lock identity;
- fees, spread, slippage, latency and gap model versions;
- requested/actual interval and warmup policy;
- split boundaries and seed where stochastic evaluation occurs.

A run must not silently fall back to another source. If a pinned dataset is not eligible for backtest, reject before evaluation.

### FTC-500.2 — result determinism and history
- Every run attempt, failed run and parameter trial is preserved.
- Re-run from provenance reproduces bars, fills, metrics and trade sequence.
- Keep research dataset policy separate from chart display policy.
- Do not accept the NQZ6 sample as a normal backtest dataset until explicit adapter/policy integration and its restrictions have been implemented.

### FTC-510 — validation protocol
- Pre-register train/validation/locked-holdout dates before tuning.
- Chronological walk-forward splits; no random shuffle.
- Report every fold and pooled out-of-sample results.
- Parameter neighborhood/sensitivity, costs/latency/gap stress, regime/cross-period results.
- Use uncertainty intervals suitable for autocorrelated returns and document assumptions.
- Correct for multiple trials (e.g. Deflated Sharpe/PBO/reality-check family as methodologically appropriate).
- Never tune on locked holdout; preserve all failed/losing trials.
- Require adequate sample size; label insufficient sample rather than overstate.

## Phase F — paper OMS

### FTC-600.1 — domain and persistence
Build independent modules and Prisma models for:
- PaperOrderIntent, PaperOrderEvent, PaperFill, PaperPosition, PaperLedgerEntry and PaperRiskState.
- append-only event/ledger records; transactionally consistent position projections;
- explicit order state machine: CREATED → ACKNOWLEDGED → PARTIALLY_FILLED/FILLED → CANCELLED/REJECTED/EXPIRED;
- market/limit/stop order simulation with bid/ask, spread, fees, latency, partial fills, gaps and slippage;
- unique idempotency keys and optimistic concurrency;
- user/workspace isolation and full audit chain opportunity → decision → paper intent → fills → position → exit.

### FTC-600.2 — user controls and safety
- monitor-only is default;
- explicit user acknowledgement is required for each paper order intent;
- kill switch blocks new paper entries but never hides/re-writes existing exposure;
- no API route or UI can route to a live broker;
- persistent worker state survives app restart; reconcile ledger projection from append-only events;
- clearly label all simulated fills and P&L.

**Acceptance:** DB transaction, crash/restart, partial fill, duplicate command, reject/cancel, kill-switch, per-user isolation and ledger-rebuild tests pass.

## Phase G — operational certification

### FTC-700
- API route integration and RBAC/security review; rate limits and input bounds.
- dependency, secret, licence and data-rights scans.
- logs/metrics, worker supervision, backups and tested restore on a copy.
- storage quotas/retention and memory/CPU limits; market archives outside Git/SQLite.
- provider recovery drills and session/DST test calendar.
- accessibility and browser regression.
- preregistered paper-forward run on both primary markets, with no live orders.
- release tag includes commit, manifests, test outputs, limitations and rollback.

## Mandatory iteration loop for every module

1. Inspect the existing implementation and interfaces before editing.
2. Write/extend failing deterministic tests for the precise defect or missing behavior.
3. Implement the smallest isolated module change.
4. Run focused tests, full unit tests, lint, strict typecheck and production build.
5. Run relevant browser/API/worker integration tests.
6. Inspect GitHub Actions step logs, not only the workflow conclusion.
7. Fix regressions and repeat until green or a clearly documented external blocker remains.
8. Update the execution plan and module report with evidence; do not label code-only work complete.

## First actionable batch

1. Execute real Dukascopy H1/D1 bid+ask imports locally and produce the dataset audit report (FTC-150.1).
2. Execute the pinned NQZ6 sample import with PyArrow and row-level volume reconciliation (FTC-150.2).
3. In parallel, implement FTC-210.1 supervisor/heartbeat/freshness unit tests without introducing an unverified streaming claim.
4. Add FTC-320.1 Playwright setup and the first deterministic chart source-switch test.
5. Only after those gates, implement FTC-300 incremental candle path and FTC-420 automatic sourcing.

