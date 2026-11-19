# AMI implementation status and local runbook

**Status date:** 2026-11-18  
**Implementation branch:** `ami/local-live-opportunity-completion`  
**Scope of this release:** XAUUSD-DUKA (OTC spot metal quote) and NAS100-DUKA (index CFD quote). These are not CME GC/NQ futures.

This document is the operational source of truth for what is implemented, what is only code-complete, and what still needs real local/provider certification. A passing CI run is not evidence that a local data archive was downloaded, that a real provider endpoint is available, or that a trading session was monitored successfully.

## 1. What is implemented on the branch

### 1.1 Local process control

- `bun run local:station -- start` performs Prisma client generation and a non-destructive schema push, starts the Next.js app on `127.0.0.1:3000`, and starts the Dukascopy monitor supervisor for XAUUSD-DUKA and NAS100-DUKA.
- `bun run local:station -- status` prints the local host heartbeat and supervisor snapshot.
- `bun run local:station -- stop` requests graceful shutdown of the host, app and supervisor.
- The supervisor starts one M1 market poller per instrument at a 60-second interval plus four quote-side live opportunity workers (BID and ASK for each instrument) at a 5-second cursor-check interval.
- Each worker is isolated by instrument and quote side, has a process lock and bounded restart policy, and records worker state. The supervisor retries with bounded exponential backoff and stops retrying after five failures in a rolling 15-minute window.
- A live worker consumes only fresh M1 `closedBars`; it never uses a forming candle to transition a setup. It uses the same `structure-break-retest` v1.0.0 detector as historical replay.
- Both the launcher and monitor supervisor write PID/heartbeat state below the ignored local data directory.
- The local runner requires a file-backed SQLite URL and a non-placeholder `NEXTAUTH_SECRET`. It binds the development server to loopback only.
- Order routing remains disabled. The launcher and worker status contracts carry `ordersEnabled: false`.

This is a local development/observation supervisor, not a production service manager. It has not yet been tested on the user's actual Windows installation or through a full overnight run.

### 1.2 Market-data health and chart feed

- The existing Dukascopy worker retrieves a recent tick and recent M1 bid/ask candles independently. The API never constructs a midpoint OHLC from those side-specific candles.
- The monitor API recalculates health on every read using two clocks:
  - monitor snapshot filesystem write age (whether the poller is still writing);
  - provider tick event age (whether the last quote is still fresh).
- A missing tick, stale quote, stale writer and polling error have distinct states. A quiet/closed market is not automatically called a worker failure.
- `GET /api/market-data/live-bars?instrumentId=...&priceSide=bid|ask` exposes the recent M1 bars for one quote side only.
- The chart can merge the recent live polling tail only into a recent, explicitly selected local M1 dataset of the same instrument and same bid/ask side, and only when the monitor status is `FRESH`.
- The current chart quote and spread are displayed separately from the OHLC candles.
- Public Binance/Yahoo sources remain REST/polling sources; they are not WebSocket streams.

**Important:** Dukascopy's real-time function remains experimental polling. The UI does not call it exchange-grade streaming. A stale or unavailable poll leaves the verified historical chart visible and shows the live-feed status separately.

### 1.3 Import and revision integrity

- The Dukascopy importer supports M1/M5/M15/M30/H1/H4/D1, with separate immutable bid and ask datasets.
- Importer version 2 now treats every missing expected candle interval as an unclassified gap. It does not fill or interpolate missing bars.
- Importer version is included in the immutable dataset identity. Importer v1 revisions are not silently re-labelled as passing the v2 gap policy; re-import a required range to obtain a v2 revision.
- Dataset hashes, import parameters, coverage and quality are verified before the dataset is used.
- PASS datasets are eligible for charting and signal research. REVIEW datasets require explicit opt-in. REJECTED datasets remain blocked.
- A single-side dataset is never represented as paired bid/ask or midpoint history.

**Not yet done:** no claim is made that the full required XAUUSD/NAS100 M1 bid+ask archives have been downloaded or locally certified. Local archives live under `data/market-data/` and are ignored by Git.

### 1.4 Historical replay and Day Review

