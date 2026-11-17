# 11 — AMI final execution plan

## 0.1 Implementation snapshot — 17 November 2026

This snapshot separates committed code from live-market validation and research-engine eligibility.

| Work item | Current evidence | Remaining gate |
|---|---|---|
| P0 workstation and signal repair | Refresh/polling/chart lifecycle and live/backtest evaluator changes committed | Manual browser sign-off |
| CI and deterministic engine/data tests | GitHub Actions run #218 passed on 17 November 2026: frozen install, Prisma, lint, strict type-check, 70 Bun tests across 10 files, four offline CLI smoke checks and production build | Add route-level integration, browser, accessibility and security tests |
| Canonical instrument metadata | CFD, OTC spot, dated futures, continuous futures and tokenized metal are distinct | Migrate active registry and verify contract/session economics |
| XAU/USD and NAS100 history | Pinned Dukascopy downloader, separate bid/ask imports, UTC normalization and manifests committed | Import real data and audit actual coverage/session gaps |
| Dataset provenance and verification | Hash-bound IDs; source CSV replay; normalized CSV regeneration; OHLC, duplicate, gap, volume, identity and quality checks; CLI/API catalogue | Resumable downloads and real-data audit |
| Historical chart selection | Each chart panel pins one exact immutable dataset ID; PASS revisions are offered by default; REVIEW revisions require an explicit UI switch and API opt-in; bars appear only after source replay and hash verification | Browser UX validation and a real imported dataset |
| Market structure overlay | Confirmed BOS/CHoCH markers plus observed high/low from the nearest prior available UTC calendar date; the latter records its date and observed bar count and does not claim session semantics | Verified exchange-session levels, supply/demand zones and volume-qualified session VWAP |
| Experimental current-rate monitor | Isolated pinned Dukascopy runtime, getRealTimeRates polling worker, bid/ask candles + latest two-sided tick, forming/closed split, atomic snapshots and authenticated status API | Run against provider; verify access/cadence/terms, session-aware freshness, reconnect/backfill and chart-feed integration |
| Research/backtest integration | Not enabled for XAUUSD-DUKA or NAS100-DUKA | Verify instrument costs/contract economics, then add exact dataset ID and provenance to runs |

The Dukascopy workflow downloads bid and ask separately and retains the source export, normalized bars and SHA-256 manifest under the ignored local path `data/market-data/`. The importer does not fill gaps. Zero-volume candles are omitted by the provider by default, so the download orchestrator does not retry every empty partition; weekends/holidays remain for calendar-aware gap classification. PASS datasets are offered by default in chart panels; REVIEW datasets are available only after a deliberate UI opt-in and still undergo full verification.

The chart desk also offers an observed prior available UTC-date high/low overlay. It skips missing dates without filling them and is explicitly not an exchange-session level.

The optional current-rate monitor uses the documented `getRealTimeRates` Node API through an isolated local runtime pinned to dukascopy-node 1.51.1. It polls ticks and separate bid/ask candles, writes atomic snapshots, and exposes status through an authenticated API. The chart desk labels it **EXPERIMENTAL POLLING · NOT THE CHART FEED**. It is not a persistent WebSocket, has not yet been run against a real provider session in this implementation, and must not be treated as exchange-grade or used for order execution. Monitor ticks are not yet injected into the chart series.

**Important boundary:** the new local datasets are currently chart-selectable only. They are not yet wired into the strategy/backtest runner and the two new instruments are not in the active tradable instrument registry. Their contract point values, quantity increments, fee/spread/financing costs and calendars are still unverified. The risk engine must not infer those values from the CFD/spot labels.

No real market-data archive has been downloaded or audited by this implementation. The CI workflow is offline for provider data; passing CI proves code/build invariants, not market-data coverage, feed freshness or trading performance. Live order routing remains disabled.

---
## Final Test Candidate program · Nasdaq-100 and XAU/USD first

