# 09 — Operations, environment, and honest limitations

## Running

- `bun run dev` — Next.js dev server on port 3000 (the only externally visible route; everything lives on `/`).
- `bun run lint` — ESLint.
- `bun run db:push` / `db:generate` — Prisma schema → SQLite at `db/custom.db`.
- Environment (`.env`): `DATABASE_URL` (SQLite path), `NEXTAUTH_SECRET`, `NEXTAUTH_URL`. No exchange keys, no paid providers — everything reads public feeds.

## Research scripts (`scripts/`)

| Script | Purpose |
|---|---|
| `smoke.ts` | Engine sanity: starter #1 on BTC 1d + the 300× cautionary case on 15m |
| `smoke-analyst.ts` | Analyst pipeline: context build + LLM briefing |
| `research.ts phase1` | 100-day monitor sweep — all 5 strategies × 15 markets × 7 TFs (525 runs) → `docs/research-data-phase1.json` |
| `research-45m-fix.ts` | 45m re-run slice (kept as the record of the Binance 45m aggregation fix) |
| `research.ts phase2` | 3-year deep rerun of qualifying strategies → `docs/research-data-phase2.json` |

Scripts run against the same engine, providers, and database as the app — there is no separate test harness that could disagree with production code. The demo account (`demo@ami.local`) owns the campaign history so every result is reviewable in the UI.

## Data-source register

| Source | Use | Key needed |
|---|---|---|
| Binance Spot REST (`api.binance.com`, failover hosts) | klines (paginated ≤1000/req), 24h tickers | none |
| Yahoo Finance chart API (`query1.finance.yahoo.com`) | NQ=F, GC=F, ^VIX, EURUSD=X, USDJPY=X OHLC | none |
| ForexFactory JSON (`nfs.faireconomy.media/ff_calendar_thisweek.json`) | economic calendar | none |
| z-ai-web-dev-sdk (backend only) | analyst desk briefing | sandbox-provided |

## Honest limitations (read before trusting any number)

1. **Paper simulation only.** No broker, no order routing, no live arming anywhere in the system. Results are research findings about historical data.
2. **Continuous futures are research constructs.** NQ=F / GC=F are front-month continuous series with roll gaps; they are not dated contracts. Real futures research requires the contract master (expiry, first-notice, roll calendar, no-look-ahead roll selection) per the handoff's WP20–22 gates. MNQ/NQ/MGC/GC contract facts seeded in the docs come from the handoff package and must be re-verified against the exchange before any operational use.
3. **Provider intraday caps.** Yahoo 15m ≈ 60 days, 1h ≈ 730 days; Binance allows deep pagination (30k default, 130k extended). Shortfall is surfaced (`PROVIDER_LIMIT`), never hidden.
4. **Session/weekend boundaries are UTC approximations** (DST ±1h) for the session board; bar timestamps themselves are exact.
5. **Cost models are conservative estimates**, not venue-confirmed schedules; crypto models Binance spot taker fees, futures/FX model spread+commission in bps of notional.
6. **Liquidation model is approximate**: liq move = (1/lev) × (1 − MMR), plus a 5 bps buster penalty; it ignores tiered maintenance margins and insurance funds. It is deliberately pessimistic in ordering (liquidation checked before stop).
7. **The LLM briefing is generated text over deterministic data.** The model is instructed to use only the provided JSON, but it is still a language model — treat its prose as a digest, and the JSON/context as the source of truth. The deterministic fallback proves the product doesn't depend on it.
8. **Multiple-testing discipline is partial.** Campaigns count every trial and preserve losers, but there is no formal deflated-Sharpe / White's reality-check correction; the split-sample check is the anti-curve-fitting mechanism. Treat borderline results (score 40–60) as hypotheses, not edges.
9. **One-position-at-a-time, no pyramiding, next-open fills only** — a deliberate simplification. It underestimates strategies that scale into positions and slightly delays exits vs. intrabar-capable engines; both biases are conservative for research honesty but are biases.
10. **Dev-server lifetime = campaign lifetime.** Campaigns run in-process; a server restart mid-campaign leaves it RUNNING (resume is a future feature — re-run instead).

## External frameworks (handoff disposition, not embedded)

- **Qlib (MIT)** — candidate isolated ML research worker behind its own gates; not installed here.
- **VeighNa (MIT core, per-addon licenses)** — event-driven futures architecture reference; selectively evaluated, not embedded.
- **Freqtrade (GPL-3.0)** — excluded from embedding under the permissive-only policy; external conceptual reference only.
- **TradingView Lightweight Charts (Apache-2.0)** — adopted as the chart renderer with attribution; it renders AMI-owned bars and owns nothing else.
- Papers-with-backtest catalogs — hypothesis discovery inputs; each candidate needs per-paper provenance and replication.
