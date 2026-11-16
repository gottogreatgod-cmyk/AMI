# 10 — Open gates and owner decisions

This package recommends a direction. It does not authorize spending, provider activation, dependency-policy changes or live trading.

## Decisions to make during implementation, not assumptions

1. **Futures data provider:** evaluate Databento GLBX.MDP3 and any broker-provided alternative. Compare historical coverage, live entitlement, fees, data licensing, depth, latency, Windows support and commercial-use terms. No selection or purchase is made here.
2. **Broker/data gateway:** identify whether the intended paper workflow will use provider-only data, a broker demo feed, or a separate replay-only source. Keep credentials out of the repository.
3. **Contract universe:** start with MNQ and MGC; authorize NQ/GC after cost and margin/risk model review. Confirm desired contract months and session display conventions.
4. **Chart renderer:** assess whether to extend the current TradingView widget, adopt Lightweight Charts, or provide both (hosted external view plus canonical local chart canvas). Do not replace the current working Market View until parity is reviewed.
5. **Framework integration:** Qlib and VeighNa may be evaluated under MIT core repository licenses, but pinned versions/addons/dependencies still need audit. Freqtrade integration requires a policy decision because it is GPL-3.0 and AMI's existing guide excludes it.
6. **Research budget:** define model API/compute caps and local resource envelope before activating providers or downloading weights.
7. **Workspace persistence:** decide which view preferences are local user settings and which should sync to project data. Never store credentials in workspace state.
8. **Market session display:** choose default timezone presentation (exchange-local vs local user time) while preserving UTC event storage.
9. **Promotion policy:** preserve current ledger/owner approval requirements; do not use a UI status toggle to promote a strategy.
10. **Backup gate:** current AMI status reports backup/restore certification as `DEFERRED_NOT_VERIFIED`; do not conflate this handoff ZIP with an independent repository backup.

## Conditions requiring a stop on the affected work

- Unclear owner decision or conflicting canonical ledger entries.
- Unknown source license or incompatible transitive dependency.
- Provider cost or data-use terms not approved.
- Contract specs are stale, missing or conflicting.
- Incomplete data provenance, point-in-time integrity or sequence state.
- Resource gate below the existing 2 GiB free-disk minimum.
- Attempt to introduce live trading, broker credentials, holdout tuning or unreviewed automatic promotion.

Continue independent work that does not depend on the gated item.