**Program status:** approved implementation blueprint; the deliverables below are planned unless explicitly marked completed in the source branch.  
**Execution branch:** `ami/repair-p0-chart-and-signal-integrity`  
**Release target:** `AMI Final Test Candidate (FTC)`  
**Operating mode:** market monitor + research + conditional opportunities + paper trading. No live broker order routing in the FTC.

This document is the governing plan to take AMI from the current research workstation to a tested, reproducible, live-monitoring and paper-trading quant system. Work is sequenced so each phase has a concrete output, test suite, acceptance gate and dependency. Do not skip a gate because the UI looks complete.

---

## 1. Product outcome

AMI FTC must be able to:

1. Monitor the priority markets — **Nasdaq-100-related markets and spot XAU/USD** — with honest feed/freshness labels.
2. Display multiple continuously updating charts, closed history, forming candles, volume, market structure and strategy overlays.
3. Identify conditional opportunities, rank them by transparent evidence and explain why they are active, waiting, suppressed or invalidated.
4. Calculate entry zone, invalidation/stop, targets, quantity, estimated costs, gross/net risk, reward-to-risk and margin/notional where instrument specifications are verified.
5. Backtest and forward-test the same strategy definitions with reproducible datasets, costs and engine versions.
6. Preserve all experiments, including failed experiments, and measure paper outcomes against the model.
7. Keep the user in control. No candidate automatically becomes a live order.

### Definition of “final”

“Final” means a signed-off test candidate with passing automated checks, verified data-source boundaries, complete research provenance, tested risk calculations, operational monitoring and a paper-forward-test report. It does not mean that any strategy is guaranteed profitable or that the system has proved a future edge.

---

## 2. Priority market and free-data policy

### 2.1 The key distinction: three Nasdaq-like instruments are not interchangeable

AMI must not collapse these instruments into one symbol:

| Canonical instrument | What it is | Allowed use |
|---|---|---|
| `NAS100-DUKA` (proposed canonical ID) | Dukascopy `usatechidxusd`, USA 100 Technical Index CFD | Primary free Nasdaq-100-style historical/monitor series; provider CFD pricing |
| `NQ` / dated `NQ[month][year]` | CME E-mini Nasdaq-100 futures contracts | Futures-specific research and paper contract calculations only when dated contract data and specs exist |
| `NQ=F` | Yahoo Finance continuous front-month Nasdaq futures symbol | Secondary research reference only; not an executable dated contract |
| `QQQ` / `NDX` | Nasdaq-100 ETF / cash index (depending on symbol/provider) | Optional cross-checks and context, never a replacement for NQ fills |
| `NASDAQCOM` | Nasdaq Composite daily close | Macro context only; it is not the Nasdaq-100 |

**Default first target:** implement `NAS100-DUKA` and `XAUUSD-DUKA` as the primary free historical research pair. Keep NQ futures as a separately typed instrument, using free samples / limited daily bars for data-pipeline validation until full-quality dated history is available.

Dukascopy's public instrument catalog identifies `usatechidxusd` as a USA 100 Technical Index and `xauusd` as XAU/USD. This Nasdaq CFD is not the Nasdaq cash index and is not CME NQ futures. [Provider instrument catalogue](https://github.com/Tradelyy/dukascopy-tools).

### 2.2 Free historical data source decision

