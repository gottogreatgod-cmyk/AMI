# 00 — Executive decisions

## Strategic direction

Evolve AMI into a **single-screen, multi-market quantitative research and trading workstation**. It should bring charts, risk/performance metrics, research engines, system topology, data health, trade plans and paper execution observability into one persistent workspace.

The target is not to maximize generated signals. The target is to discover and validate a small number of robust strategy edges, explain failure honestly, and make every decision reproducible.

## Decisions recommended

1. **Preserve AMI Core as the sole authority** for canonical instruments/data acceptance, strategy registration, risk authorization, position sizing, paper OMS, P&L and audit history.
2. **Replace tab-first navigation with a composable workstation**: persistent multi-chart canvas, right metrics sidebar, lower topology/event dock, compact global command bar and saved layouts.
3. **Evolve the existing Market View** rather than create a competing dashboard. The repository handoff says Market View currently shows a chart only after an explicit Load chart action; that view is display-only and not yet a data-ingestion, risk or execution source.
4. **Add true futures instruments** for CME E-mini and Micro E-mini Nasdaq-100 (`NQ`, `MNQ`) and COMEX Gold (`GC`, `MGC`) using dated contracts, contract metadata, expiry/roll policy and exchange calendars. Start research with MNQ and MGC before NQ and GC.
5. **Build a futures data/replay foundation before futures strategy evaluation.** Do not treat a CFD, spot gold symbol, ETF or generic index as a futures contract.
6. **Use external frameworks as isolated adapters or research references**, not as independent execution authorities.
7. **Do not embed Freqtrade code under the currently documented restrictive license policy without owner/legal approval.** Its repository is GPL-3.0; the AMI build notes state a narrower allowed-license policy. Treat Freqtrade as a research reference only unless the policy is formally revised.
8. **Prioritize strategy failure analysis.** Every strategy family receives consistent cost-aware metrics, regime breakdowns, sample-sufficiency checks and out-of-sample validation.
9. **Preserve losing and inconclusive strategies in the research ledger.** Do not delete a losing module or hide its results; freeze, annotate and retain the experiment lineage.
10. **Keep live execution disabled.** All new paths start in monitor, deterministic replay or paper simulation. External models and agents cannot authorize orders or alter risk limits.

## Priority order

- Parallel first steps: repository/worktree baseline refresh, strategy performance audit, workstation UX implementation plan.
- Then: dashboard shell, canonical instrument/futures data model, historical data adapter and deterministic replay.
- Then: futures strategy benchmarking and selected research-framework adapters.
- Finally: forward paper testing, independent review and owner promotion decisions.

## What success looks like

- One screen can show multiple charts and relevant metrics without navigating away.
- Every displayed metric has a source, timestamp, definition and status.
- Every chart is associated with a canonical instrument and explicit data provider.
- Every strategy proposal has a strategy ID/version/config hash and evidence lineage.
- Every rejected proposal exposes veto reasons.
- Every backtest records the data window, cost model, parameters, trial count and result hashes.
- Futures expiry, sessions, tick value, multiplier and costs are explicit and tested.
- No external engine can bypass the AMI risk gate or submit orders.
- The system never reports a strategy as profitable merely because software tests pass.
