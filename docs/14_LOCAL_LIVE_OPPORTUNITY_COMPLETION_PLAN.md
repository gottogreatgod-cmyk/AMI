# AMI — Local Live Market & Historical Opportunity Completion Plan

**Plan date:** 18 November 2026  
**Program:** AMI Final Test Candidate  
**Implementation branch:** `ami/local-live-opportunity-completion`  
**Baseline:** `ami/ftc-next-integration-readiness` at `7cf7ce202480bec725fcc84b98408249c1b23dba`  
**Latest verified CI on baseline:** run #412, success (`44240989329`)  
**Primary first markets:** `XAUUSD-DUKA` (Dukascopy OTC spot metal) and `NAS100-DUKA` (Dukascopy USA 100 Technical Index CFD)  
**Operating mode:** local research and monitoring, historical replay, explainable opportunities, later paper simulation. No live broker routing.

---

## 0. Executive decision

The next release objective is not “finish every quant feature”. It is:

> Start AMI on the user's own computer; load verified intraday history; monitor XAU/USD and NAS100 CFD using an explicitly labelled best-effort feed; update live/forming chart bars; replay the current day and visible chart window to discover earlier setups; show every setup on the chart and in an auditable opportunity rail; continue evaluating those setups as new closed bars arrive.

This is a smaller and more useful first release than completing a paper OMS or advanced statistical research framework first.

**The current repository is not yet at that objective.** It has the import tools, separate polling worker, chart source selection, initial structure logic, opportunity persistence/reducer and risk calculator, but those are not yet one end-to-end pipeline.

The first deliverable should be a **Local Observation & Opportunity MVP**. It does not need a broker, live execution, paper positions, AI-generated predictions, or a paid data subscription. It does need reliable timestamps, provider lineage, replay, causality, freshness, chart integration and visible reasons.

## 1. Source-of-truth audit

### 1.1 Confirmed existing foundation

- Next.js 16 App Router, TypeScript, React, Bun runtime, Prisma/SQLite and NextAuth.
- Lightweight Charts 5.3 with existing 1/2/4 panel chart desk.
- Original 15-instrument registry using Binance spot and Yahoo Finance REST adapters.
- Original chart REST polling and server-side in-memory provider cache.
- Dukascopy downloader/importer for `XAUUSD-DUKA` and `NAS100-DUKA`, with separate bid/ask immutable dataset revisions, manifests and SHA-256 validation.
- Separate NQZ6 sample importer; its output is not integrated into the Dukascopy dataset store/backtest path.
- Experimental Dukascopy polling worker using pinned `dukascopy-node@1.51.1`, fetching a latest tick and recent bid/ask candles and writing atomic local snapshots.
- Initial structure markers, prior available UTC-date high/low levels and displacement-zone overlays.
- Opportunity lifecycle reducer, user-scoped Prisma persistence, append-only transition events, idempotency and authenticated manual candidate API.
- Contract-aware calculator, canonical metadata adapter and authenticated calculation endpoint. Unknown contract/cost/margin/FX values fail closed.
- CI run #412 passed on the baseline branch: frozen install, Prisma setup, lint, strict TypeScript, Bun tests, Python importer tests, CLI help smoke tests and production build.

### 1.2 Not yet proven or implemented

- No actual Dukascopy history import/coverage certification has been recorded.
- The Dukascopy monitor has not been certified against a real provider session, access terms or reliable cadence.
- The monitor is not a persistent WebSocket feed and is not the normal chart provider.
- Monitor snapshots do not currently feed the Lightweight Charts series.
- The current chart data effect calls full `setData`; there is no provider-neutral incremental forming-bar adapter.
- The existing signal endpoint/current signal function uses the original `getInstrument` registry and latest closed bar; it does not automatically evaluate the Dukascopy dataset revisions.
- Opportunity persistence accepts manual candidates; there is no automated candidate detector/worker.
- No historical replay scanner exists to discover events from earlier bars in the selected chart window.
- No explicit historical-vs-live discovery origin exists in the opportunity model.
- The risk calculator has no certified real contract economics for the primary CFD/OTC instruments; it should continue returning `NO_TRADE` until those facts are independently verified.
- Run persistence lacks a complete immutable dataset/provider/strategy/cost/calendar provenance record.
- No paper OMS/ledger exists.
- No Playwright browser suite or complete local process supervisor exists.
- `next.config.ts` has `typescript.ignoreBuildErrors: true`; the separate CI typecheck currently passes, but the build should eventually enforce type errors itself.
- Documentation is inconsistent: older architecture/README language implies one-process data flow, streaming, and dropping forming bars; the new monitor is a separate process and explicitly stores forming/closed bars.

### 1.3 Consequence

Do not add more independent signal APIs or chart feeds. First create shared, explicit contracts and connect existing modules through them. Do not claim “live” where the provider is polled or delayed. Do not label a chart-visible candidate as a current actionable opportunity merely because it was found retrospectively.

---

## 2. Product acceptance target

### 2.1 First-screen experience

On local startup, the user should see:

