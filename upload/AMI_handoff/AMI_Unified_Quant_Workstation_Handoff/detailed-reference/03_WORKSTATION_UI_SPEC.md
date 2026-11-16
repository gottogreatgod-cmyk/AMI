# 03 — Unified workstation UI specification

## 1. Core UX decision

Replace page/tab-first navigation as the primary interaction pattern with a persistent, resizable, multi-panel workstation. The user should be able to see charts, performance/risk metrics and the module topology together. Switching between MARKET, INTELLIGENCE and SYSTEM changes panel focus or the lower dock—not the entire application.

The provided `dashboard-prototype/index.html` is the visual direction and should be opened before implementation planning. It is a local concept using synthetic data, not a production UI and not a market feed.

## 2. Desktop layout

### Global top bar

- AMI identity and current workspace name.
- Mode indicator: `MONITOR`, `REPLAY` or `PAPER`.
- Global data health: `HEALTHY`, `DEGRADED`, `STALE`, `DISCONNECTED`.
- Instrument/command search.
- Workspace layout selector and save action.
- Alerts and emergency-state indicator.
- Live mode must not be shown as an available control unless a separately approved future stage authorizes it.

### Left watchlist rail

- Pinned instruments grouped by asset class.
- Contract-expiry label for dated futures.
- Market/session state and feed-health glyph.
- Select instrument to focus a chart or add it to a panel.
- Search and group management.

### Central chart canvas

- Supports 1, 2, 4 and 6-panel layouts; may support more on high-resolution displays after performance testing.
- Each chart has instrument, venue, product type, contract month, timeframe and data-source badges.
- Each chart supports independent symbol/timeframe, indicator overlays, volume and optional lower studies.
- Optional synchronized crosshair/time range; zoom synchronization is configurable.
- Shared drawing objects/levels are optional and must be scoped to instrument or linked group.
- Chart cards can be dragged, resized, maximized and moved.
- Chart data quality and delay are visible.
- A chart cannot be presented as live if it is delayed, stale, synthetic or fixture-based.

### Right metrics sidebar

Sections:
1. Portfolio snapshot: equity/capital basis, realized P&L, unrealized P&L, total fees and net P&L.
2. Risk: current drawdown, gross/net exposure, per-instrument exposure, risk per trade, daily loss usage and kill-switch state.
3. Strategy scorecard: expectancy R, profit factor, max drawdown, sample count, OOS status, paper status and active vetoes.
4. Market quality: source, last update, latency, spread, missing bars, sequence health and session status.
5. Selected instrument: tick size/value, multiplier, expiry, contract status and next session event.

Every value must have a tooltip or drill-down explaining calculation, data source, as-of timestamp and whether it is realized, unrealized, gross, net, historical, paper or simulated.

### Lower dock

Split or tab between:
- **Intelligence:** regime, strategy agreement/disagreement, forecast quantiles, calibration and evidence summaries.
- **System Map:** node graph for market sources -> data -> features -> engines -> fusion -> risk -> paper OMS -> reports.
- **Events:** proposals, rejected candidates, data-quality alerts, paper orders, partial fills, cancellations and service faults.
- **Research:** experiments, run comparisons, registered variants, validation status and failed hypotheses.

The topology and events dock should be visible alongside charts by default on a wide screen; users can resize or collapse it.

## 3. Three connected views

- **MARKET:** Chart area and watchlist foregrounded; metrics sidebar remains visible; lower dock defaults to trade plans and events.
- **INTELLIGENCE:** Strategy/model panels foregrounded; chart context remains available; lower dock shows evidence lineage and experiment comparisons.
- **SYSTEM:** Runtime topology foregrounded; chart context can remain pinned; lower dock shows module logs, dependencies, permissions and resource use.

## 4. System map interaction

Node categories: `SOURCE`, `ADAPTER`, `NORMALIZER`, `STORE`, `FEATURES`, `STRATEGY`, `MODEL`, `FUSION`, `RISK`, `OMS`, `LEDGER`, `UI`, `REPORT`.

Node status: `ONLINE`, `DEGRADED`, `STALE`, `DISABLED`, `NOT_CONFIGURED`, `BLOCKED`, `FAILED`, `FIXTURE_ONLY`.

Selecting a node opens an inspector with:
- ownership and responsibility;
- version/schema and capabilities;
- current status and reason;
- last heartbeat, successful run and latency;
- upstream/downstream dependencies;
- permission scope and whether it can mutate core state;
- latest errors and test evidence;
- recent inputs/outputs and lineage references.

Selecting an edge shows contract/schema version, direction, event freshness, validation state and last successful transfer.

## 5. Layout presets

- `Market 4-Up`: MNQ, MGC, BTC and selected watchlist instrument.
- `Futures Focus`: MNQ and MGC with 1m/5m/15m or user-selected timeframes.
- `Single Instrument`: one maximized chart plus full metrics.
- `Research`: charts + experiment comparison + strategy registry.
- `System Operations`: topology + event stream + module inspector.

Presets must be configurable, not hard-coded trading recommendations.

## 6. Interaction and accessibility

- Keyboard shortcuts for chart focus, layout toggle, symbol search, dock focus and panel collapse.
- Visible focus state, accessible labels, sufficient contrast and non-color-only status indicators.
- Responsive fallback: at narrower widths, sidebar becomes a drawer and charts stack; no core risk alert is hidden.
- Persist layout state locally or via existing AMI workspace persistence only after privacy/retention design is confirmed.
- Loading, empty, stale, error, unavailable and fixture states are distinct.

## 7. Charting implementation recommendation

Evaluate TradingView Lightweight Charts as the first candidate for a native multi-chart implementation. Its project is Apache-2.0 at the checked repository source and documents multiple panes. Confirm current API/version, attribution requirements, performance and integration fit before adoption. Do not confuse a public TradingView widget with AMI's canonical data feed; an embedded widget is display-only unless an authorized data adapter is built and validated.

## 8. Performance requirements

- Decouple chart rendering frequency from strategy/risk decision frequency.
- Batch visual updates and avoid rendering every raw tick in React state.
- Use worker/off-main-thread calculations only where necessary and resource-tested.
- Lazy-load inactive charts and bounded historical windows.
- Cap chart count based on observed machine resources.
- Preserve UI responsiveness when a Python research worker is busy or unavailable.
- No model call should block chart interaction or the risk service.

## 9. Acceptance criteria

- Four charts are visible at once on a desktop layout and can each change symbol/timeframe independently.
- Layout changes persist and restore correctly.
- Watchlist, right sidebar and lower topology/events dock are all reachable without route changes.
- Selecting a topology node reveals health/version/dependency/permissions.
- Data source and delay are visible on every chart.
- Synthetic fixtures are unmistakably labelled and cannot be confused with real data.
- No UI action can bypass AMI risk, create an order directly or unlock live trading.
- Empty, stale, disconnected and error states are tested.