| Priority | Source | Free coverage/use | AMI decision | Important caveat |
|---|---|---|---|---|
| A1 | Dukascopy historical feed via `dukascopy-node` | XAU/USD tick and OHLC data; provider page documents ticks and minute/hour/day candles, with XAU/USD minute/hour coverage shown from 2003-05-05 | **Primary XAU/USD history candidate** | OTC/broker feed, not a consolidated exchange tape; retain bid/ask and provider identity; tick volume is not centralized exchange volume |
| A1 | Dukascopy `usatechidxusd` | USA 100 Technical Index CFD; catalogue shows historical minute/hour/day data beginning 2011-09-18 | **Primary free Nasdaq-100-style history candidate** | CFD quote stream, not CME NQ futures or official cash-index prints; no NQ contract multiplier may be applied |
| A2 | Dukascopy `getRealTimeRates` API through `dukascopy-node` | Latest ticks and current/forming candles; XAU/USD example is documented | **Experimental monitor adapter** | API is explicitly marked experimental; validate availability, cadence, reconnect behavior, terms and rate limits before showing `LIVE` |
| B1 | HistoricalFuturesData NQ catalogue | Free no-account sample ticks and free-account latest-month bars / selected daily history | **NQ format/roll/test fixture candidate** | Site advertises full continuous/dated intraday history as paid; verify provenance, download checksums, contract mapping and terms before trusting |
| B2 | Yahoo Finance `NQ=F` | Public continuous futures history through chart API | **Secondary cross-check only** | Intraday coverage/retention can be constrained and may differ by interval; the current AMI 1h coverage assumption must be empirically probed rather than trusted |
| B2 | Yahoo Finance `GC=F` | Public continuous gold-futures series | **Secondary gold-futures cross-check only** | It is COMEX futures context, not spot XAU/USD; continuous-series roll/adjustment issues apply |
| C | FRED `NASDAQCOM` | Long daily Nasdaq Composite close observations | Context only | Nasdaq Composite is not Nasdaq-100; daily close only and FRED warns of data copyright conditions |
| C | Alpha Vantage free API | 25 requests/day for broad free services | Not a primary intraday source | Current documentation labels intraday US feeds and Nasdaq-100 index data as premium; insufficient for dense multi-market polling |
| Paid fallback | CME DataMine | Official CME historical settlements/trades/top-of-book/depth datasets | Not required for free-first milestone | Official high-quality source, but historical access is purchased; evaluate only if actual dated NQ/MNQ history becomes a hard requirement |

**Data-source references**
- Dukascopy XAU/USD coverage and selectable bid/ask output: https://www.dukascopy-node.app/instrument/xauusd
- Dukascopy historical CSV/JSON API quick start: https://www.dukascopy-node.app/quick-start
- Dukascopy experimental latest-tick/current-candle API: https://www.dukascopy-node.app/downloading-real-time-data
- Dukascopy instrument catalogue (XAU/USD and USATECH): https://github.com/Tradelyy/dukascopy-tools
- Free sample / free-account NQ coverage: https://historicalfuturesdata.com/en/browse/NQ
- Yahoo intraday history limitations reference: https://ranaroussi.github.io/yfinance/reference/yfinance.price_history.html
- Nasdaq Composite definition and frequency: https://fred.stlouisfed.org/series/NASDAQCOM
- CME official historical data access: https://www.cmegroup.com/market-data/real-time-and-historical-data.html
- Alpha Vantage API endpoint tiers: https://www.alphavantage.co/documentation/

The open-source `dukascopy-node` library is MIT-licensed; that is the code licence, not a blanket grant to redistribute underlying market data. Keep imported raw data local/private unless the source's data-use rights are separately confirmed. The library documentation says it is not affiliated with or endorsed by Dukascopy Bank and describes the latest-rates API as experimental. Do not describe it as a guaranteed exchange-grade feed.

### 2.3 Data tiers and labels

Every instrument/data response must identify its data class:

- `EXCHANGE_FUTURES`: dated exchange-traded futures contract with verified contract metadata.
- `BROKER_CFD`: broker/index CFD quote series (e.g. Dukascopy USATECH); not fungible with an exchange futures contract.
- `OTC_SPOT_METAL`: XAU/USD spot/OTC quote feed; bid/ask and provider-specific pricing.
- `ETF`: exchange-traded fund.
- `CASH_INDEX`: official cash index observations.
- `CONTINUOUS_FUTURES`: derived continuous series for research only, with roll method and source recorded.

The UI must state the data class beside the symbol. It must never label NAS100 CFD prices as NQ, or XAU/USD spot as GC futures.

---

## 3. Data engineering contract