1. A persistent 1/2/4 chart desk.
2. Watchlist entries for XAU/USD and NAS100 CFD with provider, feed mode, quote age, session state and freshness.
3. A selected timeframe: M1/M5/M15/H1 (only when that interval is supported and data is verified).
4. A chart with historical closed bars, one separately identified forming bar, bid/ask or declared analysis-price basis, and a visible last update.
5. Historical setup markers across the loaded chart range.
6. A right-side opportunity rail separating:
   - active/current setups,
   - historical setups found by replay,
   - invalidated/expired/suppressed setups.
7. Clicking a setup focuses the chart on its occurrence candle and displays the evidence, trigger, invalidation, expiry and data provenance.
8. When new closed bars arrive, active candidates are reevaluated and their state transitions are recorded.
9. A stale/disconnected/unknown feed visibly suppresses new current transitions; historical results remain viewable but retain their historical provenance.

### 2.2 Required distinction between historical and live

A replay can discover a setup that occurred earlier in the day. That is not the same as an alert that was actually observed live at the time.

Every candidate must include:

- `origin`: `HISTORICAL_REPLAY` or `LIVE_MONITOR`;
- `occurredAtTs`: the market event/bar time;
- `discoveredAtTs`: when AMI found it;
- `lastEvaluatedAtTs`;
- `sourceIdentity`: provider + provider instrument + data class + quote side/policy;
- `datasetId` or live source snapshot/sequence reference;
- `strategyKey` and immutable strategy/config version;
- `engineVersion` and detector version;
- evidence and contradiction arrays;
- current lifecycle status and append-only event history.

Historical replay must never send a retroactive notification that looks like a live alert. A historical candidate can be displayed as “Found in replay — occurred 09:45, discovered 12:30”. If its setup later invalidated, show that full lifecycle. Do not resurrect an expired historical setup as a current opportunity.

### 2.3 “Today” must be a session, not a guessed calendar day

- Store all timestamps as UTC epoch milliseconds.
- Display local time and selected market-session timezone separately.
- Use a versioned instrument/session calendar when verified.
- Until verified, show “UTC date window” or “session unknown”; do not call midnight UTC the trading-day boundary.
- DST, weekend, holiday and provider maintenance intervals must be explicit.
- A user-selected “Today” scan must record the exact UTC interval and calendar policy used.

---

## 3. Target architecture

Keep the existing Next.js application and chart UI. Introduce separate modules/processes for data ingestion and opportunity evaluation.

```
                         LOCAL AMI WORKSTATION
┌────────────────────────────────────────────────────────────────────────┐
│ Next.js UI                                                              │
│ Watchlist | 1/2/4 Desk | Historical markers | Opportunity rail | System │
└──────────────────────────────┬─────────────────────────────────────────┘
                               │ authenticated APIs
┌──────────────────────────────▼─────────────────────────────────────────┐
│ Application / Query Layer                                               │
│ Chart history API | Monitor status API | Replay API | Opportunity API  │
│ Risk preview API | Run/provenance API                                   │
└───────────────┬──────────────────────────────────────┬─────────────────┘
                │                                      │
┌───────────────▼───────────────────┐  ┌───────────────▼─────────────────┐
│ Market Data Plane                 │  │ Opportunity / Replay Plane       │
│ Provider adapters                 │  │ Deterministic closed-bar scanner │
│ Normalization + timestamp policy  │  │ Historical replay                │
│ Bid/ask + declared analysis basis │  │ Live incremental evaluation      │
│ Historical backfill/reconcile     │  │ Lifecycle reducer/store          │
│ Freshness + session state         │  │ Event/audit/marker projection     │
└───────────────┬───────────────────┘  └───────────────┬─────────────────┘
                │                                      │
┌───────────────▼──────────────────────────────────────▼─────────────────┐
│ Persistence                                                             │
│ SQLite: users, strategies, runs, replay jobs, opportunities, events     │
│ Filesystem: immutable raw/normalized datasets, manifests, monitor state │
│ Never put large candle archives in SQLite or Git                        │
└────────────────────────────────────────────────────────────────────────┘

Separate supervised local processes:
  A. Next.js application
  B. XAUUSD-DUKA monitor
  C. NAS100-DUKA monitor
  D. replay/candidate worker (after its lease and recovery design)
```

### 3.1 Module boundaries

Create or retain the following focused modules:

- `src/lib/data/contracts/`: provider-neutral types for instrument, quote, bar, source identity, freshness, session and data quality.
- `src/lib/data/providers/`: separate historical, snapshot and streaming adapter interfaces. Do not conflate a latest quote with a bar history.
- `src/lib/data/normalization/`: timestamp, OHLC, quote-side, volume-semantics and resampling policy.
- `src/lib/data/reconciliation/`: duplicate/out-of-order rejection, overlap backfill and historical/live candle reconciliation.
- `src/lib/data/freshness/`: instrument/timeframe thresholds, heartbeat, session-aware state.
- `src/lib/engine/replay/`: deterministic historical scan runner and replay cursor.
- `src/lib/engine/candidates/`: setup detectors and evidence contracts.
- `src/lib/engine/opportunities/`: lifecycle reducer, persistence and event projection (reuse the existing lifecycle/store; avoid duplicate reducers).
- `src/lib/engine/risk/`: keep pure calculator/adapters separated from opportunity detection.
- `src/workers/market-monitor/`: worker runtime, supervisor and per-instrument process policy.
- `src/workers/opportunity-replay/`: bounded replay/closed-bar worker.
- `src/app/api/market-data/`, `src/app/api/replay/`, `src/app/api/opportunities/`: authenticated, validated query/control APIs.
- `src/components/workstation/`: chart feed hook, historical scan controls, opportunity rail and source status.

