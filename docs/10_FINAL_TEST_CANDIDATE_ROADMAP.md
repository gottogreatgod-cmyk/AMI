# 10 — Final Test Candidate roadmap: live market monitor and trade opportunity engine

**Status:** planned release work, not yet implemented unless explicitly marked complete below.  
**Baseline:** branch `ami/repair-p0-chart-and-signal-integrity`, following the chart/refresh/HTF integrity repair.  
**Release principle:** AMI remains a research and paper-trading workstation. No live broker connection or live order routing is part of this release candidate.

---

## 1. What AMI already does — and what it does not

The current application is a useful research workstation, but it should not be described as a real-time execution-grade platform yet.

| Capability | Current implementation | Release decision |
|---|---|---|
| Multi-chart desk | 1 / 2 / 4 Lightweight Charts panels | Retain and extend |
| Candle display | REST `/api/candles`; closed candles; chart panel polling | Add a streaming current candle without changing the closed-bar research contract |
| Market quotes | Binance 24h ticker REST and Yahoo quote snapshots; server cache | Add provider timestamps, latency and explicit freshness states |
| Crypto live feed | Binance REST adapters | Add a WebSocket market-data adapter |
| Futures | Yahoo `NQ=F` and `GC=F` continuous series | Research-only until dated-contract data and roll handling are implemented |
| Gold proxy | `PAXGUSDT` spot-backed token | Label as a proxy, never as COMEX Gold |
| Strategy signals | Current state from the newest closed bar for saved strategies | Retain as one input to a richer setup/candidate lifecycle |
| Analyst | Deterministic closed-bar confluence, calendar and LLM summary | Keep deterministic JSON as the source of truth |
| Trade calculations | Backtest position sizing and exits exist inside the simulator | Expose a separate, validated live trade-plan calculator |
| Opportunity lifecycle | No persisted candidate/watch/trigger/expiry model yet | Implement |
| Paper positions / ledger | No persistent forward-test OMS/ledger model yet | Implement |
| Research validation | PF, trade t-stat, split-half, drawdown and liquidation gates | Expand; current PASS is not a release certification |

**Important current limitations:**
- Desk charts are refreshed through REST polling (currently once per minute), not a continuous price stream.
- Market snapshots are separately cached; a successful API response does not by itself establish a fresh quote.
- The current signal API returns strategy bias and indicators; it does not provide a complete entry zone, stop, targets, contract quantity, estimated loss/profit or margin calculation.
- The existing NQ=F / GC=F symbols are continuous Yahoo Finance research series, not dated CME/COMEX contracts.
- Existing research verdicts are screening labels, not proof of a persistent or profitable edge.

The P0 repair makes refresh and chart state more reliable and makes configured higher-timeframe gates fail closed. It does not, by itself, create streaming market data or complete opportunity calculations.

---

## 2. Release stages and acceptance gates

### Stage 0 — Stabilize the current repair (P0)

**Work**
1. Run a real dependency install, lint, TypeScript check and production build on the repair branch.
2. Re-enable TypeScript build failures after existing errors are resolved; `next.config.ts` currently contains `typescript.ignoreBuildErrors: true`.
3. Add automated tests for the six changed files and the engine invariants listed in Stage 1.
4. Exercise chart symbol/timeframe changes, empty responses, API errors, manual refresh, tab visibility changes and unmount/cleanup.
5. Fix every critical/high finding before merging the repair PR.

**Acceptance**
- Lint, TypeScript, build and tests all pass in CI.
- No stale symbol data remains visible after a symbol switch or failed/empty response.
- A refresh causes a new request; hidden tabs do not create duplicate poll loops.
- Missing or insufficient configured HTF data produces no entries and no live directional signal.
- Main remains protected by branch review and required checks.

### Stage 1 — Automated validation and reproducible builds

**Unit tests**
- Indicators: EMA, ATR, RSI, Bollinger, Donchian, ADX and edge cases at warmup boundaries.
- Bar normalization: invalid OHLC, non-finite values, duplicate timestamps, unsorted input and zero/negative prices.
- Resampling: no look-ahead, correct open/high/low/close/volume aggregation, incomplete buckets, gaps and session boundaries.
- Entry parity: the same closed-bar input/config produces the same signal in the backtest engine and live signal evaluator for every entry family and direction.
- HTF causality: no HTF bar whose close is after the decision timestamp can affect a signal; a missing/short filter fails closed.
- Execution model: next-bar-open fills, stop-before-target ordering, gap-through stops/targets, liquidation ordering, both-side fees/slippage and one-position-at-a-time behavior.
- Sizing: risk budget, instrument multiplier, tick/lot rounding, leverage cap and minimum size.