- The replay engine is deterministic and processes exactly one closed bar per detector step. A detector receives its current bar and its own accumulated state, not the future series.
- Replay records market-time occurrence separately from the first closed-bar time at which the event could have been discovered.
- Evidence timestamps later than the decision-bar close are rejected.
- Warmup events are retained as context and flagged `withinRequestedRange=false`; they are not counted as discoveries inside the selected day.
- Replay IDs and event IDs are stable hashes tied to the instrument, timeframe, exact source revision, detector version, parameters and replay engine version.
- Replay runs and ordered events are persisted transactionally and scoped to the signed-in user. Repeating the same run is idempotent. A changed result under the same identity becomes a conflict; the original history is preserved.
- `POST /api/replay` accepts an exact local dataset ID, a UTC epoch-millisecond interval, warmup size and detector settings. `GET /api/replay` lists or retrieves saved runs.
- The workstation has a DAY REVIEW tab with dataset selection, UTC day selection, warmup bars, explicit REVIEW opt-in, M1 chart, retrospective event markers and the lifecycle/evidence timeline.
- The live opportunity panel reads the authenticated `GET /api/opportunities/live` endpoint and shows current cursor state, active setup, break/invalidation levels, last processed closed bar, tick age, worker heartbeat and recent events.
- The live opportunity processor keeps a durable cursor/watermark per instrument, side and detector configuration. Repeated snapshots do not duplicate bars/events. Changed historical bars and unclassified intervals stop the cursor in `GAP_UNRECONCILED`.
- Initial/reseed context is stored as `LIVE_BOOTSTRAP`; only transitions processed after the initial watermark are `LIVE_MONITOR`. Bootstrap events are explicitly not historical live alerts.

The first detector is `structure-break-retest` v1.0.0. It is an explicitly versioned research heuristic: confirmed swing, closed-bar structure break, close-based retest/arming, subsequent close trigger, invalidation or expiry. Its existence is not evidence of profitability, and a trigger is not a fill.


### 1.5 Forward live opportunity monitoring

- Prisma stores a durable `LiveOpportunityCursor` per exact instrument/provider/timeframe/price-side/detector configuration and append-only `LiveOpportunityEvent` rows.
- Each event includes a stable identity, sequence, setup identity, lifecycle type, direction, market occurrence/discovery timestamps, source bar fingerprint, source poll receive timestamp, provider tick timestamp, structured evidence, and origin.
- The forward processor uses the same pure detector as replay and receives a single closed candle at each step.
- The first up-to-64-bar contiguous context sample is labelled `LIVE_BOOTSTRAP`. Events generated from bars processed after the persisted watermark are labelled `LIVE_MONITOR`.
- If the last processed bar changes, a snapshot regresses, or a missing M1 interval is detected, the cursor enters `GAP_UNRECONCILED` and stops advancing. A manual `--reseed` begins a new cursor generation; it deliberately does not claim to reconstruct the missed active state.
- `LIVE_BOOTSTRAP` and `LIVE_MONITOR` events are stored separately from historical replay runs. No order, fill or position records are created.

**Remaining limitation:** the live worker first checks the monitor's recent closed-bar sample (up to 64 M1 bars). For a longer outage or gap it attempts recovery from a hash-verified PASS dataset for the same instrument/timeframe/price side, but will only resume if the stored watermark candle fingerprint matches and every following M1 candle through the latest live closed bar is present. This code path is covered by the shared processor's gap/fingerprint tests, but still requires local validation against actual imported BID/ASK archives and forced worker outages. Full replay/live event parity over golden days remains open.

## 2. What is not yet certified or complete

| Area | Actual status | What must happen before it can be called complete |
|---|---|---|
| Local start/status/stop | Implemented in code; CI tests included | Run on the user's Windows machine with a populated `.env`; verify clean start, status, stop and restart |
| Historical M1 data | Importer and verification pipeline implemented | Download bid and ask for both instruments; run verification and inspect every gap/anomaly |
| Higher timeframe data | Importer supports separate timeframes | Prefer reproducible aggregation from the certified M1 base; compare any separately imported candles |
| Dukascopy polling | Worker, supervisor and API implemented | Run on the user's network through active and closed-market periods; validate quote timestamps/provider availability |
| M1 chart live tail | Code path implemented | Verify actual chart movement, side match, forming/closed candle behavior and stale-feed recovery locally |
| Historical replay | Engine, detector, API, persistence and UI implemented | Run against real imported golden days and compare to manually annotated results |
| Automatic live opportunities | Worker, cursor/event persistence, supervisor integration, API and UI implemented; dataset-backed recovery code implemented but not locally certified | Verify live event times, recovery revision match and state transitions on real BID/ASK data; compare with replay |
| Unified replay/live lifecycle | Same detector code is used by replay and live; separate immutable replay and forward-live event stores with distinct origins | Add complete dataset-backed catch-up/reconciliation, then compare replay and live logs over real sessions |
| Risk sizing | Pure calculator exists; live instrument economics absent | Supply actual broker/venue specifications, costs, margin, account currency and independently cross-check |
| Browser E2E | Not implemented | Add Playwright coverage for auth, source switching, M1 chart, 1/2/4 layout, Day Review, live cursor state and stale/gap recovery |
| Golden-day acceptance | Test infrastructure partly present; real golden days not certified | Curate representative dates per instrument and complete repeatable day-review comparison |
| Paper OMS / live routing | Deliberately out of scope | Do not enable until separate approval, validated risk, execution simulator and operational certification |