A provider adapter must not import React. A chart component must not call a provider SDK. A detector must not access Prisma directly. A persistence module must not calculate strategy signals. Each boundary gets a typed interface and unit tests.

---

## 4. Critical data policy decisions

### 4.1 Keep instrument identities separate

| Canonical ID | Meaning | Data class | Permitted first use |
|---|---|---|---|
| XAUUSD-DUKA | Dukascopy XAU/USD | OTC_SPOT_METAL | Quote/chart research; signal research only under explicit policy |
| NAS100-DUKA | Dukascopy USA 100 Technical Index CFD | BROKER_CFD | Quote/chart research; signal research only under explicit policy |
| NQZ6 | CME E-mini Nasdaq-100 Dec 2026 dated contract sample | EXCHANGE_FUTURES | Separate sample research only |
| NQ=F | Yahoo continuous Nasdaq futures proxy | CONTINUOUS_FUTURES | Reference/research only |
| PAXGUSDT | Gold-backed token spot market | TOKENIZED_METAL | Separate crypto venue, never relabel as XAU/USD |

Never use NQ futures multipliers or margin for NAS100 CFD. Never treat OTC spot-metal tick volume as centralized COMEX traded volume.

### 4.2 Bid/ask and analysis-price policy

The existing importer correctly keeps bid and ask revisions separate. The next layer must define how they are consumed.

- Preserve bid and ask OHLC independently.
- Pair bars only when instrument, provider, interval, open timestamp and close timestamp match exactly.
- For executable scenarios, a long entry uses ask and exit uses bid; a short entry uses bid and exit uses ask.
- Do not construct an unlabeled midpoint from a single side.
- If an analysis midpoint is added, give it a separate declared construction method and version. Averaging bid/ask OHLC extrema is only a quote-derived approximation, not a true tick-level midpoint candle; label that limitation.
- Indicators and setup detectors must declare their price basis.
- If one side is missing, chart the available side with its label, but suppress any calculation that requires both sides.

### 4.3 Volume policy

Every dataset/series declares volume semantics: unavailable, provider-reported, tick count, or exchange-traded volume. Never compare tick volume to CME traded volume as if equivalent. Do not plot an empty or unknown volume series as meaningful market participation.

### 4.4 Data-quality capabilities

Retain separate capability decisions for chart, signal research, backtest, paper execution and live routing. A hash-valid file is not automatically a valid research dataset. A chart-readable dataset is not automatically eligible for strategy research. No real CFD economics are certified merely because synthetic calculator fixtures pass.

---

## 5. Execution roadmap and exit criteria

## Phase 0 — Baseline freeze and local reproducibility

**Tasks**
1. Keep PR #1 and PR #2 separate and draft until their full combined diff is reviewed. Confirm branch ancestry and no accidental unrelated changes.
2. Clean-clone the exact implementation branch and reproduce CI #412 locally.
3. Pin Bun, Python, PyArrow (for NQ sample only), dependencies and environment variables.
4. Remove `typescript.ignoreBuildErrors` only after a clean full typecheck and production build pass without suppression.
5. Reconcile README, architecture, operations and market-data docs with actual behavior.
6. Add a single system capability/status page that distinguishes implemented, experimental, blocked and certified.

**Exit gate**
- Clean clone installs and builds from documented steps.
- `bun run lint`, `bun run typecheck`, `bun test`, Python importer tests and production build pass.
- Documentation no longer claims the polling adapter is a WebSocket or that unintegrated Duka feeds are live chart sources.
- No real provider or archive validation is claimed from CLI help tests.

## Phase 1 — Local hosting and process control

**Goal:** start the existing workstation and see its current supported feeds locally, while enabling the experimental Duka workers as separately managed processes.

**Tasks**
1. Add `scripts/local/ami-start` and `ami-stop` equivalents for Windows PowerShell and macOS/Linux shell.
2. Add a process manifest and PID/lock files outside Git; prevent duplicate monitor instances.
3. Start the Next.js app, SQLite/Prisma readiness check and each monitor independently.
4. Add worker health endpoint/status: stopped, starting, running, stale, error, stopping.
5. Gracefully stop child processes; restart only with bounded retry and visible failure.
6. Add `/api/system/status` reporting app, DB, data directory, monitor process and last successful provider poll.
7. Keep dataset storage under ignored `data/market-data/`; check free disk space and warn before imports.
8. Add backup/restore scripts for SQLite plus manifests; do not silently include restricted provider archives in cloud backups.

**Local environment**
- Bun 1.3.4 (matching CI).
- Python 3.12 for the independent NQ importer; PyArrow installed only when that sample is used.
- `.env` with a local SQLite URL, a newly generated `NEXTAUTH_SECRET`, and `NEXTAUTH_URL=http://localhost:3000`.
- No broker credentials or paid provider keys required for the existing public/experimental paths.
- Local bind to localhost by default; do not expose the app or unauthenticated APIs to the public internet.