### 3.1 Canonical instrument metadata

Before adding any new source, replace assumptions in the current loose `Instrument` type with a versioned metadata contract:

- canonical instrument ID and display name
- asset class and data class
- source provider, source instrument ID, provider account/venue
- quote currency, base currency and contract currency
- tick size, price precision, quantity increment and minimum quantity
- point value / contract multiplier (nullable unless verified)
- contract expiry, first notice date, last trade date and roll metadata for futures
- trading sessions, holiday calendar, timezone and DST policy
- price side (bid, ask, mid, last/trade) and volume semantics
- fees, spread and slippage model with source/date/assumption fields
- data rights / retention / redistribution label
- metadata version and verification timestamp

Do not permit a trade-plan calculator to infer a contract multiplier from an asset-class label.

### 3.2 Historical import pipeline

Create an idempotent importer independent of Next.js request handling:

```text
provider download
  → preserve raw file
  → checksum + import manifest
  → parse and normalize UTC timestamps
  → validate OHLC/price-side/volume
  → deduplicate + sort
  → gap/session diagnostics
  → partitioned local dataset
  → dataset version/hash
  → provider-independent getBars adapter
```

Expected operator commands (exact CLI syntax can be selected during implementation):

- import XAU/USD M1/M5/M15/H1/H4/D1 from Dukascopy
- import USATECH M1/M5/M15/H1/H4/D1 from Dukascopy
- import NQ free sample / selected daily data for fixtures and comparisons
- verify an existing dataset
- report coverage, missing intervals, duplicate timestamps, invalid bars and checksum

Store large datasets outside Git (e.g. ignored `data/market-data/` or an externally mounted dataset volume). Git should hold manifests, import configs, test fixtures and documentation — not multi-gigabyte market history.

### 3.3 Dataset manifest

Every dataset revision must have a manifest with:

- dataset ID, instrument ID, data class and provider
- provider instrument code and price side
- interval, UTC coverage start/end and exchange/session calendar
- raw file SHA-256 and normalized dataset SHA-256
- import tool/version and importer version
- import timestamp, row count, duplicates, gaps, invalid rows
- volume interpretation (trade volume, tick volume, unavailable)
- data licence/usage note and retention restriction
- futures contract IDs and roll methodology if applicable

Backtests may not silently combine providers or switch quote side mid-run.

### 3.4 Quality gates

- UTC epoch timestamps with documented open/close semantics.
- Strict monotonic timestamps after deduplication.
- OHLC integrity: high ≥ max(open, close, low); low ≤ min(open, close, high); prices finite and positive.
- Volume finite and non-negative; zero/missing volume distinguished from actual zero.
- Bid/ask feeds retain each side and derive mid only under an explicit rule.
- Gaps are measured against the instrument's trading calendar, not blindly against 24/7 time.
- No filling weekend/session gaps with synthetic bars.
- Partial/incomplete buckets have an explicit availability/close timestamp.
- A changed raw source file creates a new dataset revision, not a silent overwrite.

---

## 4. End-to-end implementation phases

Each gate is a hard dependency for the next stage.

### Phase 0 — Stabilize the current repair (maps to Stage 0)

**Work**
- Review draft PR #1 source changes.
- Run dependency install, Prisma generation, lint, TypeScript check, production build and current smoke scripts on a clean checkout.
- Resolve every compile/build failure; remove `typescript.ignoreBuildErrors` only after the baseline has been measured and fixed.
- Fix any regressions in chart refresh, empty-data replacement, visibility handling and HTF fail-closed behavior.
- Do not merge a draft PR merely because source-level checks passed.

**Deliverables**
- Green clean-checkout build.
- First automated regression test suite.
- CI status visible on PR.
- A short baseline validation report.

**Exit gate**
- Build/typecheck/lint/tests green.
- No P0/P1 chart/data-integrity or signal-causality issues.
- `main` unchanged until reviewed and explicitly merged.