## 3. Local environment setup

### 3.1 Prepare the machine

From the repository root:

```powershell
bun install --frozen-lockfile
Copy-Item .env.example .env
```

Edit `.env`:

```dotenv
DATABASE_URL=file:../db/ami.db
NEXTAUTH_SECRET=<a unique random secret of at least 32 characters>
NEXTAUTH_URL=http://127.0.0.1:3000
```

The repository's `.env.example` uses the portable SQLite path above. Keep `.env` private. Do not commit market archives, provider credentials or local database files.

### 3.2 Download and import M1 history

The recommended download command requests both bid and ask by default and imports them as separate revisions. Start with a limited UTC range, verify it, then expand coverage.

```powershell
bun run market-data:download -- --instrument XAUUSD-DUKA --timeframe m1 --from 2026-11-01 --to 2026-11-08
bun run market-data:download -- --instrument NAS100-DUKA --timeframe m1 --from 2026-11-01 --to 2026-11-08
bun run market-data:inspect -- list
```

The `--to` date is exclusive. The commands above are examples; select dates that you actually intend to review. Each import produces separate BID and ASK revisions and prints exact dataset IDs. Do not reconstruct those IDs manually.

If a revision is marked REVIEW, inspect its diagnostics first. To verify a REVIEW revision explicitly:

```powershell
bun run market-data:inspect -- verify <exact-dataset-id> --allow-review
```

A REVIEW opt-in is for exploratory viewing/replay only; it does not turn a questionable dataset into a certified feed. Consult [Market Data Operations](12_MARKET_DATA_OPERATIONS.md) for the complete importer and diagnostics contract.

### 3.3 Start the workstation

