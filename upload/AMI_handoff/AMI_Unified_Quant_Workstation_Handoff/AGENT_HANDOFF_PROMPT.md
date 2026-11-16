# Coding-agent handoff prompt — AMI Unified Quant Workstation

You are working in the owner's private AMI repository `genetac/AMI`. This package is the product/architecture brief, not permission to rewrite the repository or bypass its existing governance.

## First actions (read-only)

1. Read `AGENTS.md` first.
2. Read `docs/engineering/ami-agent-system/README.md`, `CURRENT_STATE.md`, `context/CURRENT_HANDOFF.md`, the current master integration ledger (Markdown and JSON), the owner decision/blocker register, current work-package index, current UI implementation and related test evidence.
3. Record branch, HEAD, `git status --short --untracked-files=all`, staged/unstaged diff stats, changed paths, free disk and available RAM. Compare against current records; do not assume the 2026-11-15 snapshot is unchanged.
4. Inspect current `#market-view` implementation and its 2026-11-15 evidence. It already contains an explicitly loaded, display-only TradingView chart. Extend this surface; do not add a competing duplicate dashboard.
5. Produce a reconciliation report identifying conflicts between this package and current repository source of truth. Preserve existing stage IDs, owner decisions and strategy IDs.

## Owner constraints

- Never reset, clean, stash, broadly restore, delete or overwrite pre-existing modified/untracked work.
- Never read, copy, print or alter `.env`, credentials, tokens or private data unless a separately authorized need exists. Do not expose secrets.
- Do not commit, push, deploy, publish or release without separate explicit authorization.
- Windows-native workflow. Do not introduce WSL or Docker.
- No live broker/exchange credentials, live order endpoint or real order submission. Keep paper/simulation locks intact.
- AMI Core alone owns risk authorization, order/position state and P&L ledger. External providers and agents cannot override it.
- Optional providers remain disabled until their specific gates are approved.
- No locked-holdout access for tuning. No automatic strategy promotion. No model-generated risk overrides.
- No substantial install, paid provider call, model-weight download or storage use without a measured resource/cost gate and owner authorization.

## Product target

Replace page/tab-hopping as the primary interaction model with a single persistent, dark, dense but readable quant workstation. The target has a multi-chart canvas, right metrics/risk sidebar, a live system dependency map, an intelligence/strategy section, and a bottom event/orders/positions/research dock. The prototype in `prototype/index.html` is a layout reference only and contains fake demo data.

The UI must distinguish monitor/replay/paper labels and show source freshness. It must not invent a trading connection, mark a paper simulation as live, or show a green "healthy" status without evidence. Charts consume AMI-owned normalized market data and traceable overlays; chart libraries are renderers, not trading engines.

## First bounded work package

Create a new append-only work package (suggested title: `WP17 — Unified Quant Workstation`) using repository naming conventions; do not renumber or rewrite old work packages. Start design-first:

- Inventory current tabs and route ownership.
- Map existing React components and APIs to the desired screen regions.
- Propose component/state/data contracts and migration steps.
- Build one shell slice with resizable panels, configurable chart grid, sidebar, system-map region and bottom dock.
- Preserve existing Market View data-source gating and display-only separation.
- Use mocked fixture data only in clearly labelled story/demo/test paths; do not silently present fixtures as production.
- Keep all execution controls absent or explicitly disabled.

Do not add futures feed implementation to the first UI slice unless the corresponding upstream data contract is already accepted.

## Integration principles

- Use adapters and versioned AMI-owned contracts. Avoid copying framework internals.
- Qlib: isolated ML research adapter candidate (MIT; verify pinned revision and dependencies).
- VeighNa: selectively evaluate event-driven/futures gateway contracts (MIT; verify submodule/addon licenses independently).
- Freqtrade: GPL-3.0 repository, excluded from embedding under AMI's documented permissive-only policy unless the owner explicitly changes that policy. Use only as external conceptual research/reference material.
- PapersWithBacktest and Awesome Systematic Trading: discovery/replication inputs, not production runtimes. Verify exact repository, paper, data rights and source license per candidate.
- TradingView Lightweight Charts: candidate visual renderer, Apache-2.0; satisfy attribution and notice obligations. Confirm its API version and React integration against repo dependencies before selecting it. Existing TradingView widget behavior is a separate path.

## Validation expectations

- One bounded diff at a time.
- Tests, typecheck, lint and build appropriate to the touched scope.
- Inspect exact diffs; run `git diff --check` or document the pre-existing baseline issue.
- Keep current ledgers, acceptance evidence index, changelog, current state and handoff consistent with repository conventions.
- Report implemented, tested, integrated, operational, validated and accepted as distinct statuses.
- Never assert profitability from passing software tests.

## Deliverables for the first slice

1. Read-only baseline/reconciliation report.
2. UI inventory and component mapping.
3. New WP document with scope, dependencies, files, contracts, tests, resource limits, gates and recovery procedure.
4. A reviewed workstation shell implementation, if and only if the repo state is safe to edit.
5. Exact test commands/results and limitations.
6. Updated handoff and evidence index.

Stop only the gated part when an owner decision, cost, license, resource or safety gate is missing. Continue independent authorized read-only analysis and documentation.