### Phase 1 — Automated test and CI foundation (maps to Stage 1)

**Work**
- Add GitHub Actions using the project's pinned Bun version and frozen lockfile.
- Add scripts for `typecheck`, `test`, `test:engine`, `test:data`, `test:api` and a reproducible build.
- Unit tests: indicators, resampling, bar normalization, strategy config validation, HTF causal gate, next-open fills, fee/slippage, stop/target/gap/liquidation ordering and sizing.
- Integration tests: auth boundaries, REST provider failures, caching, campaign persistence/restart and run-result provenance.
- Browser tests: 1/2/4 chart layout, symbol/timeframe changes, manual refresh, stale/errors, resize, tab visibility and opportunity lifecycle (as later phases land).
- Add deterministic fixtures, fake clocks, seeded random inputs and no network dependence in ordinary CI.
- Add dependency/secret scanning and a license policy.
- Require branch-protection checks before merge.

**Exit gate**
- A clean clone can install and run all checks with no external market API key.
- Every critical engine invariant has a deterministic regression test.
- PR checks are required and a red test cannot be ignored.

### Phase 2 — Primary historical datasets (free-first)

**Work**
- Implement Dukascopy historical importer for `xauusd` and `usatechidxusd`.
- Import daily and hourly history first; then M1/M5/M15 for the intended strategy lookbacks.
- Probe actual provider availability by interval/range and store results in manifests. Do not trust hard-coded coverage estimates.
- Keep raw bid/ask when supported; for XAU/USD use bid/ask-derived mid for signal analysis and apply a spread/cost model for executions.
- For NAS100 CFD, preserve its native CFD price series and quote/cost assumptions.
- Add NQ sample ingestion for schema tests. Keep NQ full-history availability separate and clearly `PARTIAL` until proven.
- Add cross-source date/close comparison against Yahoo `NQ=F`, `GC=F`, or ETFs only as a diagnostic, never as a forced price splice.
- Add missing data backfill, import resumption and dataset verification commands.

**Exit gate**
- At least one verified and versioned history per primary instrument at D1, H1, M15 and M5 (M1 where available).
- Each imported series passes data-quality and timezone/session tests.
- No source mixing or instrument alias ambiguity in backtests.
- Research reports can show actual coverage, provider and quote type.

### Phase 3 — Live market monitor (maps to Stage 2)

**Work**
- Evaluate Dukascopy `getRealTimeRates` for XAU/USD and USATECH as a low-cost/zero-subscription monitor prototype; confirm it works for the required instruments from AMI's deployment environment.
- Since its API is experimental, isolate it behind a provider adapter with a kill switch and a REST snapshot fallback.
- Establish provider receive timestamps and market timestamps; estimate latency; poll latest ticks/candles conservatively unless a documented streaming transport is proved.
- For NQ futures, do not infer a live CME stream from Yahoo `NQ=F`. Retain the NQ source as reference-only until a valid entitled source exists.
- Add bounded retry/backoff, last-good quote cache, stale detection, provider outage state, duplicate/out-of-order filtering and reconnect/backfill.
- Distinguish `LIVE`, `DELAYED`, `STALE`, `DISCONNECTED`, `CLOSED` and `UNKNOWN` statuses.
- Add per-market freshness policy (interval/session-aware) and suppress new opportunities when feed state violates policy.

**Exit gate**
- Both primary monitoring instruments produce timestamps, visible age and a deterministic stale state.
- Disconnect/restart/backfill tests prove no missing or duplicated closed bars.
- Live/data labels do not overstate source or entitlement.
- NQ futures is clearly marked unavailable/reference-only until a valid feed is selected.

### Phase 4 — Streaming chart desk (maps to Stage 3)