**Exit gate**
- One documented command starts the app.
- A separate command starts each Duka worker.
- Status page distinguishes app health from provider freshness.
- Restart/stop works without orphan workers or duplicate pollers.
- Clean restart preserves the database and immutable dataset catalogue.

## Phase 2 — Real historical-data certification

**Goal:** provide sufficient verified history for intraday charting and deterministic replay.

**Tasks**
1. Run actual Dukascopy downloads for both instruments; start H1/D1 for manageable coverage, then M15 and M5/M1 where useful.
2. Request bid and ask separately using the documented downloader orchestrator.
3. Import into immutable revisions. Record exact request window, source instrument, provider, quote side, source hash, normalized hash, importer version, row counts and actual UTC range.
4. Inspect the catalogue and replay each dataset from raw export to normalized output.
5. Audit duplicates, malformed rows, forming bars, gaps, weekends, holidays, provider omissions, zero-volume semantics and out-of-order rows.
6. Add resumable download/import manifests. Resume only missing partitions; never overwrite an existing dataset ID.
7. Add bid/ask pairing report with missing-side timestamps and spread sanity checks.
8. Establish session calendar only from a documented source. Until then, classify gaps as unclassified, not as known closures.
9. Keep NQZ6 sample in its isolated directory and separately parse/reconcile its volume CSV before declaring its importer fully audited.

**Initial useful coverage**
- M15: enough prior sessions for indicators and same-day context.
- M5: intraday setup replay and visible chart window.
- M1: only after storage, provider cadence and chart performance are measured.
- H1/D1: higher-timeframe context and prior-session/day levels.

A scan needs warmup bars before its requested visible interval. Do not download only today's candles and then calculate indicators as though they had sufficient history.

**Exit gate**
- Real bid+ask history exists for each primary instrument and selected interval.
- Hash and source replay checks pass.
- Actual coverage and gaps are reported.
- Dataset capability policy explicitly states chart/research eligibility.
- Provider data rights/terms are understood for the intended private local use.
- No dataset is marked certified merely because a synthetic test passed.

## Phase 3 — Canonical market-data service and monitor recovery

**Goal:** make historical, snapshot and live/polled data share one explicit contract.

**Tasks**
1. Define provider-neutral `HistoryProvider`, `QuoteProvider` and `MonitorProvider` interfaces.
2. Normalize every quote/bar with provider event time, local receive time, source identity, instrument ID, data class, quote side and timeframe.
3. Add independent freshness policy per instrument and timeframe. Worker heartbeat, provider request success and last market tick are three different timestamps.
4. Do not set `fresh=true` merely because a quote payload exists. Validate its provider timestamp and age.
5. Add retry/backoff/jitter, timeout, process restart budget, atomic snapshot schema validation and last-known-good age.
6. On recovery, request an overlap from the same provider/side and reconcile by candle timestamp.
7. Reject duplicate and out-of-order bars. Never silently replace a finalized bar.
8. Keep forming and closed bars separate.
9. Model session states `OPEN`, `CLOSED`, `PREOPEN`, `UNKNOWN`; never infer CLOSED solely from no tick.
10. Add data quality and feed state to every API response consumed by chart or detector.

**Exit gate**
- Provider timeout, no tick, quiet market, closed session, stale snapshot, corrupt file, process restart, clock skew, partial bid/ask, duplicate event, out-of-order bar and backfill overlap tests pass.
- Feed state is explainable and testable.
- Polling is labelled experimental/best-effort, not WebSocket streaming.
- No signal or current opportunity transition can be created from stale or ambiguous input.

## Phase 4 — Live/forming chart integration

**Goal:** connect the separate monitor to the chart without corrupting historical series.

**Tasks**
1. Add a chart-feed API that serves the exact selected instrument/source/quote-side/timeframe and returns source identity plus freshness.
2. Seed the chart from verified closed historical bars.
3. Maintain a distinct forming bar from the monitor snapshot.
4. Use Lightweight Charts `update` for the current/next valid bar. Use `setData` only for initial seed, explicit source/revision switch or verified full reconciliation.
5. Finalize a candle exactly once at its close; immutable closed-bar history is the research input.
6. Reconcile the finalized bar with same-source historical backfill; expose differences instead of silently hiding them.
7. On source/dataset switch, clear old series immediately and show loading. Never flash the prior source as if it were the new one.
8. Display bid/ask or declared analysis basis, spread, provider timestamp, local receive time, poll interval and feed state.
9. Add visible “EXPERIMENTAL POLLING” label until a true licensed/entitled streaming provider is integrated.
10. Add 1/2/4 layout browser tests, resize, hidden tab, source switch, unmount, empty data, stale response race and reconnect.

**Exit gate**
- A valid monitor update changes the visible forming candle without a full history reload.
- Closed bars append exactly once and reconcile with the historical source.
- Source switch never displays stale candles.
- Chart clearly distinguishes historical, forming, closed and delayed/polled data.
- Browser tests pass.

## Phase 5 — Historical opportunity replay (the most important missing feature)

**Goal:** scan the selected day or visible chart window and show setups that happened earlier, not only those that occur after AMI starts.

### 5.1 Replay model