```powershell
bun run local:station -- start
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The first run may need you to create/sign in to a local account.

Useful operational commands, in another terminal:

```powershell
bun run local:station -- status
bun run local:station -- stop
```

The supervisor launches two M1 pollers and four live opportunity workers (BID and ASK for XAUUSD-DUKA and NAS100-DUKA). It checks the persisted cursor every five seconds, but it only transitions setups on newly closed bars from a fresh polling snapshot. The monitor is separate from the historical downloader. If the provider cannot return a current tick, the feed state will show NO_TICK/STALE/ERROR and live detector processing will pause.

If a live cursor enters `GAP_UNRECONCILED`, AMI will not skip the missing bars. The worker is currently fail-closed: stop the supervisor, inspect/download and verify the exact missing interval, then deliberately reseed that specific instrument/side cursor from a fresh snapshot only if you accept that the prior active state cannot be reconstructed by the current poll-snapshot worker:

```powershell
bun run local:station -- stop
bun run scripts/market-data/live-opportunity-worker.ts --instrument XAUUSD-DUKA --price-side bid --poll-seconds 5 --reseed --once
bun run local:station -- start
```

Repeat for the affected cursor only. Reseeding increments its cursor generation, retains its prior event history, and labels new seed events `LIVE_BOOTSTRAP`. It does not certify or repair the missing interval. Dataset-backed automatic catch-up/reconciliation remains a next-stage requirement.

### 3.4 Use the charts and Day Review

1. Open DESK. In a chart slot, select the exact local dataset revision from the dataset selector. For M1, choose the M1 timeframe/local revision.
2. Use BID history with the BID polling tail or ASK history with the ASK polling tail. AMI will not cross-pair them.
3. A recent same-side M1 revision can receive the recent poller candle tail when feed health is FRESH. The live tick and spread are shown separately.
4. Open DAY REVIEW. Select the instrument/side M1 revision, select a UTC calendar day, choose warmup bars and scan.
5. Review FORMING, ARMED, TRIGGERED, INVALIDATED and EXPIRED transitions. Warmup-context events are marked separately. All events are retrospective replay output, not messages that were actually delivered live during that historical period.

## 4. Conventions and source constraints

- All internal event and candle timestamps are UTC epoch milliseconds.
- Day Review currently selects a UTC calendar date. It does not claim that UTC midnight is the trading-day boundary or that a market session is open.
- Session classification remains unknown until a versioned instrument-specific calendar, DST rules, holiday rules and maintenance breaks are supplied and tested.
- XAUUSD-DUKA is an OTC spot metal price series. NAS100-DUKA is an index CFD series. Neither is interchangeable with COMEX GC or CME NQ futures.
- Dukascopy is one provider/venue. Its quote is not a market-wide consensus or proof that a particular broker would have the same executable prices.
- Provider-reported/CFD volume is not consolidated centralized exchange traded volume.
- Bid and ask candles remain separate. A bid-only or ask-only series is sufficient for selected quote-side research but not for cost-aware executable P&L.
- Instrument contract size, tick value, point value, min/step/max size, margin, commission, swap/financing, account currency conversion and broker-specific stop rules are unverified for this user's actual venue. The risk engine must remain fail-closed for these instruments.

## 5. Next implementation sequence

### Stage A — Local and feed certification

1. Run the new local launcher on the user's actual Windows installation.
2. Confirm the Next.js app, SQLite DB, supervisor and both poller children each produce correct PID/heartbeat state.
3. Confirm supervisor restart behavior after one worker is deliberately stopped; confirm retry exhaustion requires manual intervention.
4. Download a real M1 bid+ask sample for each target instrument.
5. Run import verification, inspect row counts, duplicate timestamps, zero-range bars, outliers and every missing interval. Classify gaps using a calendar only after the calendar is sourced.
6. Compare importer results to an independent source or a manually inspected platform export for selected dates.

### Stage B — Market data normalization and replay acceptance

1. Make M1 the canonical base series for the observation pipeline. Create deterministic M5/M15/H1 aggregations from M1 using explicit bar-open/close boundary rules.
2. Add aggregation identities/property tests (M5 high=max of constituent M1 highs, low=min, open=first, close=last, volume=sum only when volume semantics permit).
3. Build 5–10 real golden review days per instrument: trend, range/chop, high-volatility/news, provider gap, weekend/holiday reopen, and DST transition examples.
4. Manually annotate the first 2–3 setups and define the event rules; compare replay output against those reference annotations.
5. Run deterministic replay twice and compare byte-for-byte output; run chronological one-bar mode versus batch replay and prove identical event sequences.
6. Add replay fixtures for both long and short patterns, CHoCH/BOS, pre-window warmup, invalidation, expiry, missing bars and corrected dataset revisions.

### Stage C — Automatic live opportunities

1. Introduce a single setup/event contract shared by replay and live processing. Add an explicit origin: HISTORICAL_REPLAY or LIVE_MONITOR.
2. Create one worker per instrument/timeframe/price-side/detector configuration. It consumes only newly closed, quality-accepted bars.
3. Persist a durable watermark with source revision/sequence and last processed candle close. On restart, backfill from the last committed watermark before returning to live mode.
4. Process each bar exactly once. Use an idempotency key built from instrument, timeframe, quote side, source revision, bar close, detector version and event key.
5. Commit event transitions and watermark atomically. Do not advance the watermark when event persistence fails.
6. Reconcile live output with replay over the same stored session after a monitor disconnect. A mismatch is a visible integrity incident, not silently overwritten history.
7. Keep historical events visually distinct from genuinely live events. Live alerts should carry first-observed wall time, provider event time, quote freshness, evidence and invalidation.

### Stage D — Risk and research integrity

1. Add an instrument economics registry keyed by exact broker/venue and symbol, with source URL, verification timestamp and reviewer.
2. Refuse sizing if any required contract field, FX conversion, account currency or freshness check is missing.
3. Round quantity down to legal size increments; expose arithmetic, spread, commission, slippage and financing assumptions.
4. Cross-check at least 10 broker-calculator examples per instrument and add property tests that risk never exceeds the requested amount.
5. Keep the replay output separate from a backtest. Do not call a setup trigger a fill or use chart midpoints to estimate executable P&L.

### Stage E — Browser, operational and release certification

1. Add Playwright authenticated fixtures for 1/2/4 chart layouts, local/provider switching, M1 dataset selection, live-tail merge, stale state, review opt-in and Day Review.
2. Test empty/corrupt dataset manifests, provider timeouts, worker death, retry exhaustion, restart catch-up, duplicate poller processes and SQLite lock handling.
3. Capture a reproducible environment report: code SHA, lockfile hash, SQLite schema, imported revision IDs, data hashes, detector versions and active poller configuration.
4. Complete at least 10 consecutive real sessions per instrument without unexplained data/replay/live discrepancies before calling the observation MVP accepted.
5. Paper trading, portfolio accounting and order routing remain later separate work; they are not unlocked by a green chart or replay test.

## 6. Definition of ready for local live observation

AMI is ready for local observation only when the user can:

- start and stop the app and monitor with one command;
- open a certified local XAUUSD and NAS100 M1 dataset;
- see a recent same-side polling tail only while the feed is fresh;
- see stale/no-tick/error state and the last quote timestamp;
- replay an earlier UTC day and review every setup transition with exact source revision and detector provenance;
- restart AMI and reproduce the same historical event log;
- see a current live setup only after the automatic live worker has consumed the corresponding newly closed bar and persisted its event;
- see risk marked unavailable until actual venue economics have been independently verified.

The branch now also includes the first live opportunity worker, persistent quote-side cursors, a live monitor panel and a verified-dataset recovery attempt. These additions are code-complete but still require real local/provider validation. The real-data, real-session, economics and Playwright acceptance gates remain open.