**Work**
- Keep immutable historical closed bars and a separate mutable forming bar.
- Seed chart from historical dataset; incrementally update from new provider rates.
- Finalize each bar exactly once at interval close; reconcile the finalized bar against the historical endpoint.
- Add price line, current bid/ask/spread where available, candle countdown, provider/market timestamps, volume and stale overlay.
- Synchronize crosshair/time cursor optionally across charts.
- Preserve existing 1/2/4 layout, watchlist, right rail and dock; avoid duplicating the app shell.
- Add reconnect visual state and missing-data markers.

**Exit gate**
- A market update moves last price/forming candle without a full history reload.
- Closed candles do not repaint and reconnect backfill restores continuity.
- Chart tests cover all layouts, changed symbols, zero bars, error state, resizing and unmount.

### Phase 5 — Market structure and context engine

**Work**
- Prior day/week/month high/low and settlement levels (with instrument-specific session definitions).
- Asia/London/New York and cash-open ranges where the instrument calendar supports them.
- VWAP with source/volume semantics explicitly stated; do not fabricate exchange volume from spot tick volume.
- Swing highs/lows, break of structure, change of character and confirmed pivots.
- Supply/demand zones with origin, timeframe, touch count, mitigation, invalidation and expiry.
- Multi-timeframe confluence, ATR/volatility regime and economic event windows.
- Prevent repainting: a swing/zone may only become visible after its confirmation rule has elapsed.

**Exit gate**
- Golden fixture tests prove each structure event appears at its causal timestamp.
- Chart overlays expose timeframe and calculation method.
- No retrospective pivot painting or future data leakage.

### Phase 6 — Opportunity engine (maps to Stage 4)

**Work**
- Build a strategy-independent candidate model and lifecycle: `WATCH → NEAR_TRIGGER → TRIGGERED → INVALIDATED / EXPIRED / SUPPRESSED`.
- Candidate creation consumes validated closed bars, live forming/quote state, strategy rules, HTF gate, structure and event risk.
- Add event-time audit history and idempotent candidate keys to prevent duplicate alerts.
- Add deterministic evidence (rule completion, trend/HTF, zone/level proximity, volatility, liquidity/volume context, event calendar and data freshness).
- Explain positive evidence and contradictions separately.
- Rank with documented evidence score; no probability language until calibrated out-of-sample.

**Exit gate**
- Same inputs and market event stream reproduce the same candidate transitions.
- Duplicate candidate generation is prevented.
- Missing/stale data, HTF failure and policy blocks always suppress rather than create a candidate.
- User can inspect exactly why a candidate exists, changes state or expires.

### Phase 7 — Trade calculator and risk constraints

**Work**
- Store user-selected account equity, currency, risk per trade, daily loss cap, open-risk cap, max exposure, leverage cap and session policy.
- Implement separate sizing modules for spot metal, CFD, ETF and exchange futures.
- Use verified tick size, quantity increment, contract point value, fees, spread, slippage and currency conversion.
- Compute entry scenarios, stop/invalidation risk, T1/T2 net rewards, net R multiple, notional, leverage and estimated margin.
- Round to actual tick/lot increments and recompute risk after rounding.
- Model gaps and stop execution slippage; never guarantee a stop fill.
- Return `NO TRADE` if metadata is unverified, costs are missing, minimum size breaches risk budget or the max risk limits fail.
- Persist the exact inputs and calculation version on every proposed plan.

**Exit gate**
- Deterministic test vectors pass for each supported instrument class.
- Every output is reproducible from saved inputs.
- No CME NQ/MNQ or GC/MGC multiplier can be applied to NAS100 CFD or XAU/USD spot.
- Risk budget, rounded quantity and stressed stop loss never exceed configured hard limits without explicit visible suppression.

### Phase 8 — Research engine upgrade (maps to Stage 5)

