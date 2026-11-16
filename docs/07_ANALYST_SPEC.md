# 07 — Analyst specification (the Grok-style desk briefing)

The analyst answers, continuously and from live data: *what is the market doing, what news is coming up today/tomorrow/this week, what days does forex data actually show up, what is the US talking about, and what confluences — or absence of them — does that create for trading?*

Two layers, strictly ordered: a **deterministic confluence engine** computes everything from live closed bars and the economic calendar; the **LLM desk briefing** is then written *from that JSON and nothing else*. The model never invents numbers — every figure it cites is machine-computed. If the model is unreachable, a deterministic fallback briefing renders from the same JSON, clearly labeled.

## Deterministic layer (`src/lib/analyst.ts`)

### Market pulse (15 markets)
Per market from live closed bars: last price, 1d change, **14d realized volatility (annualized)**, vol regime (`ELEVATED` if RV14 > 1.3×RV90, `QUIET` if < 0.75×, else `NORMAL`), **trend votes** on three timeframes — 1w EMA(10>30), 1d EMA(50>200), 4h EMA(20>55) — and a weighted **trendScore** (1w ×1.5, 1d ×1.0, 4h ×0.5 ∈ [−3, +3]), 1d ATR%, Donchian-20 bounds.

### Session board & data days
- Sessions (UTC, DST-shifted ±1h, labeled approximate): Sydney 21–06, Tokyo 00–09, London 07–16, New York 12–21. Open/closed state + opens-in/closes-in countdowns.
- Forex open/closed with weekend boundary (Fri ~21:00 → Sun ~21:00 UTC); Globex open/closed incl. the daily 21:00–22:00 maintenance break; crypto 24/7.
- **Data-days strip**: the next 7 days, each marked whether FX and futures data shows up that day (weekends: crypto only; Sunday: reopen evening UTC) — the direct answer to "what days does forex data show up".

### Calendar digest (ForexFactory feed)
Grouped by the viewer's timezone into **today / tomorrow / this week**, plus **next high-impact** (countdowns) and the **US focus** digest: USD releases today/tomorrow/this week with high-impact callouts — "what US news is on this week".

### Confluence per market
```
bias/strength from trendScore:  ≥ +1.5 bullish (≥2.5 STRONG) · ≤ −1.5 bearish (≤−2.5 STRONG) · else neutral
event risk: high-impact events within 24h in relevant currencies
            (EURUSD → USD+EUR · USDJPY → USD+JPY · everything else → USD)
vol regime from RV14/RV90 · VIX backdrop for risk assets (≥22 risk-off · ≤14 complacent)
notes[]: the reasoning lines (trend votes, event risk, vol regime, VIX)
implication: one line of trading guidance
```
Implication logic is conservative: strong trend + high event risk ⇒ *stand aside through the release or halve risk*; no alignment ⇒ *range tactics or no position*; strong alignment + clean calendar ⇒ *with-trend, size from the stop*.

## LLM briefing layer (`src/lib/briefing.ts`)

- Input: a compact JSON projection of the deterministic context (pulse rows, next-48h events with forecast/previous, USD week digest, sessions/data-days, confluences, engine signal states).
- System prompt fixes the sections, the numeric discipline ("use ONLY the data provided"), the tone (direct, data-dense, zero fluff), and the single closing disclaimer line: *Simulation research from live public exchange data. Not investment advice.*
- Mandated sections: **Market pulse · Today & tomorrow — event risk · US focus — what's moving USD · FX sessions & data days · Confluence board · Desk notes** (actionable cautions: leverage around event windows, which markets lack confluence, weekend/rollover notes).
- Output is rendered as a markdown feed with an analyst identity block and refreshed on the 60s cycle; the header shows model status (`ANALYST MODEL · 6.2s` or `DETERMINISTIC FALLBACK` amber) and a live "refreshes in Xs" countdown.
- Backend-only via `z-ai-web-dev-sdk`, thinking disabled, with retry → fallback. The full payload is cached ~5 minutes server-side.

## Honest limits (surfaced in-product)

- Session hours and weekend boundaries are UTC approximations (DST shifts ±1h).
- The calendar feed covers the current week; "tomorrow" beyond the feed edge is not fabricated.
- Confluence bias/strength labels are **uncalibrated research states**, not probabilities — the spec forbids presenting them as odds.
- The engine signal strip is display-only research state; it places nothing.