Build a deterministic replay runner that accepts:
- instrument and data class;
- immutable dataset revision or fixed provider-history snapshot;
- timeframe and UTC interval;
- warmup interval;
- selected strategy/detector versions;
- HTF data source and exact HTF close policy;
- session/calendar version or explicit UNKNOWN;
- data-quality policy;
- replay engine version.

It processes bars in chronological order. At each decision timestamp it may use only information whose event/close time is at or before that decision timestamp. It must not read future bars to decide that a historical setup existed.

### 5.2 Detector architecture

Keep detectors separate and composable:
1. Trend/regime detector.
2. Volatility/ATR state.
3. Swing structure/BOS/CHoCH detector with confirmation delay.
4. Displacement-zone detector and invalidation.
5. Prior-day/week and session-level context.
6. Strategy rule detector.
7. HTF confluence gate.
8. Event/session/risk suppression.
9. Candidate composer with explicit evidence and contradictions.

The first MVP should use a small number of deterministic, explainable setup definitions. Do not combine every indicator into an opaque score. Start with structure + displacement + strategy + HTF + freshness. Add VWAP/opening range only after session and volume semantics are verified.

### 5.3 Historical scan behavior

- On chart load, scan the requested visible interval plus warmup.
- Provide explicit controls: “Scan visible range”, “Scan current UTC day”, and “Scan selected session” once calendar is verified.
- Cache replay output by dataset ID/hash, interval, detector version, strategy version and policy version.
- Persist replay job state, cursor and result identity so large windows resume safely.
- Deduplicate candidate identity deterministically (instrument + timeframe + setup family + direction + origin bar/structure anchor + detector version).
- Store historical candidates with `origin=HISTORICAL_REPLAY` and both occurrence/discovery timestamps.
- Replaying the same inputs must produce the same candidate set and transitions.
- Do not create repeated notifications on every replay.
- Preserve invalidated and expired candidates as historical records.

### 5.4 Live/replay convergence

Use the same detector and candidate schema for replay and live evaluation, but distinct event origins and clocks:
- Replay walks all eligible historical closed bars.
- Live mode consumes only newly finalized closed bars after the last committed watermark.
- At startup, perform catch-up replay from the last persisted watermark to the latest verified closed bar, then switch to incremental mode.
- A replay result must never overwrite a live observation with a different provenance.
- If a historical backfill corrects a previously stored bar, create a data-revision/reconciliation event and re-run affected replay under the new dataset revision; do not mutate the prior replay result.

### 5.5 Chart presentation

- Render markers at `occurredAtTs`, not `discoveredAtTs`.
- Use distinct marker style/label for “historical replay”.
- Clicking a marker opens the opportunity and scrolls/crosshairs to the occurrence bar.
- Show trigger, invalidation, target scenarios, evidence, contradictions, source revision and current/historical lifecycle.
- Add filters by status, direction, timeframe, detector, origin and date.
- Historical setups that already triggered and invalidated must be visibly different from active current setups.

**Exit gate**
- A golden fixture with known earlier setups is scanned and markers appear on exact expected bars.
- Replay uses no future bars; tests assert decision-time boundaries.
- Same input/revision/version yields identical output.
- Duplicate replay does not duplicate opportunities/events.
- Historical candidates cannot be misrepresented as live alerts.
- A same-day scan can discover a setup that occurred before app startup.

## Phase 6 — Automatic current opportunity monitoring

**Goal:** after catch-up replay, continue evaluating new closed bars and maintain current opportunity state.

**Tasks**
1. Implement worker leases/locks per instrument/timeframe/source partition.
2. Persist per-partition last processed closed-bar timestamp and source revision.
3. Process only a strictly newer finalized bar.
4. Use the existing opportunity reducer/store; do not create a second lifecycle.
5. Candidate evidence must contain exact bar timestamps and versioned detector outputs.
6. Suppress on stale/unknown feed, missing side, invalid dataset policy, unknown session when session is required, missing HTF, invalid event policy or failed risk gate.
7. Distinguish candidate lifecycle from paper order lifecycle.
8. Add event deduplication and notification outbox only after state transitions are committed.
9. Add a visible explanation for every suppression.
10. Keep current and historical opportunity lists separate.

**Exit gate**
- Worker crash/restart resumes from persisted watermark.
- Two workers cannot process the same partition concurrently.
- Duplicate and out-of-order bars do not create transitions.
- Historical catch-up and live continuation have no gap or duplicate at their boundary.
- A stale feed stops new transitions and preserves the last known state with an age warning.

## Phase 7 — Opportunity UI and explainable risk preview

**Opportunity card required fields**
- Instrument, venue/data class, provider and source revision.
- Timeframe, direction, setup family, strategy/detector version.
- Origin (historical replay or live monitor).
- Occurrence time, discovery time, last evaluation time.
- Lifecycle status and transition history.
- Trigger/entry zone, invalidation/stop and target scenarios.
- Evidence supporting the setup and evidence against it.
- HTF state, volatility/regime, structure/zone context and event/session state.
- Feed freshness and data-quality status.
- Risk calculation state, assumptions and every NO_TRADE reason.

