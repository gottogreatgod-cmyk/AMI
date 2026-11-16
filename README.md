# AMI — Unified Quant Workstation

**Version 1.0.0 · November 2026 · Paper simulation research only — no live orders, ever.**

One persistent, dark, information-dense quant workstation that replaces page/tab-hopping:

- **15 live markets** — 10 crypto (BTC, ETH, SOL, BNB, XRP, DOGE, AVAX, LINK, SUI, PAXG gold) + E-mini Nasdaq-100 futures, gold futures, VIX, EUR/USD, USD/JPY — OHLC streamed per run from public exchange feeds (Binance spot, Yahoo Finance chart API). No datasets to download, no local storage of history.
- **7 timeframes** — 15m, 45m, 1h, 3h, 4h, 1d, 1w — with causal higher-timeframe aggregation for 3h/45m and every run backed by a higher-timeframe confluence gate.
- **One unified engine** — signals fire on closed bars, fills at the next bar's open, stop checked before target, fees and slippage both directions, ATR stops, and a liquidation model measured against your leverage.
- **Scoring deliberately not by return** — profit factor, t-statistic, trade count, drawdown, and a split-sample check that catches edges which only existed in one half of history.
- **Auto-review** — every run produces findings and up to four concrete changes; one click forks a new version and re-runs it, so each suggestion becomes a measured answer rather than an opinion.
- **Lab** — one rule set across many markets at once, live progress per market, stored runs, and a leaderboard ranked by robustness.
- **Analyst** — a Grok-style live desk briefing written from deterministic market data (trend votes, vol regimes, session board, data-days, economic calendar, per-market confluence) by the analyst model, renewing every 60 seconds.
- **Sign-in gated** — rule sets and runs are private, scoped to your account.

Sign in with the demo analyst (one click) or create an account. On the empty strategy desk, hit **"Add starter strategies"** to get the five starter rule sets — including the 300× case, on purpose.

## The one number

The 300× preset in the starter set is wiped out by its first 0.33% wick — at 300×, the liquidation distance `(1/300) × (1 − 0.5%)` is inside the noise of a single 15-minute candle, so the ATR stop never gets a chance to matter. When you size from the stop, the leverage cap never binds — it only shortens the wick that ends the position. Tested against real history, the configurations that survive are the slow ones. The full campaign evidence is in `docs/08_RESEARCH_REPORT.md`.

## Documentation

| Doc | Contents |
|---|---|
| `docs/01_SYSTEM_ARCHITECTURE.md` | Unified architecture, module map, data flow, engine invariants, what is real now |
| `docs/02_DATA_PROVIDERS.md` | Instrument registry, providers, coverage matrix, cost model, provenance |
| `docs/03_ENGINE_SPEC.md` | Backtest semantics, sizing & liquidation math, scoring, auto-review rules |
| `docs/04_STRATEGY_REGISTRY.md` | The five starter rule sets — full configs and rationale |
| `docs/05_API_SPEC.md` | Every endpoint with request/response contracts |
| `docs/06_UI_WORKSTATION_SPEC.md` | Layout, panels, modes, reading the screen |
| `docs/07_ANALYST_SPEC.md` | Confluence engine, session board, calendar digest, LLM briefing contract |
| `docs/08_RESEARCH_REPORT.md` | Campaign results: 100-day sweep + 3-year rerun, findings, recommendations |
| `docs/09_OPERATIONS.md` | Running, scripts, environment, honest limitations |

## Stack

Next.js 16 (App Router) · TypeScript 5 · Tailwind CSS 4 + shadcn/ui · Prisma (SQLite) · NextAuth v4 (credentials, JWT) · lightweight-charts 5 (Apache-2.0, chart renderer only) · recharts · z-ai-web-dev-sdk (backend only, analyst briefing) · Bun runtime.

## Non-negotiable invariants

1. Paper simulation only. No broker, no live order routing, no credentials, no live arming.
2. The engine is the only evaluator of strategies; charts render, they never trade.
3. Closed bars only; forming candles are dropped at the provider layer.
4. Fail visible: stale/missing data and provider caps are surfaced as `STALE` / `PROVIDER_LIMIT`, never silently interpolated.
5. Losing, rejected, and inconclusive runs are preserved with full history.
6. Nothing here is investment advice; profitability claims are research findings about historical data, not predictions.
