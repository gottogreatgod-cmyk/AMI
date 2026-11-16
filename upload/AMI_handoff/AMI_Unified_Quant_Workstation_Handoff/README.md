# AMI Unified Quant Workstation — Implementation Handoff

**Package version:** 1.1.0  
**Prepared:** 2026-11-15  
**Target repository:** `genetac/AMI` (private repository)  
**Purpose:** Preserve the complete product, architecture, futures-expansion, research-validation, integration and UI recommendations in a portable handoff package.

## Start here

1. **Windows (recommended):** extract the ZIP, then double-click `OPEN_WORKSTATION.bat`. It starts a local-only preview server and opens the dashboard in your browser. Keep the minimized server window open while viewing the prototype; close it when finished. Python 3 is required for this launcher.
2. **Manual alternative:** open [`prototype/index.html`](prototype/index.html) directly in Edge, Chrome or Firefox. The HTML is self-contained and does not need internet access.
3. Inspect the interactive workstation concept (synthetic demo only).
4. Give [`AGENT_HANDOFF_PROMPT.md`](AGENT_HANDOFF_PROMPT.md) to the coding agent after reviewing the package and the live repository state.
5. Read [`docs/01_PRODUCT_DIRECTION.md`](docs/01_PRODUCT_DIRECTION.md) for the product goal and non-negotiable principles.
6. Read [`docs/02_AMI_REPOSITORY_BASELINE.md`](docs/02_AMI_REPOSITORY_BASELINE.md) before touching the current codebase.
7. Read [`docs/03_TARGET_ARCHITECTURE.md`](docs/03_TARGET_ARCHITECTURE.md) and [`docs/04_WORKSTATION_UI_SPEC.md`](docs/04_WORKSTATION_UI_SPEC.md) for the intended platform and screen.
8. Follow [`docs/08_IMPLEMENTATION_ROADMAP.md`](docs/08_IMPLEMENTATION_ROADMAP.md) in dependency order.
9. Use `detailed-reference/` for the longer technical specifications, architecture diagrams and checklists.

## Package contents

| Path | Purpose |
|---|---|
| `OPEN_WORKSTATION.bat` | Windows launcher: serves the prototype on localhost and opens the browser |
| `prototype/index.html` | Standalone interactive dashboard concept; demo values only |
| `docs/01_PRODUCT_DIRECTION.md` | Mission, objectives, scope and invariants |
| `docs/02_AMI_REPOSITORY_BASELINE.md` | Current repository evidence, existing assets and safety constraints |
| `docs/03_TARGET_ARCHITECTURE.md` | Canonical data, research, decision, risk and paper-execution architecture |
| `docs/04_WORKSTATION_UI_SPEC.md` | Single-screen layout, charting, panels, layouts and interactions |
| `docs/05_FUTURES_AND_MARKET_DATA.md` | Nasdaq and gold futures instrument/data foundations |
| `docs/06_STRATEGY_RESEARCH_AND_VALIDATION.md` | Diagnosis of losing modules and evidence-led strategy lifecycle |
| `docs/07_FRAMEWORK_INTEGRATION_AND_LICENSES.md` | Qlib, Freqtrade, VeighNa, research catalog and chart technology treatment |
| `docs/08_IMPLEMENTATION_ROADMAP.md` | Work packages, dependencies and sequencing |
| `docs/09_ACCEPTANCE_AND_TEST_PLAN.md` | Verifiable completion criteria and tests |
| `docs/10_OPEN_GATES_AND_DECISIONS.md` | Items requiring evidence, provider selection or explicit owner approval |
| `docs/11_SOURCE_REFERENCES.md` | Repository and authoritative external references |
| `spec/*.json` | Machine-readable architecture, instrument/market/decision/strategy schemas and WP17-WP28 plan |
| `registries/*.json` | Proposed module topology, instruments, framework adapters and work-package registries |
| `detailed-reference/` | Extended technical specifications, security gates, strategy evaluation, diagrams and acceptance checklists |
| `AGENT_HANDOFF_PROMPT.md` | Safe coding-agent instructions for the first bounded implementation slice |

## What this package is — and is not

This is a **complete recommendation and implementation handoff**, not a backup or export of the private AMI repository. It does not contain AMI source code, datasets, `.env` files, credentials, account information, historical run artifacts or owner working-tree changes. Keep the repository and its independent backups separately.

The HTML prototype is a visual/product prototype only. It uses deterministic illustrative chart values and fictional demo metrics. It has no market-data connection, no order endpoint, no broker integration, no persistent trading state and no strategy execution.

## Non-negotiable project invariants

- AMI Core remains the only authority for strategy decisions, risk authorization, sizing, paper order lifecycle and the performance ledger.
- External frameworks, agents and models are research/advisory components. They cannot override AMI risk or submit orders.
- Live trading remains disabled. Do not add broker order routing or live credentials as part of this roadmap.
- Do not unlock holdout data or promote an inconclusive strategy without an explicit, separately evidenced approval process.
- Do not silently replace real providers with mocks and call the adapter integrated. Label fixtures and mocks accurately.
- Do not overwrite, reset, clean, stash or broadly restore the existing private repository. Its working tree was recorded as heavily modified and untracked in the 2026-11-15 handoff.
- Do not install large dependencies, model weights, paid data plans or incur provider costs without a resource/cost gate and owner authorization.
- Do not call a stage accepted merely because code exists or tests pass. Owner acceptance is separate.

## Recommended immediate action

Begin with a read-only recheck of the current repository baseline and a design-only review of the workstation. Then implement the UI shell as an isolated, bounded work package. In parallel, perform the strategy-performance audit. Do not begin Nasdaq/Gold strategy performance claims until instrument identity, contract metadata, historical data integrity, session calendars, rollover treatment and realistic execution costs have passed their own acceptance checks.

## Troubleshooting the HTML preview

Some chat/file previews do not render raw `.html` files as web pages. Download the ZIP and extract it first; do not try to preview the HTML from inside the chat attachment viewer. On Windows, double-click `OPEN_WORKSTATION.bat`. It uses Python 3 to serve only the extracted package on `127.0.0.1:18765`, then opens `http://127.0.0.1:18765/prototype/` in the default browser. Keep the minimized server console open while using the prototype and close it when finished. No remote host, trading feed, broker or API key is used. If Python is unavailable, double-click `prototype/index.html` directly or install Python 3 and retry.