**Risk preview**
- Persist user-selected account currency, equity and risk limits.
- Use only verified contract, tick, lot, fee, margin and FX data.
- Use side-aware executable quotes; show gross and net values.
- Recompute after tick/quantity rounding.
- Include gap/slippage stress.
- If XAUUSD-DUKA or NAS100-DUKA economics remain unverified, display “Risk sizing unavailable — contract economics not verified”. Do not show a fabricated quantity.
- A visible opportunity does not mean a trade is feasible or profitable.

**Exit gate**
- Every card links to its exact chart event.
- Evidence and contradictions are inspectable.
- No probability or “win chance” is shown without calibration.
- Unknown economics never result in a SIZED plan.

## Phase 8 — Research provenance and validation

This phase makes the opportunity engine auditable rather than merely visually persuasive.

- Extend Run and replay persistence with immutable provenance: data revision/hash, source, quote policy, metadata/calendar versions, strategy/config hash, detector/engine build, costs and parameters.
- Preserve every replay, run, parameter trial and failed result.
- Add chronological train/validation/locked holdout and walk-forward evaluation.
- Test parameter neighborhoods, cost/slippage/gap sensitivity and cross-period/regime stability.
- Correct for multiple trials where appropriate.
- Never tune against the locked holdout.
- Separate historical replay discovery from out-of-sample strategy validation.
- Label all current strategy verdicts as screening/research status, not proof of a tradable edge.

**Exit gate:** a replay or research result can be reproduced from immutable inputs and exact versions.

## Phase 9 — Paper forward testing (later, not an MVP blocker)

- Add append-only paper order intents, order events, fills, positions and ledger.
- Simulate bid/ask, latency, spread, partial fills, commissions, slippage and gap-through.
- Require explicit user acknowledgement for every paper intent.
- Monitor-only is default; kill switch blocks new paper entries.
- Recover ledger state after restart.
- Compare forward paper fills to historical/backtest assumptions.
- No live broker route or live credentials in this release.

## Phase 10 — Release/operational certification

- Playwright/browser, API, worker and security suites.
- Data-use/licence review and provider feed-label matrix.
- Backup/restore drills for SQLite and manifests.
- Process supervision, storage quotas, logs, health and failure alerts.
- Clean-clone reproducibility.
- Preregistered forward paper period on both primary instruments.
- Release manifest includes commit, data hashes, versions, tests, limitations and rollback.

---

## 6. The first practical release: MVP milestones

Do not wait for all ten phases. Deliver in this sequence.

### MVP-1 — local workstation starts
- Reproducible install and environment.
- Next.js app runs locally.
- Monitor workers start/stop separately.
- System status shows process state and freshness.
- Existing Binance/Yahoo desk remains available.

### MVP-2 — verified Duka history
- Real XAUUSD-DUKA and NAS100-DUKA history imported for H1/M15/M5 as practical.
- Exact dataset revision selectable in chart.
- Source side and quality visible.
- Bid/ask pairing report and actual gaps available.

### MVP-3 — Duka monitor appears in chart
- Latest monitor snapshot is consumed by the chart adapter.
- Forming candle updates; closed candle is immutable.
- Status/age/polling label visible.
- Historical overlap reconciles after restart.

### MVP-4 — historical opportunity scan
- “Scan visible range” and “Scan current day”.
- Deterministic replay with no lookahead.
- Historical markers at exact occurrence timestamps.
- Opportunity details show when it occurred and when AMI discovered it.
- Historical and current opportunity tabs separated.

### MVP-5 — live opportunity continuation
- Worker catches up to latest closed bar at startup.
- Processes each new closed bar exactly once.
- Existing reducer/store maintains status.
- Feed stale => suppress, not fabricate.
- New candidate and transition markers appear without page reload.

At MVP-5, the user can host locally, observe the primary markets, see chart updates, scan earlier setups from the day/window, and monitor new opportunities. Paper OMS is not required for this milestone.

---

## 7. Local hosting runbook target

The repository already uses Bun and has scripts for the app, DB and monitor. The intended local commands, after the supervisor and docs are completed, should be:

```powershell
# From the AMI repository root
bun install --frozen-lockfile
Copy-Item .env.example .env
# Edit .env: local DATABASE_URL, unique NEXTAUTH_SECRET,
# NEXTAUTH_URL=http://localhost:3000

bun run db:generate
bun run db:push
bun run dev
```

In separate PowerShell terminals, the existing experimental workers can currently be invoked as:

```powershell
bun run market-data:monitor -- --instrument XAUUSD-DUKA --timeframe m1 --poll-seconds 60
bun run market-data:monitor -- --instrument NAS100-DUKA --timeframe m1 --poll-seconds 60
```

These commands start the experimental pollers only. They do **not** currently make the Duka monitor a chart feed or create automatic opportunities. That wiring is part of MVP-3 to MVP-5.

After the supervisor is implemented, replace multiple manual terminals with one command, for example `bun run local:start`, and provide `bun run local:stop` plus a system status page.

Do not expose localhost services publicly or put market archives, SQLite databases, provider credentials or private sample data into Git.

---

## 8. Performance and reliability design

