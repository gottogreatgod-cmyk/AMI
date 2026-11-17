# AMI market-data import operations

## Status and scope

The first local historical-import path accepts CSV files produced by the Dukascopy dukascopy-node downloader and builds a normalized, immutable dataset revision with a SHA-256 manifest. It is an offline importer: it does not start a network download, does not activate a market feed in the workstation, and does not enable trading.

Supported primary identities:

| AMI ID | Provider instrument | Data class | Meaning |
|---|---|---|---|
| XAUUSD-DUKA | xauusd | OTC_SPOT_METAL | Dukascopy XAU/USD spot quote history |
| NAS100-DUKA | usatechidxusd | BROKER_CFD | Dukascopy USA 100 Technical Index CFD; not NQ futures |

Never feed these datasets into a calculator that assumes CME NQ/GC contract values. The import manifest keeps the provider instrument and data class attached to every dataset.

## 1. Download and import with one command

The recommended path uses AMI's downloader orchestrator. It pins dukascopy-node 1.51.1, requests UTC CSV candles with volume, uses the local cache, applies conservative batch pacing and retry limits, downloads bid and ask sequentially by default, and imports each side into a separate immutable dataset directory.

~~~bash
bun run market-data:download -- \
  --instrument XAUUSD-DUKA \
  --timeframe h1 \
  --from 2024-01-01 \
  --to 2024-02-01 \
  --price-side both \
  --volume-units units
~~~

Use NAS100-DUKA for the USA 100 Technical Index CFD. The command maps that AMI ID to Dukascopy instrument usatechidxusd. It does not map it to CME NQ. Choose a manageable date window first; start with H1/D1, then use M15/M5 when needed.

Options include --price-side bid or ask for one side, --include-flats to request zero-volume candles, --no-cache to disable the downloader cache, and --batch-size/--batch-pause-ms/--request-interval-ms to tune request pacing. The command never routes orders and does not activate an AMI chart provider. The downloader does not retry empty partitions: the provider omits zero-volume candles by default, so weekends and holidays may be legitimately empty. Those periods remain visible for gap classification instead of being retried or filled.

## 1.1 Manual source download (optional)

The pinned underlying CLI can also be run directly when you want to download a CSV separately. It writes into download/ by default; use -dir and -fn to choose the output directory and file name. For example:

~~~bash
bunx dukascopy-node@1.51.1 -i xauusd -from 2024-01-01 -to 2024-02-01 -t m15 -p bid -f csv -v -vu units -ch -r 3 -bp 1500
~~~

The documented CLI uses UTC epoch-millisecond candle timestamps. The end date is exclusive. Volume is omitted unless -v is specified; -vu selects its units. The supported timeframes include m1, m5, m15, m30, h1, h4 and d1.


The CSV format is `timestamp,open,high,low,close,volume`. Timestamps are UTC epoch milliseconds at the candle's start; the requested end date is exclusive. Repeat the command with `-p ask` to get the ask-side file. The importer keeps bid and ask as separate datasets; it never fabricates a midpoint from one side.

## 2. Normalize and fingerprint the CSV

Example:

~~~bash
bun run market-data:import -- \
  --instrument XAUUSD-DUKA \
  --timeframe m15 \
  --price-side bid \
  --from 2024-01-01 \
  --to 2024-02-01 \
  --volume-units units \
  --input download/xauusd-m15-bid-2024-01-01-2024-02-01.csv
~~~

For the NAS100-style CFD, use --instrument NAS100-DUKA, and only use the CSV downloaded from Dukascopy instrument usatechidxusd.

The importer writes one new directory under the ignored local path data/market-data/:

- source.csv — the unmodified source export;
- normalized.csv — sorted and deduplicated AMI bars with open and inclusive close timestamps;
- manifest.json — source identity, data class, quote side, UTC range, SHA-256 digests, importer version, quality diagnostics and data-use note.

Dataset IDs include the instrument, interval, requested date range, price side and normalized-data hash. A different source file therefore creates a different dataset revision rather than silently replacing prior research input.

## 3. Quality rules

The importer checks:

