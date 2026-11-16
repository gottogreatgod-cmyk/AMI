# 09 — AMI repository baseline and preservation notes

## Repository inspected

- Repository: `genetac/AMI` (private GitHub repository accessed through the connected GitHub integration).
- Default branch reported by repository metadata: `main`.
- Repository operating rules: `AGENTS.md` at repository root.
- Important project documents: `AMI_Full_Integration_Map_Agent_Master_Spec.md`, `AMI_Overnight_Intelligence_Trading_Stack_Agent_Guide.md`, `NotImplemented.txt`, engineering ledgers and the `docs/engineering/ami-agent-system/` handoff system.

## Existing code areas identified

- `src/components/platform/`: existing platform/dashboard UI, including `platform-page.tsx`, `market-view-tab.tsx`, strategy/research/report tabs.
- `src/lib/market-data/`: canonical market-data layer, Kraken adapter/replay, book and feed-health logic.
- `src/lib/lab/`: strategy/backtest, fill model, metrics, risk and experiment logic.
- `src/lib/overnight/`: orchestration, fusion, paper and risk paths, external research/model adapters.
- `src/lib/trade-plan/`: plan contracts, engine and store.
- `src/lib/data/`: candles, CSV, aggregation and instrument data.
- `docs/engineering/ami-agent-system/`: handoffs, work packages, decision records and test evidence.

This is an observed tree map, not a full line-by-line source audit.

## Latest handoff facts inspected (15 November 2026)

The GitHub repository handoff `docs/engineering/ami-agent-system/context/CURRENT_HANDOFF.md` records:

- latest continuation is marked `PARTIAL`;
- repository test suite reported as 392/392 tests in 54 files;
- TypeScript check exit 0;
- full ESLint exit 0;
- production build passes;
- canonical store-to-overnight run persistence is locally integrated for the stated scope;
- service-wide execution exclusion/fixture mode has local evidence;
- a Market View tab (`#market-view`) is present and displays a TradingView chart only after explicit Load chart action;
- Market View is display-only and has no ingestion, storage, fusion/risk input, broker or order path;
- external TradingView availability/cookies remain external; local/Binance/Coinbase feeds are still gated;
- the repository is still heavily modified/untracked according to the handoff, with no commit reported;
- independent recheck, full evidence-to-paper integration, provider gates, live mode, holdout, backup certification and owner acceptance remain open/gated.

These are repository-recorded claims and were not rerun by preparing this ZIP. Verify current HEAD, worktree, tests and local server state immediately before implementation.

## Important preservation rules from AGENTS.md

- Read `AGENTS.md` first for every coding session.
- Work one bounded, dependency-ready slice at a time.
- Capture branch, HEAD, complete `git status --short --untracked-files=all`, staged/unstaged diff statistics and changed paths before and after.
- Treat all pre-existing modified and untracked files as owner work.
- Never reset, clean, stash, broadly restore, delete or overwrite existing work.
- Do not read/expose secrets, `.env` contents, tokens, keys or private endpoints.
- Keep the repository local; do not upload full repository/data to external services without explicit authorization.
- Do not commit, push, deploy, publish or release without separate owner authorization.
- Preserve at least 2 GiB free disk; measure RAM/disk before heavy installs/data pulls.
- Windows-native only; no WSL/Docker requirement under current operating constraints.
- Live trading is disabled. Keep `LIVE_MODE_LOCKED`; never submit real orders or connect a funded account.
- AMI Core alone authorizes risk and paper orders. External providers/models are advisory.
- Optional providers remain disabled until their specific gates are approved.
- Do not unlock holdouts or promote an inconclusive strategy without separate authorization and independent evidence.
- Backup/restore remains `DEFERRED_NOT_VERIFIED` until an authorized independent restore test.
- Update the authoritative master ledger, evidence index, stage changelog, knowledge-system build log, current state, work package and current handoff after each material slice.
- Use explicit statuses: `NOT_STARTED`, `BLOCKED`, `PARTIAL`, `IMPLEMENTED_UNVERIFIED`, `VERIFIED`, `ACCEPTED`, `DEFERRED_NOT_VERIFIED`, `REJECTED`.

## Current-source-of-truth rule

This handoff package is additive. It must not replace the AMI master ledger, work-package index, owner decision register, acceptance evidence index or current handoff. Before adding WP17+, reconcile IDs and dependencies with the current canonical ledger. If the ledger already uses WP17 or later, map this package to the available next ID instead of colliding.

## Recommended repository landing locations

After owner review, copy/adapt these documents into the existing engineering documentation structure. Prefer extending current authoritative files over creating competing ledgers. Place dashboard UI source in the existing platform UI components and keep prototype outside production runtime until it is deliberately implemented.