- Keep the Next.js UI responsive; workers must not run long replay jobs inside request handlers.
- Replay jobs use bounded batches, checkpoint cursors and resumable leases.
- SQLite is acceptable for a single-user local MVP with low write concurrency. Keep raw/normalized candle archives on the filesystem. Reassess Postgres only if multi-user, concurrent worker or remote-host requirements justify it.
- Cache replay results by immutable input identity, not only symbol/timeframe.
- Bound chart history and markers; lazy-load older windows.
- Use one monitor process per instrument/provider configuration, not one per chart panel.
- Multiple chart panels subscribe to the same normalized market-data state.
- Store UTC timestamps; format for the user at presentation time.
- Record both provider event time and local receive time to detect clock skew and stale feed.
- All APIs validate instrument/timeframe/dataset identity and enforce user session.
- Keep process secrets and database paths local.
- Add retention controls and disk-space warnings before large M1 imports.

---

## 9. Explicit unresolved decisions

Do not guess these values during implementation:

1. Dukascopy real-time access availability, actual cadence, market coverage and permitted use.
2. Session calendars and DST rules for each instrument.
3. Whether the primary chart analysis basis should be bid, ask or a declared derived midpoint.
4. Verified point value, quantity increment, fees, slippage and margin for the user's actual broker CFD/OTC instruments.
5. Whether a true streaming provider is necessary now or experimental polling is acceptable for the first observation MVP.
6. Exact strategy/setup definitions to surface first. Initial recommendation: a small, causal, explainable set using confirmed structure, displacement and HTF agreement; add further filters only after golden-fixture tests.
7. Whether NQZ6 sample use terms permit the intended local evaluation. Keep it isolated until terms and importer reconciliation are complete.

---

## 10. Mandatory implementation feedback loop

For every module:
1. Inspect current interfaces and all call sites.
2. Write deterministic failing tests before implementation.
3. Implement the smallest isolated module.
4. Run focused tests, full Bun tests, lint, strict typecheck and production build.
5. Run API, worker and browser tests relevant to the change.
6. Inspect CI job steps and artifacts, not just the green badge.
7. Exercise a failure case and recovery path.
8. Update architecture docs and capability status.
9. Report files, behavior, test counts, CI URL, limitations, rollback and PASS/BLOCKED/FAIL.
10. Never mark complete based only on code presence or synthetic fixtures.

## 11. Definition of “ready for local live observation”

The system is ready for the requested local observation milestone only when all are true:

- The app starts from a clean clone using documented local commands.
- XAUUSD-DUKA and NAS100-DUKA have real, hash-verified historical intraday data.
- Monitor status shows provider timestamp, receive time, age and honest polling/feed state.
- The chart uses the correct source identity and updates the forming candle without corrupting closed bars.
- Reconnect/backfill recovers missed intervals or visibly marks unresolved gaps.
- “Scan current day” and “Scan visible range” replay all eligible closed bars plus warmup.
- Historical opportunities are anchored to occurrence bars and labelled retrospective.
- Live continuation starts from a persisted watermark and does not duplicate events.
- Every candidate has evidence, contradictions, data lineage and lifecycle.
- Stale or unverified inputs suppress current candidates.
- No unsupported risk sizing is shown.
- Browser regression tests pass on 1/2/4 charts and mobile-focused mode.
- Live broker routing remains absent/disabled.

**This is the target for the next release.** Research validation, paper OMS and final certification follow after the local observation loop works end to end.


---

## 11. Implementation evidence and current completion state (2026-11-18)

This section maps the original phases to the actual code on branch `ami/local-live-opportunity-completion`. “Implemented” here means code, schema, tests and CI integration exist; it does **not** mean the user's local machine or a full provider session has been certified.

| Original phase | Current implementation | Completion state | Remaining acceptance |
|---|---|---|---|
| 0 — Decisions and ground rules | `docs/16_MARKET_CONVENTIONS_AND_GOLDEN_DAYS.md`; XAUUSD-DUKA and NAS100-DUKA identities; UTC review range; quote-side rules; detector v1.0.0 vocabulary | Partially implemented | User's actual broker/execution venue, account currency, trading-day roll and approved setup vocabulary still require confirmation |
| 1 — Verified market data | Dukascopy M1/M5/M15/M30/H1/H4/D1 importer; separate BID/ASK revisions; importer v2; hashes; strict missing-interval diagnostics | Code implemented | Actual BID/ASK archives for both instruments must be downloaded, quality reports inspected and anomalies classified |
| 2 — Instrument spec registry | Existing risk calculator refuses unknown economics | Not complete for the target instruments | Exact venue-specific contract size, tick/point value, margin, fees, quantity steps, financing and currency conversion must be verified |
| 3 — Chart workstation shell | Existing 1/2/4 workstation; local M1 selection; chart-range API; side-specific recent poll tail; separate tick/spread display; historical Day Review chart | Code implemented | Verify in a real browser and confirm quote-side/closed-bar behaviour against live snapshots |
| 4 — Setup engine and day review | Pure causal replay engine; structure-break/retest detector v1.0.0; replay API; transactional persistent replay/event log; Day Review lifecycle timeline and retrospective markers | Code implemented | Curate real golden days and compare with hand-annotated expectations; add more detector types only after baseline validation |
| 5 — Live developing view | Supervisor, two M1 pollers, four BID/ASK live opportunity workers, durable per-side cursor, closed-bar-only processing, active setup/invalidation UI, health timestamps, LIVE_MONITOR/LIVE_BOOTSTRAP/LIVE_RECOVERY origins, dataset-backed recovery attempt | Code implemented; provider certification pending | Run real sessions, verify the worker's recovery revision matches the poll snapshot exactly, test disconnects, stale feed and market reopen |
| 6 — Risk engine | Existing pure sizing calculator and fail-closed behavior | Not certified for XAUUSD-DUKA/NAS100-DUKA | Add venue-specific specs and independently cross-check at least 10 cases per instrument |
| 7 — Acceptance | CI and deterministic test fixtures | Not complete | Ten consecutive sessions per instrument with no unexplained replay/live/data discrepancies |

