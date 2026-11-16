# 04 — Unified workstation UI specification

## Design goal

A dark, information-dense but legible, single-screen quant workstation. The user should keep the market, metrics, strategy intelligence and system topology in view together. Primary navigation changes the active context or panel content; it should not repeatedly replace the entire workspace.

The visual reference is `prototype/index.html`. It is a product/layout prototype, not a binding visual implementation or live screenshot.

## Desktop information architecture

### Persistent frame

1. **Left rail:** compact navigation/context icons for Workspace, Markets, Strategies, Research, Intelligence, Portfolio and Settings. The rail stays visible and can expand to labels.
2. **Top command bar:** AMI identity, instrument search, workspace/layout selector, mode selector, feed/worker indicators, global emergency state and profile menu. No live-arm action.
3. **Market ribbon:** selected instrument, last canonical price/quote, change, source freshness, session state and data-quality badge. All values include source and timestamp.
4. **Center workspace:** resizable multi-chart canvas with 1/2/4/6 chart layouts, chart add/remove, instrument/timeframe selector, optional crosshair/time-range linking and chart-specific overlays.
5. **Right sidebar:** compact metrics and risk panel with portfolio/paper state, open paper positions, exposure, drawdown, net expectancy, PF, latency/freshness, strategy status and risk vetoes.
6. **Lower system/intelligence region:** topology graph plus strategy agreement/disagreement and research evidence. Can be collapsed or enlarged without navigation away.
7. **Bottom dock:** tabs for Events, Signals, Trade Plans, Paper Orders, Positions, Experiments and Logs. Dock height adjustable; tables sortable/filterable.

## Chart behavior

- Support 1, 2, 4 and 6 chart presets; future custom grids may extend this.
- Each chart has its own instrument, contract month, timeframe, display settings, overlays and data-source label.
- Optional group linking: time cursor, visible logical range, crosshair, instrument group or timeframe group. Linking is opt-in and clear.
- Candles, volume and optional order-flow panes should use separate series/panes as suitable.
- Every chart shows canonical provider, contract identity, last event time, receive age and quality state.
- A chart library is a renderer only. It does not own market truth, backtesting, strategy state or order execution.
- Missing/stale data creates a visible quality warning and must not be interpolated into a tradable price series.

## Right metrics sidebar

Groups:
- **Market:** last price, bid/ask, spread, session, realized volatility, volume and data age.
- **Paper portfolio:** simulated equity, realized/unrealized P&L, fees, open risk, gross/net exposure and drawdown.
- **Strategy health:** strategy version, sample size, expectancy, PF, OOS verdict, paper status and last run.
- **Risk:** daily loss budget, aggregate open risk, instrument limits, margin assumptions, kill-switch/permission state and latest vetoes.
- **System:** market feed, canonical store, feature worker, research workers, fusion, paper OMS and scheduler health.

Metrics must be sourced and timestamped. Do not show blank values as zero. Show `N/A`, `STALE`, `NOT_CALIBRATED`, `NOT_CONNECTED` or `NOT_VERIFIED` where appropriate.

## System topology graph

Provide three graph modes:

1. **Architecture:** static logical capabilities and declared edges.
2. **Runtime:** actual worker/adapter health, last heartbeat, latency, error counts and active/degraded/disabled states.
3. **Decision lineage:** selected proposal traced through market events, features, research outputs, fusion, strategy, risk and paper fill.

Graph nodes are clickable and open an inspection drawer with contract/version, health, dependencies, permissions, costs, last run, outputs and related evidence. Distinguish declared topology from observed runtime topology. A declared node is not proof of integration.

## Intelligence panel

Show per-engine output, input age, hypothesis, evidence IDs, model version, calibration status, conflicts and abstention reasons. Agreement counts must account for correlated sources; do not turn multiple summaries of the same data into false consensus.

## Bottom dock

- Events: ordered operational/market events.
- Signals: proposals and rejection reasons, not orders.
- Trade Plans: entry/stop/targets/net-R/expiry/risk status.
- Paper Orders: simulated OMS lifecycle and fills.
- Positions: simulated exposure, average price, fees and risk.
- Experiments: registration, run progress, metrics and verdict.
- Logs: structured diagnostics with safe redaction.

## Persistence and interaction

Persist user workspace layout, panel widths, selected chart symbols/timeframes and sidebar/dock preferences locally using the app's approved settings mechanism. Do not persist secrets or account data in browser state. Support reset-to-default and named workspaces after owner review.

## Responsive behavior

Desktop is the primary target. On narrow screens, use a compact chart-first view and collapsible metric/system drawers; never simply shrink six charts into illegible tiles. The mobile experience may use one chart plus swipeable metric panels.

## Accessibility and usability

- Keyboard shortcuts for layout switching, chart focus and dock tabs.
- Visible focus states, sufficient contrast and text labels in addition to color.
- Status indicators include text; green/red alone never communicates an execution permission.
- Use neutral visual styling for normal state; reserve strong warning treatment for stale data, risk veto, error or disabled execution.