**Work**
- Pin dataset version/hash, instrument metadata version, strategy version, engine version, cost model, session calendar and parameters on every run.
- Add chronological train/validation/locked holdout splits. Lock the holdout before any tuning.
- Walk-forward windows with report of each fold and pooled out-of-sample results.
- Parameter neighborhood/sensitivity surfaces; no reporting only the best parameter.
- Fees/spread/slippage/gap/latency stress scenarios.
- Block bootstrap / uncertainty intervals for autocorrelated trade returns.
- Correct for multiple trials using a suitable method such as Deflated Sharpe / PBO / reality-check family; document assumptions.
- Regime and cross-period validation.
- Rename current `PASS` to `RESEARCH_CANDIDATE` or retain it as an explicitly non-certified screening status; only a separate validation state can indicate that all gates passed.
- Keep losing runs and all search attempts.

**Exit gate**
- Every result can be exactly reproduced.
- Locked holdout has not been used during model/parameter selection.
- Robustness and uncertainty reports are generated with sample sufficiency.
- No strategy is called validated solely from in-sample PF/t-stat/split-half score.

### Phase 9 — Paper OMS and forward test (maps to Stage 6)

**Work**
- Append-only paper order/position/ledger records.
- Market/limit/stop intent, reject/cancel/expire, partial fills, spread, fees, latency and gap-through behavior.
- Risk-state service with max daily loss, max open risk, concentration and session/event blocks.
- Monitor-only mode; paper acknowledgement is a deliberate user action.
- Worker state survives restart; campaigns and paper positions cannot be lost when a Next.js process restarts.
- Compare backtest assumptions with forward paper fills and outcomes.
- Add audit/report views for every opportunity → paper decision → order intent → fill → exit chain.

**Exit gate**
- No live order route exists.
- Paper ledger recovers after restart.
- Kill/disable control prevents new entries but never hides existing exposures.
- Forward results are reported separately from historical backtests.

### Phase 10 — Final Test Candidate certification (maps to Stage 7)

**Release activities**
- Complete CI, dependency/license/secret scans, browser smoke and provider recovery drills.
- Review data-use restrictions and the feed-label matrix.
- Back up and restore database/dataset manifests; test migrations on copies.
- Validate logs, alert delivery, worker restart and memory/performance limits.
- Review all critical/high issues; attach known limitations and operational runbook.
- Run a preregistered paper-forward sample window on both primary markets.
- Sign off a test report with the branch/commit, environment, build outputs, data versions and remaining limitations.
- Keep live trading disabled.

**Exit gate**
- All required CI gates pass on a clean clone.
- No critical/high integrity, causality, sizing, security or recovery defects remain.
- Feed/contract metadata and known limitations are visible.
- Paper-forward report is complete and reviewed.
- Release is tagged `ami-ftc-X.Y.Z` with reproducible commit and rollback instructions.

---

## 5. Live opportunity screen: final UI contract

The existing workstation is retained and extended; no duplicate dashboard.

| Location | Final behavior |
|---|---|
| Watchlist | NAS100 CFD, XAU/USD, NQ reference, optional QQQ/NDX and current supported markets; price, daily change, source, age and status |
| 1/2/4 chart desk | Forming and closed candles, volume semantics, structure/levels/zones, strategy markers, candidate trigger/invalidation/targets |
| Right opportunity rail | Ranked candidates, evidence, contradictions, lifecycle, data state, trade-plan summary and suppression reason |
| Bottom Signals | Strategy state and candidate state transitions |
| Bottom Paper | Open simulated positions, orders, stops, targets, realized/unrealized P&L, risk and margin |
| Bottom Events | Economic event windows and permitted trading/session windows |
| Bottom System | Provider health, delay, latency, stale age, cache, background worker, data import and latest dataset version |
| Lab | Reproducible run, walk-forward, sensitivity, holdout, trial history and paper-vs-backtest comparison |

An opportunity card must contain:
- instrument/data class/provider and quote freshness
- setup/strategy key + version + timeframe
- WATCH / NEAR_TRIGGER / TRIGGERED / INVALIDATED / EXPIRED / SUPPRESSED
- direction, trigger, entry range, invalidation and targets
- why the setup exists and what would disprove it
- account equity, risk budget, quantity and quantity increment
- estimated gross/net stop loss and gross/net target rewards
- costs, spread/slippage, R multiple, notional, leverage and margin
- data timestamps, dataset revision and candidate calculation version