**Integration tests**
- Auth/session enforcement on all market, signal, run and opportunity endpoints.
- Provider timeout, throttling, malformed payload, empty history, stale quote and partial history behavior.
- Cache expiry/invalidation and provider provenance.
- Campaign interruption/restart behavior and duplicate-run prevention.
- Persistence round-trip for strategy config, dataset/run provenance and paper ledger.

**Browser/e2e tests**
- 1/2/4 chart layouts; chart resize; changing symbols/timeframes; crosshair and marker rendering.
- WebSocket disconnect/reconnect and stale-feed banners (once streaming is implemented).
- Creating, suppressing, triggering, invalidating and expiring an opportunity.
- User changes risk/equity inputs and sees every trade-plan value update.
- No UI action can place a live broker order.

**CI checks**
- Frozen dependency install.
- Prisma client generation and safe test database setup.
- ESLint, `tsc --noEmit`, unit/integration tests and production build.
- Dependency/security/license audit and secret scan.
- No workflow is allowed to deploy or enable live execution implicitly.

### Stage 2 — Reliable market-data plane

Introduce a provider-neutral interface, with separate adapters for historical bars, quotes and streaming trades:

```ts
interface MarketDataProvider {
  getHistoricalBars(request: HistoryRequest): Promise<BarsResult>;
  getQuote(symbol: string): Promise<QuoteSnapshot>;
  subscribeTrades(
    symbols: string[],
    onTrade: (trade: NormalizedTrade) => void,
    onStatus: (status: FeedStatus) => void
  ): () => void;
}
```

**Required properties**
- Provider timestamp, receive timestamp, source name, instrument identifier and sequence/trade ID where available.
- WebSocket heartbeat, reconnect with bounded backoff/jitter, resubscription and orderly shutdown.
- Gap/duplicate detection, out-of-order event handling, backpressure and bounded in-memory queues.
- Per-instrument freshness thresholds and explicit `LIVE`, `DELAYED`, `STALE`, `DISCONNECTED` and `CLOSED` states.
- Historical REST backfill after reconnect so the chart does not silently skip a market-data interval.
- A canonical UTC clock and timestamp policy shared by charting, indicators, opportunity evaluation and paper simulation.
- Provider/rate-limit/latency diagnostics visible in the System panel.

**Provider selection is a release decision, not an assumption.**
- Crypto can use an approved exchange WebSocket feed (the current Binance spot adapter is not a futures feed).
- NQ/MNQ and GC/MGC need a properly entitled CME/COMEX data source for operational-grade quotes and history. The current Yahoo continuous symbols may remain explicitly labelled research proxies.
- FX and VIX require a provider decision, with coverage, redistribution rights, delay, rate limits and price documented.
- Do not label public/delayed snapshots as exchange real-time data.

### Stage 3 — Live chart workstation

The desk should preserve the historical closed candles and render a separate **forming/live candle**.

**Chart behavior**
- Seed from normalized historical closed bars.
- Update the current bar from streaming trade/quote events using the chart library's incremental update API.
- On interval close, finalize the candle exactly once and append it to the immutable closed-bar series.
- Reconcile the finalized candle with the provider's historical REST bar; surface discrepancies.
- Render last price, bid/ask or spread where provided, volume, forming-bar countdown, provider time and feed age.
- Overlay strategy signals, opportunity trigger/entry zone, stop/invalidation and targets.
- Add market-structure overlays: prior day/week/month high/low, session high/low, opening range, VWAP, swing structure, supply/demand zones and zone invalidation.
- Every overlay must show the timeframe/source and be generated from data available at that timestamp; no future pivots or repainting.

**Desk layout**
- Keep the existing 1/2/4 multi-chart canvas.
- Add synchronized crosshair/time navigation and optional same-symbol multi-timeframe layout.
- Keep watchlist and current market context.
- Use the right-hand research rail for active opportunities and trade-plan calculations.
- Keep events, runs, feed health and paper positions in the bottom dock.
- On mobile, prioritize the focused chart and a compact opportunity/risk summary.

**Acceptance**
- A streaming update moves the last-price line/forming candle without waiting for a full history fetch.
- Closed candles never repaint after finalization; reconnect backfill reconciles missed data.
- The UI clearly distinguishes a live tick, a forming candle, a closed candle and a delayed snapshot.
- Stale/disconnected data suppresses new triggered opportunities and is visibly explained.

### Stage 4 — Explainable opportunity and trade-plan engine

