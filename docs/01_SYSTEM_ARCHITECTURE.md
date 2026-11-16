# 01 — System architecture

## Purpose

Unify everything the AMI handoff package (2026-11-15) described — workstation UX, futures expansion, strategy validation, research governance — into one running system with one engine and one source of truth per concern. This document describes the system **as implemented** in this repository, and explicitly marks what is real versus what is reference/provenance.

## Layer map (all inside the Next.js app — one process, one port)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ UI  src/app/page.tsx → components/workstation/*                          │
│     login gate · topbar · watchlist rail · DESK (multi-chart) ·          │
│     LAB (strategy desk / runs / leaderboard / run detail) ·              │
│     ANALYST (briefing feed / sessions / calendar / confluences) ·        │
│     right metrics sidebar · bottom dock (signals/runs/events/system) ·   │
│     sticky footer status bar                                             │
├──────────────────────────────────────────────────────────────────────────┤
│ API  src/app/api/*  (all auth-gated, JSON, same-origin)                  │
│     auth/[...nextauth] · markets · candles · strategies · runs ·         │
│     runs/[id] · campaigns · campaigns/[id] · leaderboard · signals ·     │
│     analyst · calendar · health                                          │
├──────────────────────────────────────────────────────────────────────────┤
│ ENGINE  src/lib/engine/*  (the only strategy evaluator)                  │
│     types.ts (contracts) · indicators.ts (causal) · backtest.ts ·        │
│     scoring.ts (PF / t-stat / split-sample / robustness) ·               │
│     review.ts (auto-review) · strategies.ts (starter registry) ·         │
│     runner.ts (orchestrator + live signal state)                         │
├──────────────────────────────────────────────────────────────────────────┤
│ DATA  src/lib/data/*                                                      │
│     instruments.ts (registry) · providers.ts (unified getBars) ·         │
│     binance.ts · yahoo.ts · resample.ts (causal HTF aggregation) ·       │
│     calendar.ts (ForexFactory feed) · cache.ts (TTL memory + limiter)    │
├──────────────────────────────────────────────────────────────────────────┤
│ ANALYST  src/lib/analyst.ts (deterministic confluence engine) ·          │
│          src/lib/briefing.ts (LLM desk briefing from that JSON)          │
├──────────────────────────────────────────────────────────────────────────┤
│ PERSISTENCE  Prisma + SQLite (db/custom.db)                              │
│     User · Strategy · Run · Campaign  (all scoped by userId)             │
└──────────────────────────────────────────────────────────────────────────┘
```

Campaigns execute in-process with bounded concurrency (3 parallel runs, shared data cache). There is no second engine, no side path: `executeRun()` in `engine/runner.ts` is the single route every backtest takes — API single runs, campaign sweeps, fork re-runs, and the research scripts all call it.

## Canonical data lineage

```
provider REST call → closed bars only → (causal HTF resample) → engine warmup →
signals on closed bars → next-open fills → costs → trades → metrics →
split-sample robustness → verdict → auto-review → persisted Run (SQLite) →
leaderboard / run detail UI
```

Every persisted Run stores: the strategy config used, symbol, timeframe, days window, engine version, full metrics + robustness + split, the trade list (capped at 1000), a downsampled mark-to-market equity curve, the auto-review, and the **data-quality record** of the exact bars that were consumed (provider, provider symbol, bar count, span, coverage status, resample source, gap count, fetch time).

## Engine invariants (enforced in code, not by convention)

1. **Signals fire on closed bars only.** Providers drop forming candles (close time in the future) before bars ever reach the engine.
2. **Fills happen at the next bar's open** — never on the signal bar's close.
3. **Within a bar, exits are checked in the order: liquidation → stop → target.** If both stop and target are touched in one bar, the stop wins (conservative).
4. **Fees + slippage are charged per side, both directions**, using per-instrument venue cost models.
5. **Stops are ATR-based; trailing stops only tighten**, and are recomputed from closed-bar data only.
6. **Liquidation is modelled against implied leverage**: liq move = `(1/leverage) × (1 − maintenance margin ratio)`. With risk sizing the cap rarely binds; with leverage sizing (the cautionary presets) the liquidation is inside the stop distance and ends the position.
7. **Higher-timeframe filters consume only HTF bars whose close time ≤ the decision bar's close time** (binary search, no peeking). Gapped series (forex weekends, futures breaks) are safe: an HTF bucket becomes available at its last constituent bar's close.
8. **One position at a time.** Opposite signals exit at the next open; no same-bar reversal fills.
9. **Account-blowout halt**: if equity falls to ≤ 2% of starting equity, further entries are refused (the account is dead — realistic for cross-margin wipeouts).
10. **Warmup is explicit**: a strategy may not signal before its indicator horizon is fully warmed (max of ATR period, entry lookback, EMA/Bollinger/RSI/momentum horizons, `warmupBars`). Insufficient history returns an explicit `INSUFFICIENT` verdict — never a squeezed sample.

## What is real now

Real, live, and wired end-to-end in this build:

- Public-exchange data: Binance spot REST (klines + 24h tickers) and Yahoo Finance chart API (NQ=F, GC=F, ^VIX, EURUSD=X, USDJPY=X), with pagination, retry/backoff, rate limiting, and in-memory TTL caching.
- Causal 45m/3h/4h aggregation from native 15m/1h bars, epoch-aligned buckets, availability at last-constituent close.
- The unified backtest engine with all invariants above; robustness scoring; split-sample check; auto-review with fork patches.
- Five starter strategies seeded per user on demand ("Add starter strategies").
- Campaigns: async, persisted, progress-polled, visible in the Lab with per-run verdict tiles; leaderboard ranked by robustness; the complete Phase 1 + Phase 2 research campaigns (see `08_RESEARCH_REPORT.md`) are stored in the demo account.
- Live signal states per strategy per market, evaluated on the newest closed bar by the same engine.
- The analyst: deterministic pulse/confluence/session/calendar computation from live bars + the ForexFactory feed, with an LLM desk briefing generated only from that JSON (deterministic fallback if the model is unreachable).
- Auth: credentials sign-in (scrypt hashes), JWT sessions, all data scoped by user.

Reference / provenance only (deliberately not live):

- MNQ/NQ/MGC/GC contract facts (multipliers, ticks) are seeded in `docs/02_DATA_PROVIDERS.md` from the handoff package; the app trades **continuous front-month research series** (NQ=F, GC=F), never dated contracts. Dated-contract resolution, roll handling, and a real CME data entitlement remain future work behind their own acceptance gates.
- Qlib/VeighNa/Freqtrade integration analysis from the handoff is preserved in `docs/09_OPERATIONS.md` (external frameworks); nothing from them is embedded.
- TradingView hosted widget path from the old repo is superseded here by lightweight-charts as a pure renderer of AMI-owned normalized bars.

## Modes and safety presentation

- Top bar always shows `MONITOR` (green) and `PAPER LOCKED` (amber). There is no live-arm control anywhere in the product, by design.
- Every chart shows provider, bar count, resample source, coverage status (`FULL`/`PARTIAL`/`PROVIDER_LIMIT`), and span.
- The sticky footer carries the standing disclaimer: simulation research only, no live orders, no broker connection.