---

## 6. Execution backlog and status tracking

Use task IDs in commits, PRs and test reports so separate agents can continue the plan without redefining scope.

| ID | Work package | Depends on | Status |
|---|---|---|---|
| FTC-000 | Existing P0 chart/refresh/HTF repair | — | Draft PR #1; validation still required |
| FTC-010 | CI workflow + typecheck + lint + build gates | FTC-000 | Not started |
| FTC-020 | Engine unit test harness and invariant fixtures | FTC-010 | Not started |
| FTC-030 | Data normalization/resampling tests | FTC-010 | Not started |
| FTC-040 | API/integration/browser test scaffolding | FTC-010 | Not started |
| FTC-100 | Canonical instrument metadata v2 | FTC-020 | Not started |
| FTC-110 | Dukascopy XAUUSD history importer | FTC-010, FTC-100 | Not started |
| FTC-120 | Dukascopy USATECH history importer | FTC-010, FTC-100 | Not started |
| FTC-130 | Dataset manifest/hash/quality CLI | FTC-110, FTC-120 | Not started |
| FTC-140 | NQ free sample importer + separate data class | FTC-100 | Not started |
| FTC-200 | Dukascopy realtime feasibility adapter | FTC-110, FTC-120 | Not started |
| FTC-210 | Market freshness/reconnect/backfill service | FTC-200 | Not started |
| FTC-300 | Live chart/forming candle adapter | FTC-210 | Not started |
| FTC-310 | Market structure and supply/demand engine | FTC-020, FTC-130 | Not started |
| FTC-400 | Candidate lifecycle and alert deduplication | FTC-210, FTC-310 | Not started |
| FTC-410 | Trade-plan/risk calculator | FTC-100, FTC-400 | Not started |
| FTC-500 | Reproducible experiments and dataset pinning | FTC-130 | Not started |
| FTC-510 | Walk-forward/holdout/multiple-trial validation | FTC-500 | Not started |
| FTC-600 | Persistent paper order/position ledger | FTC-410, FTC-510 | Not started |
| FTC-700 | Security/operations/backup/release certification | All above | Not started |

The table is the status source of truth. Update it only when the artifact is committed and its acceptance tests pass. Do not mark a task done because code exists.

---

## 7. Operating constraints and deferred items

- Free-first is a cost policy, not permission to mislabel market data.
- NAS100 CFD is the first broad Nasdaq-100-style dataset. If the desired final instrument is CME NQ/MNQ futures, a full reliable dated-contract historical source may eventually require paid data. Keep that as a separate decision gate.
- XAU/USD is OTC spot; its volume field is feed/tick volume unless proven otherwise. It is not COMEX centralized volume.
- Current Yahoo `NQ=F`/`GC=F` history is for research cross-checks, not dated contract execution or exact contract margin.
- Real-time API calls must be tested for cadence and uptime. If the Dukascopy API remains experimental/unreliable, present it as delayed/best-effort polling or choose another provider; do not claim guaranteed streaming.
- No paid provider, API key or broker account should be assumed available.
- Do not add a broker integration or enable live orders as part of FTC.
- No strategy is guaranteed profitable; opportunity scores are not win probabilities.
- Preserve all losing experiments and all data-quality failures.
- Any data import/worker design must respect host runtime/storage limits; large historical datasets do not belong inside Git or a small SQLite app database.

---

## 8. Completion report template

Every phase closeout should attach:

1. Commit/PR and files changed.
2. Functional outputs and user-visible behavior.
3. Tests run, counts and pass/fail output.
4. Provider and dataset versions used.
5. Known limitations and unresolved risks.
6. Screenshots or Playwright artifacts for UI work.
7. Rollback instructions.
8. Explicit acceptance-gate result: PASS / BLOCKED / FAIL.

This keeps the project finishable, auditable and safe to hand between implementation agents.
