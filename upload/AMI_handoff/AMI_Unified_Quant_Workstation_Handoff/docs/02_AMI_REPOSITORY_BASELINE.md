# 02 — AMI repository baseline and preservation notes

## Evidence inspected

Repository: `https://github.com/genetac/AMI` (private; accessed through the connected GitHub integration). Default branch reported as `main`.

Files inspected:
- `AGENTS.md`
- `AMI_Full_Integration_Map_Agent_Master_Spec.md`
- `AMI_Overnight_Intelligence_Trading_Stack_Agent_Guide.md`
- `NotImplemented.txt`
- `docs/engineering/ami-agent-system/README.md`
- `docs/engineering/ami-agent-system/CURRENT_STATE.md`
- `docs/engineering/ami-agent-system/context/CURRENT_HANDOFF.md`
- `docs/engineering/AMI_MASTER_INTEGRATION_LEDGER.json`
- `docs/engineering/AMI_BLOCKERS_AND_OWNER_DECISIONS.md`
- `docs/engineering/ami-agent-system/work-packages/README.md`
- Recursive repository tree (`main`)

The exact source files and current worktree must be rechecked locally before implementation. This package is not a substitute for the repository's canonical ledger or the owner's live handoff.

## Latest handoff facts observed (2026-11-15)

The current handoff reports:
- Branch `main`; the referenced snapshot HEAD is `5bfeca11aaec947f04ba34f8779de88ed1935031`.
- Working tree is heavily modified/untracked: approximately 1,104 modified paths and 308 untracked paths (1,412 status entries) in the last recorded handoff. These counts are historical observations; recheck the actual tree before changes.
- No commit was made in that handoff.
- Repository suite reported 392/392 tests in 54 files.
- TypeScript typecheck passed; full ESLint passed; production build passed.
- The latest WP04/WP15 evidence reports the canonical store-to-overnight-run boundary and data-quality lineage improvements, plus shared execution exclusion and rejection of retrospective fixtures relabelled as paper simulation.
- `Stage 4`, `Stage 13` and `Stage 15` remain partial in the handoff; no stage is owner-accepted.
- Six local R08 fixes require independent recheck; full evidence-to-paper integration and fresh-context review remain open.
- Optional providers remain gated; broker/live mode remains disabled; locked holdouts remain locked; backup certification remains `DEFERRED_NOT_VERIFIED`.
- A new `Market View` tab (`#market-view`) was added on 2026-11-15. It displays a TradingView widget only after an explicit Load chart action and pairs it with the latest persisted AMI overnight reading and a gated data-source matrix. It is display-only: no ingestion, storage, fusion/risk input, broker or order path. The evidence reports focused tests 4/4 and the repository suite/typecheck/lint/build results above. TradingView availability/cookies are external; local/Binance/Coinbase feeds remain gated.

These statements are repository-reported evidence from the handoff, not a new independent execution by the author of this package.

## Existing implementation areas discovered in the tree

- `src/components/platform/`: platform tabs and dashboard UI components.
- `src/components/platform/market-view-tab.tsx`: market view surface (path present in tree; inspect locally before change).
- `src/lib/market-data/`: canonical contracts/store/replay, Kraken adapter, feed health and order-book handling.
- `src/lib/lab/`: fills, risk, metrics, experiment ledger, replay, splits, sweeps and trend research.
- `src/lib/overnight/`: orchestration, external research adapters, evidence/fusion, model workers, paper simulation, scheduler and reports.
- `src/lib/trade-plan/`: proposal and trade-plan lifecycle contracts/engine/store.
- `src/lib/structure/`: swing, liquidity, FVG and CRT-related structure calculations.
- `src/lib/research/`: registrations, queue and stage research.
- `src/app/api/`: market/lab/overnight/platform-related endpoints.
- `docs/engineering/ami-agent-system/work-packages/`: existing WP01–WP16 plus preservation work package records.

## Preservation rules before every slice

1. Read root `AGENTS.md` first.
2. Capture branch, HEAD, full status (`--untracked-files=all`), staged/unstaged diff stats and changed paths.
3. Inspect every target path, including untracked files. Treat pre-existing modifications as owner work.
4. Never reset, clean, stash, broadly restore, delete or overwrite pre-existing work.
5. Never read or expose `.env`, keys, tokens, private URLs or credentials.
6. Do not commit, push, deploy or publish without separate explicit owner authorization.
7. Keep at least 2 GiB free disk; measure RAM and disk before substantial installs or runs.
8. Do not introduce WSL or Docker; preserve Windows-native execution.
9. Stop at missing approval gates for providers, cost, licensing, backup or safety; continue independent authorized read-only tasks.
10. Update the canonical ledger, evidence index, changelog, handoff and relevant WP after material implementation.

## Important ambiguity to reconcile

The repository contains multiple generations of strategy/platform specifications, including `NotImplemented.txt` and the newer AMI integration map. Preserve their stage IDs and owner decisions. This handoff package is additive. It does not supersede AMI's master ledger or make a strategy promotion decision.
