# 06 — External frameworks and license/integration matrix

## 1. Integration principle

Use other projects to strengthen research, benchmarking and data/execution adapters. Do not combine entire codebases into one runtime or give external frameworks independent control of risk and execution.

## 2. Candidate disposition

| Candidate | What it is useful for | Proposed disposition | License check at package preparation |
|---|---|---|---|
| Microsoft Qlib | Quant/ML research pipeline, datasets, features, model training/evaluation | First ML research adapter candidate; isolated Python worker | MIT license observed in repository LICENSE |
| VeighNa (`vnpy/vnpy`) | Event-driven multi-asset trading framework; futures-oriented architecture/gateway ecosystem | Study contracts, event lifecycle and selected connector patterns; do not replace AMI core | MIT license observed in repository LICENSE |
| Freqtrade | Crypto bot lifecycle, strategy tooling, backtesting, optimization | Reference only under current AMI license constraint; do not copy/embed until policy review | GPL-3.0 observed in repository LICENSE; conflicts with the restrictive policy in AMI's build notes |
| PapersWithBacktest / awesome systematic trading | Strategy and paper discovery/replication leads | Research catalogue; inspect each paper, code license and data methodology individually | Not treated as a reusable runtime library; per-entry license review required |
| Vibe-Trading (HKUST reference from the supplied recommendation) | Multi-agent research and alpha-factor discovery | Discovery candidate only; locate and verify canonical source, paper, code, license, connectors and data lineage before any adapter work | Claims in the supplied summary (tool/factor/connector counts) are unverified and are not adoption evidence |
| YouTube AI trading tools roundup | Discovery of additional projects | Watch/review as a lead list only; extract named projects and inspect each individually | A video is not a code license, performance audit or integration specification |
| TradingView Lightweight Charts | Native chart rendering | UI library candidate; verify current version, API, attribution and fit | Apache-2.0 observed in repository LICENSE |
| Awesome lists / curated catalogues | Tool discovery | Discovery only; no runtime dependency | Each linked project is reviewed individually |

## 3. Compatibility with AMI's recorded policy

The AMI `NotImplemented.txt` build specification states that external code is limited to MIT, Apache-2.0, BSD-2-Clause and BSD-3-Clause after a documented audit; GPL, AGPL, LGPL, MPL, EPL, custom and unlicensed projects are excluded. The repository's AGENTS.md also requires license review and preservation of owner constraints.

Therefore:
- Qlib (MIT): candidate, subject to pinned commit/version, dependency and data-license review.
- VeighNa (MIT): candidate, subject to pinned commit/version and connector-specific license review.
- Lightweight Charts (Apache-2.0): candidate, subject to notice/attribution requirements and version audit.
- Freqtrade (GPL-3.0): not an approved code integration under the currently recorded policy. Keep as a behavioral/research reference only unless the owner changes the policy after review.
- PapersWithBacktest and curated lists: inspect the license of every repository or dataset individually. A curated list does not confer rights to included projects.

Do not infer the license of plugins, exchange gateways, strategy examples, datasets, model weights or submodules from the parent repository's license. Maintain a component-level manifest.

## 4. Adapter design

Each external engine runs behind an AMI-owned adapter:

`AMI request -> validated request contract -> isolated worker -> external engine -> normalized output -> AMI provenance/fusion`

The adapter must expose:
- source repo, URL, exact commit SHA, release and license;
- build/runtime requirements and pinned dependencies;
- supported instruments/product types and data granularity;
- request/response schema and version;
- health/readiness and disabled/not-configured states;
- timeout, cancellation and retry policy;
- resource limits and telemetry;
- fixture/no-network tests;
- provenance of training and inference inputs;
- explicit output limitations and calibration status.

## 5. Suggested adoption order

1. Qlib: benchmark one small research task with existing data; no large model download until resource/cost gate.
2. VeighNa: review event and gateway abstraction, compare against AMI canonical market and OMS contracts; prefer a narrow bridge over a second core.
3. Lightweight Charts: evaluate within the existing Market View and test multi-panel layout.
4. Papers/strategy catalogues: register selected hypotheses only after paper, code, data, survivorship/look-ahead and license review.
5. Freqtrade: do not embed under current license policy; use only public documentation/behavior as inspiration unless an owner-authorized legal path is established.

## 6. AI agent constraints

LLM/agent components may summarize evidence, generate a proposed hypothesis specification or critique a result. They may not:
- alter registered rules after observing holdout results;
- write directly to OMS or risk settings;
- promote a strategy;
- assert a confidence probability without calibration;
- suppress a losing experiment;
- invent missing market data or exchange metadata.