### 11.1 Causal processing contract

The historical and live paths invoke the same `createStructureBreakRetestMachine` detector implementation. Each call receives one newly closed M1 bar and the detector's persisted state. The detector cannot access a future bar or a wall-clock timer. The worker stores a bar fingerprint and will reject a correction to an already processed candle.

The first forward-worker start reconstructs recent state and records any generated events as `LIVE_BOOTSTRAP`. Only bars processed after the persisted watermark are `LIVE_MONITOR`. If the monitor sample no longer contains a continuous sequence, the worker tries to load an exact, hash-verified, PASS Dukascopy dataset for the same instrument, timeframe and BID/ASK side. It accepts a recovery only when:
- the dataset contains the exact previously processed watermark candle;
- its OHLCV fingerprint matches the persisted candle fingerprint;
- every subsequent M1 interval is present with no unclassified gap;
- the recovered series reaches the latest closed candle in the current monitor snapshot.

Events generated during such a catch-up are `LIVE_RECOVERY`, not `LIVE_MONITOR`. Each recovered event stores the dataset revision ID/hash. If no matching revision bridges the interval, the cursor remains `GAP_UNRECONCILED`; it does not skip missing bars.

A deliberate `--reseed` creates a new cursor generation while retaining old events. It is an operator action that discards continuity of the prior detector state; it must not be used as a substitute for a verifiable backfill.

### 11.2 All-in-one local start target

The code-level entry point is:

```powershell
bun run local:station -- start
bun run local:station -- status
bun run local:station -- stop
```

The supervisor manages:
- Next.js local workstation on `127.0.0.1:3000`;
- Dukascopy M1 polling worker for XAUUSD-DUKA;
- Dukascopy M1 polling worker for NAS100-DUKA;
- XAUUSD-DUKA BID and ASK closed-bar opportunity workers;
- NAS100-DUKA BID and ASK closed-bar opportunity workers.

The monitor currently keeps a rolling 64-bar M1 sample. The detector processes only closed candles; the forming candle can be displayed but cannot advance the lifecycle. The first structure-break/retest pattern can remain active for at most 20 bars after its break/retest windows, so this sample provides a reasonable startup context for this v1 detector. It is not a replacement for full historical Day Review.

### 11.3 Proposed completion plan from this implementation point

1. **Local runtime verification:** run the launcher on the actual Windows machine; confirm the Prisma DB path, local auth setup, six managed workers, startup/shutdown, worker PID locks, heartbeat, and restart policy. Capture a status snapshot and runtime log.
2. **Real market-data certification:** import manageable current and historical M1 BID/ASK ranges for both instruments. Verify dataset hashes, gap diagnostics, duplicate candles, zero-range candles, outliers, bar timestamp boundaries and source-side pairing. Do not accept REVIEW as PASS merely to continue.
3. **Live chart verification:** keep the poller active during an open market; confirm the selected BID chart receives only BID candles (ASK only ASK), latest tick/spread is separate, forming bars do not generate lifecycle transitions, and stale/no-tick/error status is honest.
4. **Historical event validation:** choose at least five dates per instrument initially, then expand to 5–10 golden days. Hand-annotate structure pivots, break confirmation, retest, trigger, invalidation and expiry. Run Day Review twice and compare event hashes and timeline.
5. **Recovery fault injection:** stop the detector for under and over eight minutes; confirm rolling-sample catch-up, then import a matching verified revision and test dataset-backed recovery. Change an old bar and verify fingerprint mismatch pauses the cursor. Test a session/weekend gap and ensure it does not silently resume.
6. **Live-vs-replay reconciliation:** for every monitored session, replay the exact same quote-side revision and compare the expected event sequence against `LIVE_MONITOR` plus `LIVE_RECOVERY`. A mismatch must produce an incident and remain inspectable; never overwrite old event history.
7. **Risk certification:** only after the actual broker/venue is selected, source the full contract economics and conversions, record provenance, and independently cross-check the calculator. Until that is done, show risk as unavailable and do not calculate position size.
8. **Browser and operational acceptance:** add Playwright tests for authentication, 1/2/4 chart layouts, local/provider switch, M1 side matching, stale/reconnect state, Day Review, event markers, supervisor restart and recovery. Run ten consecutive real sessions per instrument before declaring the first useful version accepted.

### 11.4 Release boundary

The implementation provides a local observation and retrospective opportunity research workstation. It does not yet provide a certified trading signal, strategy profitability, simulated fill, paper order-management system, or live broker execution. Real provider/data validation, venue economics, user strategy approval and ten-session acceptance remain external gates.