- finite numeric fields and UTC millisecond timestamps;
- positive OHLC prices and valid high/low envelopes;
- non-negative provider volume;
- timestamps inside the requested UTC date range;
- duplicate timestamps, sorted chronologically with the final source row winning;
- incomplete/current candles, which are removed using the current time or explicit --as-of;
- rough gaps larger than two source intervals.

A dataset with invalid rows is marked REJECTED and the command exits non-zero. Duplicate rows or rough gaps mark it REVIEW. Otherwise it is PASS.

Gap counts are deliberately labelled unclassified: weekends, maintenance breaks, holidays and provider omissions need instrument-specific calendars before a gap can be judged abnormal. The importer never fills gaps or invents synthetic bars. Provider-reported volume is preserved as metadata and must not be called consolidated exchange volume.

## 4. Catalogue and verify revisions

List local revisions without reading all candle files:

~~~bash
bun run market-data:inspect -- list
~~~

Verify one exact revision before using it:

~~~bash
bun run market-data:inspect -- verify xauusd-duka-h1-2024-01-01-2024-02-01-bid-<hashes>
~~~

The dataset ID is printed by the import command; copy it exactly rather than reconstructing it. A REVIEW revision is blocked by default. Exploratory verification requires an explicit opt-in:

~~~bash
bun run market-data:inspect -- verify <dataset-id> --allow-review
~~~

A REJECTED revision can never be loaded, even with that option. Verification checks the original source SHA-256, normalized CSV SHA-256, canonical provider and instrument class, quote side, time interval, row count, strictly increasing timestamps, close timestamps, UTC range, and OHLC/volume integrity. The catalogue reports manifest metadata, not a verified status; verification happens when a specific revision is loaded. The chart desk includes PASS-labelled revisions by default. Its REVIEW switch is off initially; turn it on only when you intend to inspect a revision with duplicates or unclassified gaps. The explicit selection sends allowReview=true to the candles endpoint, but the loader still verifies hashes, source replay, OHLC, timestamps and quality metadata.

The `verify` response also includes an operation policy:

- **Chart:** allowed for PASS revisions; REVIEW needs the explicit opt-in; REJECTED is never allowed.
- **Signal research:** allowed only under the same quality gate and is clearly identified as one-sided quote data.
- **Strategy backtest:** blocked for the current imports until a verified paired bid/ask dataset, instrument contract economics, and costs are available.
- **Paper execution and live order routing:** blocked. The paper OMS has not been certified and live routing remains disabled.

A visually valid chart is not evidence that the dataset can produce realistic fills or position sizes. Do not bypass the operation policy by manually supplying a side-only CSV to a backtest.

## 5. Authenticated API

The workstation backend also exposes the local catalogue to authenticated sessions:

- GET /api/market-data/datasets — list local revisions and their quality labels.
- GET /api/market-data/datasets/{datasetId}?limit=1000 — verify one exact revision and return the newest page of bars.
- GET /api/market-data/datasets/{datasetId}?limit=1000&beforeTs={epoch_ms} — return the preceding page; use the response page.nextBeforeTs as the next exclusive cursor.
- GET /api/candles?symbol=XAUUSD-DUKA&tf=1h&datasetId={id}&allowReview=true — chart an explicitly selected REVIEW revision. Omit allowReview for the default PASS-only policy.

The dataset endpoint validates the full files before returning any page, and it does not permit REVIEW or REJECTED data by default. It returns the downloaded quote side and recommended paired-mid method explicitly; a single bid/ask dataset is never silently labelled as mid-price.

An explicitly verified dataset can also be used as the source for the existing candles API without being registered as a live instrument:

~~~text
GET /api/candles?symbol=XAUUSD-DUKA&tf=1h&datasetId=<exact-dataset-id>&limit=1000
GET /api/candles?symbol=NAS100-DUKA&tf=15m&datasetId=<exact-dataset-id>&limit=1000
~~~

The symbol, supported timeframe and dataset ID must agree. The response includes the exact quote side and manifest hashes. The active market quote API and normal backtest provider remain unchanged; a historical dataset is not automatically a live feed or a cost-verified tradeable instrument.

## 6. Experimental current-rate monitor (optional)

