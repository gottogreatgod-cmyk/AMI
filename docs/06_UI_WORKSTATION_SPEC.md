# 06 — Workstation UI specification

A single persistent dark screen. Navigation changes context, never the workspace. Mode is always visible: `MONITOR` (green) and `PAPER LOCKED` (amber) in the top bar; the sticky footer carries the standing disclaimer. Nothing anywhere arms, routes, or connects to a broker.

## Frame

```
┌────────────────────────────────────────────────────────────────────────────┐
│ TOPBAR   AMI · MONITOR · PAPER LOCKED · engine chip · feeds · clocks · user│
├────────────────────────────────────────────────────────────────────────────┤
│ TOOLBAR  [DESK] [LAB] [ANALYST]            FOCUS chip · market counts      │
├──────────┬──────────────────────────────────────────────┬──────────────────┤
│ WATCH-   │  center panel (tab-dependent)                 │ METRICS &        │
│ LIST     │  DESK  → 1/2/4 candlestick grid               │ RESEARCH sidebar │
│ rail     │  LAB   → desk/run/leaderboard/detail          │ (focused market, │
│ (15 mkt) │  ANALYST → briefing + boards                  │ engine signals,  │
│          │                                              │ top runs, next   │
│          │                                              │ high-impact)     │
├──────────┴──────────────────────────────────────────────┴──────────────────┤
│ DOCK  [SIGNALS] [RUNS] [EVENTS] [SYSTEM]                  (collapsible)    │
├────────────────────────────────────────────────────────────────────────────┤
│ FOOTER — simulation research only · no live orders · data sources          │
└────────────────────────────────────────────────────────────────────────────┘
```

- **Watchlist rail** (≥lg): all 15 markets grouped CRYPTO 24/7 / FUTURES·INDEX / FOREX, live price + 24h change, session dot (green 24/7, amber sessioned, gray stale), filter box, click to focus (drives sidebar, signals, dock). On mobile it becomes a slide-over sheet. The footer of the rail states the research honesty notes (continuous futures, cost model).
- **Right sidebar** (≥xl): focused market card (price, change, session chip, freshness), engine signals for the focused market (per strategy: bias badge, tf, ATR%, HTF gate state), top robust runs (top 6 leaderboard scores), next high-impact events with live countdowns.
- **Bottom dock**: SIGNALS (full signal table: bias, HTF gate, ATR%, RSI, Donchian bounds, as-of), RUNS (recent run history with verdicts — click opens the run in the Lab), EVENTS (the economic calendar feed), SYSTEM (engine version, DB, provider request/retry counters, cache, policy). Collapsible to a tab strip.
- **Footer**: sticky to the bottom of the viewport; on short content it holds the floor, on tall content it is pushed down naturally.

## DESK — chart canvas

- Layout presets **1 / 2 / 4**; each chart card independently selects any of the 15 symbols and 7 timeframes; clicking a card's title focuses that market everywhere.
- Renderer: lightweight-charts 5 (Apache-2.0) — a renderer only; it owns no market truth, no strategy state, no orders. Candles + volume histogram; UTC time axis; OHLC readout of the last closed bar.
- Every card footer shows **provider, closed-bar count, resample source, coverage status and span** (e.g. `BINANCE · 3200 closed bars · agg from 15m · PROVIDER_LIMIT · 60d`) — data honesty per chart, not per page.
- Only closed bars are ever drawn; forming candles are dropped upstream.

## LAB — research

Four views, segmented control:

1. **STRATEGY DESK** — rule-set cards (family chip, STARTER/FORK badge, config summary: entry + lookback · stop ×ATR · trail/target · cap · sizing mode · HTF gate, description, quick-test, delete for forks). The empty state is the product's front door: *"The desk is empty."* + **Add starter strategies** (five rule sets, including the 300× case, on purpose).
2. **RUN** — the sweep form (strategies × symbols × timeframes × window 30/100/180/365/1095d) → async campaign with live progress bar, verdict tiles per run as they land, final verdict counts and top-10; recent campaigns list.
3. **LEADERBOARD** — best run per strategy×market×tf ranked by robustness, with score bars, grades, PF/t-stat/net/DD, split notes, verdict badges; the legend states the ranking philosophy ("never by return alone").
4. **RUN DETAIL** — verdict header, robustness component mini-bars, metrics grid, split-sample halves panel, equity curve, full trade table with exit-reason badges, **auto-review** findings + up-to-4 suggestion cards each with **Fork & re-run** (fork → re-run same market/window → new detail with lineage breadcrumb), data-quality footer (provider, bars, coverage, resample, test window vs warmup, gaps).

## ANALYST — the live desk briefing

Grok-style: a continuously-renewing analysis feed plus structured boards (full spec in `07_ANALYST_SPEC.md`). Left: the markdown briefing from the analyst model (or the deterministic fallback, labeled). Right: session board + data-days strip, today/tomorrow calendar, next high-impact countdowns, US-focus week digest. Below: the confluence board (per-market bias/strength/vol-regime/event-risk cards, focused market first) and the market pulse table.

## State & persistence

- Workspace layout (active tab, focused symbol, chart slots) persists to `localStorage` and restores on reload. Nothing sensitive is stored client-side.
- All list data is polled (`markets` 30s, `health` 30s, `runs` 30s, `signals` 60s, `leaderboard` 90s, `analyst` 60s, `calendar` 5min) with visible staleness states — a failed feed shows RETRYING/STALE, never stale numbers pretending to be live.

## Responsiveness

Desktop-first (the workstation frame above); below `lg` the watchlist becomes a sheet, below `xl` the sidebar hides (dock + panels carry the data), charts collapse to a single column, boards stack. Numeric cells use tabular figures; long tables scroll in place with thin dark scrollbars (`ami-scroll`).

## Accessibility

Semantic landmarks (`header/main/aside/section/footer`), `aria-pressed` on toggles, `aria-label`s on icon buttons, focus-visible rings, status communicated with text + color (never color alone), 44px-class touch targets on mobile controls.
