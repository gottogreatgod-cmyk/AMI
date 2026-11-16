# 05 — API specification

All endpoints are same-origin, session-gated (NextAuth JWT cookie), and return JSON. Unauthenticated calls get `401 {"error":"UNAUTHENTICATED"}`. Errors are honest: `400` with a message for bad input, `500` with the exception text.

## Auth

- `GET|POST /api/auth/[...nextauth]` — NextAuth v4 credentials flow (email + scrypt password hash, JWT sessions, 30-day max age). Demo account: `demo@ami.local` / `ami-demo-2026`.
- `GET /api/auth/session` — standard session payload.

## Markets & data

### `GET /api/markets` (cached 30s)
Live board for the watchlist + coverage matrix.
```ts
{
  markets: Array<{
    symbol, name, assetClass, venue, provider, decimals, session,
    note?: string, costBpsPerSide, mmr,
    price: number|null, changePct: number|null,
    high24h, low24h, quoteVolume: number|null,
    fresh: boolean,
    coverage: Record<Timeframe, { maxDays: number; note: string; source?: Timeframe }>
  }>,
  providers: { binance: {...}, yahoo: {...} },
  fetchedAt: number
}
```

### `GET /api/candles?symbol=&tf=&limit=&days=`
Closed bars for charts. `limit ≤ 2000`, `days ≤ 400`.
```ts
{ symbol, tf, bars: Bar[], quality: DataQuality }   // Bar = { t,o,h,l,c,v,ct } ms epoch UTC
```

### `GET /api/health` (cached ~30s)
`{ engineVersion, db: "OK"|"ERROR", providers, cache, providersDirect, time }`

## Strategies

### `GET /api/strategies`
`{ strategies: Array<{ id, key, name, description, family, isStarter, parentKey, version, config, createdAt, updatedAt }>, starterCount }`

### `POST /api/strategies`
```ts
{ action: "seed-starters" }                            // → { created, skipped }
{ action: "create", config: StrategyConfig }           // → { id, key } (validated)
{ action: "fork", key, patch?, name? }                 // → { id, key, config }
{ action: "delete", key }                              // → { deleted } (starters protected)
```
`patch` may include `timeframe`, `risk` (partial), `exit` (partial), `htf`. Fork lineage: `parentKey`, `version+1`, generated name suffix describing the change.

## Runs

### `POST /api/runs` — single synchronous backtest
```ts
// request
{ strategyKey: string, symbol: string, tf?: Timeframe, days?: number (10..1200, default 100), startingEquity?: number }
// response — the full result payload
{ runId, symbol, tf, engineVersion, metrics: RunMetrics, split, robustness, verdict,
  equity: [{t,eq}], trades: Trade[] (≤1000 stored), review: AutoReview,
  dataQuality, diagnosticsSummary, fromTs, toTs }
```

### `GET /api/runs?limit=` — recent runs (light rows)
`{ runs: Array<{ id, symbol, tf, status, strategyKey, strategyName, family, daysRequested, barsTested, createdAt, campaignId, trades?, profitFactor?, tStat?, netReturnPct?, maxDrawdownPct?, verdict?, robustnessScore?, robustnessGrade? }> }`

### `GET /api/runs/{id}` — full run detail
Everything stored: strategy (with config), metrics + robustness + split, trades, equity, review, dataQuality. `DELETE /api/runs/{id}` removes it.

## Campaigns (the Lab)

### `POST /api/campaigns` — start an async sweep
```ts
// request
{ label?: string, strategyKeys: string[] (≤8), symbols: string[] (≤15), tfs: string[], days?: number (10..1200) }
// → { campaignId }
```
Runs in-process with concurrency 3 and shared data caching; ≥1000-day campaigns automatically use the extended 130k-bar budget.

### `GET /api/campaigns` — list recent
`{ campaigns: Array<{ id, label, status, total, done, failed, days, symbols, tfs, summary?, createdAt, finishedAt }> }`

### `GET /api/campaigns/{id}` — progress + results (poll every 2.5s while RUNNING)
Adds `runs: Array<{ id, symbol, tf, status, trades, profitFactor, tStat, netReturnPct, maxDrawdownPct, verdict, robustnessScore, robustnessGrade }>`. `summary` (when DONE): verdict counts + top-10 by score.

## Leaderboard

### `GET /api/leaderboard`
`{ leaderboard: Array<{...}>, generatedAt }` — best run per strategy×symbol×tf, ranked by robustness score (max 60 rows). Each row: `id, strategyKey, strategyName, family, symbol, tf, trades, pf, tStat, netReturnPct, maxDrawdownPct, expectancyR, winRate, verdict, score, grade, splitNote, days, createdAt, liquidations, costDragPct`.

## Signals (live desk)

### `GET /api/signals?symbol=`
`{ symbol, states: Array<{ ...SignalState, strategyId, isStarter }>, generatedAt }` — the user's strategies evaluated on the newest closed bar for that market (bias, HTF gate state, ATR%, RSI, Donchian bounds, as-of). Cached 60s.

## Analyst

### `GET /api/analyst?tz={minutes}` (cached ~5min, poll 60s)
The full desk-briefing context: `pulses[]` (15 markets: price, change, RV14, vol regime, 1w/1d/4h trend votes, trendScore, ATR%, Donchian-20 bounds), `confluences[]` (bias, strength, event risk with per-currency relevance, VIX backdrop, notes, implication), `sessions` (board + 7-day data-days), `calendar` (today/tomorrow/this-week/next-high-impact/USD-focus digests), `signals[]` (engine states), `briefing` (markdown), `llm: { used, latencyMs, note }`. `tz` is the client's local offset in minutes for calendar grouping.

### `GET /api/calendar?tz={minutes}`
Raw economic calendar events for the current week (ForexFactory feed), each with `localTs` adjusted for display.