The current-rate monitor is a separate process from the historical downloader and the workstation's normal chart provider. It uses the documented Node API `getRealTimeRates` from the pinned `dukascopy-node@1.51.1` package. The provider documentation marks this API experimental; treat it as a best-effort polling monitor, not a persistent WebSocket or exchange-grade stream.

Start one monitor per instrument in a terminal alongside AMI:

~~~bash
bun run market-data:monitor -- --instrument XAUUSD-DUKA --timeframe m1 --poll-seconds 60
bun run market-data:monitor -- --instrument NAS100-DUKA --timeframe m1 --poll-seconds 60
~~~

Use `Ctrl+C` to stop a monitor. A one-cycle diagnostic is also available:

~~~bash
bun run market-data:monitor -- --instrument XAUUSD-DUKA --timeframe m1 --once
~~~

The first run installs the exact `dukascopy-node@1.51.1` version in an isolated runtime under `data/market-data/.runtime/dukascopy-realtime/`; Bun creates a separate local lockfile there. This keeps the application's root `package.json` and `bun.lock` unchanged. The worker writes the most recent snapshot to `data/market-data/.monitor/{instrument}.latest.json`. These runtime files are local and ignored by Git.

The worker requests:
- the latest tick with bid and ask prices (and provider volumes where returned);
- the latest bid-side candles for the selected timeframe;
- the latest ask-side candles for the selected timeframe.

Bid and ask OHLC stay separate. The monitor does not fabricate a midpoint OHLC candle by averaging bid and ask highs/lows, and it does not treat provider volume as consolidated exchange volume. Forming candles are identified separately from closed candles using UTC interval close times.

Authenticated status endpoint:

~~~text
GET /api/market-data/monitor
~~~

The chart desk shows the monitor state and last bid/ask/spread when a worker is running. States are `FRESH`, `STALE`, `NO_TICK`, `ERROR` or `NOT_STARTED`. `NO_TICK` can mean a quiet/closed market or missing provider data; AMI does not infer a market calendar or relabel this as a confirmed closure. Errors preserve the last successful snapshot and mark it stale.

The monitor never submits orders, creates trade candidates, calculates position sizes, or makes these instruments active in the backtest engine. Before using any feed data in strategy logic, complete cadence/freshness, repeated-snapshot deduplication, disconnect/recovery, provider access/terms and instrument-calendar tests.

Provider reference: https://www.dukascopy-node.app/downloading-real-time-data

## 7. Chart structure and prior available UTC date levels

The chart desk offers two optional overlays:

- **STRUCTURE**: causal BOS/CHoCH markers from unique swing pivots. A pivot is not available until the configured right-side confirmation bars have closed; breaks are marked on the actual break candle.
- **PRIOR UTC**: dashed observed high/low lines from the nearest earlier UTC calendar date present in the selected closed-bar history.

The prior-date overlay is intentionally labelled as an *observed UTC-date range*, not a broker/exchange session high or low. It records the source date and number of observed bars. If the feed skipped dates (for example, weekends or missing provider partitions), it chooses the nearest earlier date with data and does not synthesize bars. This is a research/chart reference only; session-specific levels require a verified instrument calendar and provider coverage audit.

## 8. Keep the research chain reproducible

Keep downloaded files and normalized datasets local. data/market-data/ is ignored by Git. Commit the importer, tests, schemas and run references — not private market-data archives. Before sharing or redistributing source data, check the underlying data provider's terms. The downloader's MIT code licence is not a market-data redistribution licence.

The dataset is wired into the chart API and chart desk only, using an exact immutable dataset ID and hash/source verification. It is not yet wired into getBars() or the strategy/backtest runner. That integration remains a separate gate: it must retain dataset identity in every run and must not create executable fills or position sizes until paired bid/ask data, instrument contract economics and costs are verified.

## References

- https://www.dukascopy-node.app/quick-start
- https://www.dukascopy-node.app/output-formats
- https://www.dukascopy-node.app/config/node
- https://github.com/Tradelyy/dukascopy-tools

The downloader documentation states that its API uses publicly available Dukascopy data and that the tool is not affiliated with or endorsed by Dukascopy Bank SA. Its current docs identify version 1.51.1. Treat its real-time endpoint as a separate experimental monitor candidate, not as an exchange-grade stream.