The system should present **conditional setups**, not claim to know the future. Each candidate describes what would need to happen next, what invalidates it and how the proposed risk/reward is calculated.

**Candidate lifecycle**
1. `WATCH` — market is approaching a defined setup; no trigger has fired.
2. `NEAR_TRIGGER` — price is inside a configured pre-trigger distance/zone.
3. `TRIGGERED` — a causal, defined condition has been met using confirmed data.
4. `INVALIDATED` — the invalidation level or structural condition has been breached.
5. `EXPIRED` — time/session/event conditions make the setup no longer valid.
6. `SUPPRESSED` — feed is stale, data quality is insufficient, HTF gate is unavailable, event/risk policy blocks the setup, or calculations cannot be trusted.

Never silently convert missing information into a trade. Store the state transitions and reasons.

**Opportunity card — required fields**
- Instrument, venue/contract, strategy/version and timeframe.
- Direction and setup type; status and status timestamp.
- Evidence: entry rule, HTF state, trend/volatility regime, structure/levels, volume/liquidity context and event risk.
- Trigger condition and proposed entry zone/trigger price.
- Invalidation/stop level and the reason it is placed there.
- Target 1 / Target 2, reward-to-risk at each target and assumptions.
- Account equity/currency and user-selected risk budget.
- Proposed quantity/contracts/lots, tick-rounded entry/stop/targets, estimated fees, spread and slippage.
- Estimated loss at stop, estimated net reward at each target, notional, leverage and margin requirement where the provider has verified contract specifications.
- Data source, source timestamp, receive timestamp, data age and quality.
- Reasons for disagreement between strategy, HTF, market structure and event filters.
- Expiry, duplicate/cooldown key and complete audit trail.

**Calculation contract**
- Risk budget: `account_equity × risk_fraction`.
- For a linear futures contract: `per_contract_stop_risk = abs(entry - stop) × point_value + estimated round-trip costs`.
- Preliminary contract quantity: `floor(risk_budget / per_contract_stop_risk)`, then constrain by user leverage cap, available margin, max notional and contract minimum/increment.
- Estimated net target reward: directional price move × point value × quantity, less estimated round-trip fees, spread and slippage.
- Report R multiple as estimated net target reward divided by estimated stop loss; show gross and net figures separately.
- Round prices to the verified instrument tick size and size to its minimum increment. If contract specs/costs are unverified, show an indicative calculation only and suppress a trade-ready plan.
- Stress the stop risk for gaps/slippage; a stop price is not a guaranteed fill.
- For spot/FX, use instrument-specific units, lot sizes and conversion rates. Never reuse the futures multiplier or assume all instruments are linear.

**Risk controls**
- User sets account equity, base currency, risk per trade, max daily loss, max total open risk, max exposure per market/asset class, max leverage and allowed sessions.
- Apply portfolio-level correlation/concentration limits and event blackouts before presenting a candidate as eligible.
- Display both the requested risk and the actual rounded risk after contract/lot rounding.
- If the minimum tradable unit exceeds the risk budget, the result is `NO TRADE — minimum size exceeds risk limit`.
- Each opportunity is a proposal for user review. Paper acknowledgement is separate from the setup trigger. No live order is sent.

**Ranking**
- Rank candidates by transparent evidence/quality factors (data freshness, rule completion, HTF agreement, structural clarity, risk feasibility and historical robustness).
- Do not call a score a probability.
- Probabilities/expected values may only be displayed after calibration on genuinely untouched out-of-sample data and ongoing calibration monitoring. Until then, show deterministic conditions and scenario calculations, not win odds.

### Stage 5 — Research integrity and strategy validation

Before calling a strategy a validated candidate:
- Pin strategy config/version, engine version, provider, dataset revision/hash, contract mapping, timezone/session calendar, cost model and all run parameters.
- Use chronological train/validation/locked-test splits; do not tune on the locked test.
- Add rolling walk-forward evaluation and cross-market/regime checks.
- Test parameter neighborhoods, not just the best parameter; report the plateau and instability.
- Stress fees, spread, slippage, gaps, partial fills and latency assumptions.
- Use block/bootstrap methods for dependent trade returns; report uncertainty intervals.
- Account for multiple strategy/parameter trials (for example, deflated Sharpe / probability of backtest overfitting or a suitable reality-check procedure).
- Separate discovery, selection, holdout and forward paper results.
- Use instrument-specific futures contract data and point values; continuous-series roll gaps must never be mistaken for executable fills.
- Keep every failed experiment. A result cannot be deleted because it loses.

