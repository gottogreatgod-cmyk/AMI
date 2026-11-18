# AMI — Market Observation & Opportunity Research Workstation

AMI is a local-first workstation for studying **XAU/USD spot quotes** and the **NAS100 index CFD**. The first release is an observation and historical-review system, not an autonomous trading bot.

The product goal is to answer:

1. What happened in the selected market window?
2. Which setups formed, and when could AMI first have known?
3. Which setups armed, triggered, invalidated or expired?
4. What is developing now, with what evidence and invalidation?
5. Is risk calculable from verified, venue-specific contract economics?

Historical replay and live monitoring are being built around the same deterministic, closed-bar detector contract. Each replay is linked to an exact immutable market-data revision, detector version and parameter hash. Events record market-time occurrence separately from discovery/confirmation time; the engine does not receive future bars.

## Current implementation

| Capability | Implemented behavior |
|---|---|
| Workstation | Multi-chart 1/2/4 layouts, public provider REST sources, local immutable datasets |
| Historical datasets | Dukascopy XAUUSD and NAS100 CFD import; separate BID/ASK revisions; importer v2 gap policy |
| M1 chart | Select exact local M1 revision; matching-side recent monitor candles can extend the chart only while feed health is FRESH |
| Monitor | Two instrument pollers, independent writer/tick freshness checks, heartbeat, bounded restart policy |
| Replay engine | One closed bar at a time, deterministic lifecycle events, warmup context, stable source/detector provenance |
| First detector | Versioned structure-break/retest research heuristic (BOS/CHoCH, FORMING, ARMED, TRIGGERED, INVALIDATED, EXPIRED) |
| Persistence | User-scoped replay runs and immutable ordered events; same-run idempotency and changed-output conflict detection |
| Day Review | Select exact M1 dataset and UTC day; render chart markers and setup evidence/timeline |
| Risk | Calculator infrastructure exists; XAUUSD-DUKA/NAS100-DUKA remain fail-closed until actual venue economics are verified |
| Execution | Broker order routing, fills and positions are disabled |

**Important status boundary:** this is code implementation, not certification of real market data. Real BID/ASK archives still need to be downloaded and inspected locally. Dukascopy's current-rate integration is experimental polling, not WebSocket streaming. The automatic live opportunity worker and browser E2E acceptance are still open stages. Do not interpret historical replay events as alerts that actually occurred live, or a trigger as a fill.

## Local setup

Requirements: Bun, a supported Node-compatible environment for Next.js, and Windows/Linux/macOS. Keep provider archives, local SQLite databases and secrets out of Git.

```powershell
bun install --frozen-lockfile
Copy-Item .env.example .env
```

Set these values in `.env`:

```dotenv
DATABASE_URL=file:../db/ami.db
NEXTAUTH_SECRET=<unique-random-secret-at-least-32-characters>
NEXTAUTH_URL=http://127.0.0.1:3000
```

Start the complete local observation environment:

```powershell
bun run local:station -- start
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). The runner synchronizes the local Prisma schema without the destructive `--accept-data-loss` flag, starts Next.js bound to loopback, and starts the two experimental M1 Dukascopy pollers.

In another terminal:

```powershell
bun run local:station -- status
bun run local:station -- stop
```

## Import local M1 history

The downloader requests both BID and ASK by default. They are saved as separate, immutable revisions. The end date is exclusive and dates are interpreted as UTC.

```powershell
bun run market-data:download -- --instrument XAUUSD-DUKA --timeframe m1 --from 2026-11-01 --to 2026-11-08
bun run market-data:download -- --instrument NAS100-DUKA --timeframe m1 --from 2026-11-01 --to 2026-11-08
bun run market-data:inspect -- list
```

Start with a manageable date range. Copy the exact dataset IDs printed by the importer; never reconstruct them manually. Importer v2 marks every missing expected M1 interval for review; it does not fill bars. PASS datasets are available under the normal chart/replay policy. REVIEW datasets require an explicit opt-in and are not certified by that opt-in.

Data is stored below `data/market-data/`, which is ignored by Git. See [Market Data Operations](docs/12_MARKET_DATA_OPERATIONS.md) for the downloader, importer, verifier and monitor contracts.

## Use the workstation

- **DESK:** select the exact local dataset revision in a chart slot. For the live polling tail, the chosen M1 history side must match the monitor side (BID→BID or ASK→ASK). A stale or unavailable monitor never replaces the verified history.
- **DAY REVIEW:** choose the M1 revision and a UTC calendar day, set the warmup count, and run the retrospective detector. The chart shows event markers; the timeline distinguishes warmup context from events discovered inside the selected day.
- **LAB / ANALYST:** existing research and analysis areas remain available, subject to their current data-use policies.

Current market/session calendars are not certified. Day Review therefore uses UTC calendar dates, not an inferred broker trading-day roll or Asia/London/New York session definition.

## Initial market identity and safety boundaries

- `XAUUSD-DUKA` is the Dukascopy OTC spot metal quote. It is not COMEX GC/MGC.
- `NAS100-DUKA` is the Dukascopy USA 100 Technical Index CFD. It is not CME NQ/MNQ.
- Dukascopy is one provider, not an executable-price guarantee for another broker.
- Bid and ask candles stay separate. The system does not fabricate midpoint OHLC.
- CFD/provider volume is not consolidated exchange traded volume.
- Actual contract size, tick/point value, quantity increments, margin, fees, financing, account currency and conversion rates remain unverified for the user's venue; risk sizing must refuse to guess.
- No broker orders, fills or positions are created.

## Implementation and validation documents

- [Implementation status and local runbook](docs/15_IMPLEMENTATION_STATUS_AND_LOCAL_RUNBOOK.md)
- [Market conventions and golden-day registry](docs/16_MARKET_CONVENTIONS_AND_GOLDEN_DAYS.md)
- [End-to-end local monitoring and opportunity plan](docs/14_LOCAL_LIVE_OPPORTUNITY_COMPLETION_PLAN.md)
- [Market-data operations](docs/12_MARKET_DATA_OPERATIONS.md)
- [Next implementation execution brief](docs/13_NEXT_IMPLEMENTATION_EXECUTION_BRIEF.md)

## Engineering checks

The CI workflow covers formatting/lint, strict TypeScript, Bun tests, the Python importer tests, CLI smoke checks and production build. A green CI run proves the repository test/build contract for that commit; it does not prove a real Dukascopy download, local Windows service, complete trading session, profitability or broker execution.

For the next stage order and acceptance criteria, use [Implementation Status and Local Runbook](docs/15_IMPLEMENTATION_STATUS_AND_LOCAL_RUNBOOK.md).