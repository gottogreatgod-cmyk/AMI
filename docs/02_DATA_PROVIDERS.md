# 02 — Data providers, instrument registry, and provenance

## Design stance

Live OHLC is streamed **per run** from public exchange feeds. There are no datasets to download and no local storage of history — bars are fetched, cached briefly in memory, consumed by the engine, and described in a persisted data-quality record. If a provider caps history, the run says so (`PROVIDER_LIMIT`); if the exchange simply does not hold the requested span, the run says that instead (`PARTIAL`). Nothing is interpolated or silently truncated.

## Instrument registry (`src/lib/data/instruments.ts`)

| Symbol | Name | Asset class | Venue / provider | Session | Cost model (per side) | MMR |
|---|---|---|---|---|---|---|
| BTCUSDT | Bitcoin | crypto | Binance Spot | 24/7 | 4 bps fee + 2 bps slip | 0.5% |
| ETHUSDT | Ethereum | crypto | Binance Spot | 24/7 | 4 + 2 bps | 0.5% |
| SOLUSDT | Solana | crypto | Binance Spot | 24/7 | 4 + 3 bps | 0.5% |
| BNBUSDT | BNB | crypto | Binance Spot | 24/7 | 4 + 2 bps | 0.5% |
| XRPUSDT | XRP | crypto | Binance Spot | 24/7 | 4 + 3 bps | 0.5% |
| DOGEUSDT | Dogecoin | crypto | Binance Spot | 24/7 | 4 + 3 bps | 0.5% |
| AVAXUSDT | Avalanche | crypto | Binance Spot | 24/7 | 4 + 3 bps | 0.5% |
| LINKUSDT | Chainlink | crypto | Binance Spot | 24/7 | 4 + 3 bps | 0.5% |
| SUIUSDT | Sui | crypto | Binance Spot | 24/7 | 4 + 3 bps | 0.5% |
| PAXGUSDT | Gold (PAXG, 1 troy oz token) | crypto | Binance Spot | 24/7 | 4 + 3 bps | 0.5% |
| NQ=F | E-mini Nasdaq-100 (continuous) | futures | CME via Yahoo | Globex | 0.5 + 0.7 bps | 1% |
| GC=F | Gold futures (continuous) | futures | COMEX via Yahoo | Globex | 0.5 + 0.7 bps | 1% |
| ^VIX | CBOE VIX index | index | CBOE via Yahoo | index hours | 2 + 2 bps | 2% |
| EURUSD=X | EUR/USD spot | forex | FX via Yahoo | Mon–Fri | 0.6 + 0.6 bps | 0.5% |
| USDJPY=X | USD/JPY spot | forex | FX via Yahoo | Mon–Fri | 0.7 + 0.7 bps | 0.5% |

Notes:

- **Crypto costs** model Binance spot taker fees (0.04%/side, conservatively excluding BNB discounts) plus realistic taker slippage by liquidity tier (majors 2 bps, alts 3 bps). Round trip ≈ 12–14 bps — this is the cost drag that kills high-frequency 15m leverage presets.
- **Futures/FX costs** are conservative all-in per-side estimates of spread + commission in bps of notional (e.g. MNQ: 0.25pt spread ≈ $0.50 + ≈$0.62 commission on a $2×index notional ⇒ well under 1 bp; we charge 1.2 bps total to stay conservative).
- **PAXG** is a 1:1 troy-ounce gold-backed token — a 24/7 proxy for spot gold that lets the gold hypothesis be tested in both venues (PAXG 24/7 vs GC=F session-gapped).
- **NQ=F / GC=F are continuous front-month research series.** They are not dated tradable contracts. Contract facts from the handoff package, seeded for reference (verify against the exchange before any real use): MNQ = $2 × Nasdaq-100 index, 0.25pt tick = $0.50; NQ = $20 × index, tick $5.00; MGC = 10 oz, 0.10/oz tick = $1.00; GC = 100 oz, tick $10.00. Continuous series contain roll gaps; a dated-contract resolver (expiry, first-notice, roll calendar with no look-ahead) is a separate acceptance gate and is intentionally not faked here.
- **^VIX is an index** — included as a risk-regime input and research object, not a tradable product.

## Provider coverage matrix

| Timeframe | Binance (crypto) | Yahoo (futures/forex/index) |
|---|---|---|
| 15m | native | native, **≈ 60 days max** |
| 45m | aggregated from 15m (Binance has no 45m kline) | aggregated from 15m (60d cap) |
| 1h | native | native, **≈ 730 days max** |
| 3h | aggregated from 1h (causal) | aggregated from 1h (730d cap) |
| 4h | native | aggregated from 1h (730d cap) |
| 1d | native | native, deep history |
| 1w | native | native (weekly), deep history |

Bar budgets: default **30,000 bars per market** per fetch; the 3-year deep reruns use an explicit extended budget of **130,000 bars** (3y of 15m ≈ 105k bars). Higher timeframes need only a fraction.

These caps are surfaced, not hidden: a 3-year 15m run on EUR/USD returns `PROVIDER_LIMIT` with a note ("Yahoo 15m intraday cap ≈ 60 days"), and the run proceeds over the 60 days that exist — the verdict explains that the sample is short.

## Causal resampling (`src/lib/data/resample.ts`)

- Buckets are **epoch-aligned** (`floor(openTime / bucketMs)`), so 45m buckets run 00:00→00:45→01:30… and 3h buckets 00:00→03:00→06:00 UTC, matching how exchanges would align them.
- A higher-timeframe bucket becomes **available at the close time of its last constituent bar**, never at its wall-clock end. On gapped series (FX weekend, futures maintenance), a Friday 3h bucket that only ever received 2 hours closes with the 2nd hour's data — nothing from Monday leaks into it.
- Gap detection counts consecutive-bar spacing > 2× the TF; the count is stored in the run's data-quality record.

## Fetching discipline

- **Only closed bars.** Binance klines with `closeTime > now` are dropped; Yahoo's final forming candle is dropped.
- Pagination: Binance klines 1000/request with `startTime` cursor; retries with backoff on 429/418; multi-host failover (`api.binance.com`, `api1.binance.com`, `data-api.binance.vision`).
- Concurrency limiters: Binance 6 in flight, Yahoo 3, with retries. The 24h ticker board uses one batched `ticker/24hr` call for all 10 crypto symbols.
- **In-memory TTL cache** keyed by `symbol|tf|days|maxBars` (60s for ≤2d windows, 300s up to 400d, 900s for deep history). Campaign sweeps over N strategies on the same market reuse one dataset — that is why 525-run Phase 1 completes in ~2.5 minutes.

## Economic calendar

ForexFactory weekly JSON feed (`ff_calendar_thisweek.json`, public, no key): title, currency, exact timestamp with offset, impact (High/Medium/Low), forecast, previous. Cached 10 minutes. Used by the analyst's event-risk and US-focus computations. The feed covers the current calendar week; "tomorrow" beyond the feed edge is simply not fabricated.

## Data-quality record (stored on every Run)

```ts
{
  provider, providerSymbol, bars, fromTs, toTs,
  requestedDays, coveredDays, testWindowDays, warmupDaysConsumed,
  coverage: "FULL" | "PARTIAL" | "PROVIDER_LIMIT" | "INSUFFICIENT",
  session, resampledFrom, gapsDetected, fetchedAt, note,
  htfQuality: <same record for the HTF gate series, when configured>
}
```

Warmup transparency: a run requested for the last 100 days fetches 100 days **plus** the strategy's warmup horizon in that timeframe, and the record separates `testWindowDays` (what was scored) from `coveredDays` (what was fetched).