**Verdict policy**
- Rename current `PASS` to a screening label such as `RESEARCH_CANDIDATE` until all validation gates pass.
- `INSUFFICIENT` must remain a distinct state and must never appear green.
- Minimum trade counts and statistical thresholds must be set before the experiment, not after seeing results.
- A high PF on a small sample, a high t-stat under unrealistic assumptions, or an in-sample win is not release approval.

### Stage 6 — Forward paper trading

Implement a paper-only order and position ledger driven by the same market-data event stream.

**Minimum simulation behavior**
- Market/limit/stop order intent; accepted/rejected/cancelled/expired states.
- Bid/ask spread, fees, slippage, gap-through stops, partial fills and latency assumptions.
- Position average price, open risk, realized/unrealized P&L, margin use, exposure and trade lifecycle.
- Daily loss lockout, max concurrent exposure, strategy cooldown and event/session restrictions.
- Restart recovery and append-only audit records.
- Compare actual forward paper fills/outcomes with the backtest model and record model deviations.

**Acceptance**
- Every paper position can be traced to an opportunity, strategy version and input dataset.
- Restart does not erase pending paper intents, positions or risk state.
- Kill/disable control prevents new paper entries while preserving position monitoring.
- The system can run in monitor-only mode without creating a paper position.

### Stage 7 — Final Test Candidate and release sign-off

A release candidate is ready only when all of the following are true:

- Required CI gates are green on a clean checkout.
- No open critical/high security, data-integrity, causality, sizing or order-simulation defects.
- Provider entitlement, delay, freshness and contract-spec provenance are documented.
- Live chart, disconnect/reconnect, stale suppression and opportunity lifecycle e2e tests pass.
- Trade-plan calculations pass deterministic test vectors for crypto, FX and each supported futures contract.
- Historical runs are reproducible from pinned configs/data/costs and all research limitations appear in the UI.
- Paper forward-test results are reported separately from backtests and meet preregistered sample/duration gates.
- Backups, schema migration, restart recovery, logs, alerts, rollback and deployment checks are rehearsed.
- No live broker or live order route is enabled.
- Release notes list verified capabilities, known limitations, providers and data licensing.

---

## 3. Required screens at final test candidate

**Desk**
- Multi-chart grid with streaming price/forming candle, closed bars, volume, crosshair and market-structure overlays.
- Per-chart feed state, source timestamp and stale-age indicator.
- Opportunity trigger/entry/invalidation/target markers.

**Opportunity rail**
- Ranked WATCH / NEAR_TRIGGER / TRIGGERED candidates.
- A compact evidence explanation and contradiction list.
- Entry zone, stop, targets, net R:R and expiry.
- Expandable risk calculator with account equity, risk fraction, quantity/contracts, gross/net loss/reward, costs, leverage and margin.
- Suppression explanation when the setup cannot be safely calculated.

**Bottom dock**
- Signals and opportunity state transitions.
- Paper positions/orders and risk exposure.
- Event/calendar windows.
- Provider health, latency, stale feeds, cache and worker status.
- Research runs and walk-forward/holdout results.

---

## 4. Decisions to lock before building the operational feed and contract calculator

These are implementation inputs, not cosmetic choices:

1. **Primary instruments:** confirm whether the first real-time operational focus is NQ/MNQ and GC/MGC, with crypto secondary, or whether all current markets should be streamed in the first iteration.
2. **Market-data provider:** choose an entitled futures feed and FX feed; keep Yahoo continuous symbols labelled research-only until replaced.
3. **Capital and risk inputs:** make account equity, base currency, risk-per-trade and max drawdown user-configurable; do not hard-code a personal account size.
4. **Deployment runtime:** confirm the target host supports a long-running feed worker and streaming endpoint, or choose a separate worker/managed stream service.
5. **Paper test policy:** preregister minimum duration, minimum independent trade count, max simulated drawdown and risk limits before forward testing.

Until those inputs are locked, build the provider-neutral adapters and calculation contracts, but do not pretend an unselected feed or unverified contract specification is live/accurate.

---

## 5. Final product behavior

The intended workflow is:

```text
Live feeds → validated market state → charts and structure
           → strategy + HTF + event/risk confluence
           → conditional opportunity → transparent trade plan
           → user review → paper simulation → measured forward results
           → reproducible research report → release sign-off
```

The system's job is to continuously observe, explain, calculate, alert, simulate and learn from outcomes. The user's job is to decide whether a proposal fits their objectives and risk limits. The system must never imply certainty, hide missing data or convert an unvalidated research score into a promise of profit.
