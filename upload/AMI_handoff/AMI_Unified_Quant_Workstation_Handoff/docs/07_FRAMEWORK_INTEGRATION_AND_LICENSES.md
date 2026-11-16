# 07 — Framework integration strategy and license review

## Decision: integrate capabilities, not entire competing trading platforms

AMI already has market-data, research, fusion, strategy, risk and paper execution domains. The frameworks should augment research or supply narrowly scoped adapters. They must not create parallel order managers or risk authorities.

| Candidate | Intended role | Initial treatment | License/policy note |
|---|---|---|---|
| Microsoft Qlib | ML/factor research, model training/evaluation | Isolated Python research adapter after data and resource gates | GitHub repository lists MIT; preserve notice and audit pinned revision/dependencies |
| VeighNa (`vnpy`) | Event-driven/futures architecture and selected gateway concepts | Read/evaluate; selectively use eligible interfaces after source/addon license review | Core repository LICENSE is MIT; each gateway, app and plugin must be audited independently |
| Freqtrade | Crypto backtest/strategy/optimization reference | Reference-only; do not embed or copy source under current policy | Repository LICENSE is GPL-3.0; AMI's existing integration guide excludes GPL/AGPL/LGPL/MPL/EPL/custom/unlicensed code |
| PapersWithBacktest and strategy catalogs | Discover papers/hypotheses and replicate independently | Research registry only; verify exact source, paper, data and license for every candidate | Curated listing does not grant rights to code/data linked from it |
| Awesome Systematic Trading | Research discovery index | Catalog/reference only | Review each downstream project individually |
| TradingView Lightweight Charts | Possible chart-rendering library for multi-chart canvas | Candidate renderer; prototype uses a small inline Canvas renderer so it works offline | Repository LICENSE is Apache-2.0 and project requires TradingView attribution/notice. Confirm repo policy and exact version before adoption |
| TradingView hosted widget | Existing display-only chart integration | Preserve as optional external display path | Not a replacement for canonical AMI data. Cookie/network/provider availability remains external |

## Qlib

Use Qlib as a bounded worker for factor/model research, forecast generation and evaluation. Inputs must be AMI-owned canonical datasets with point-in-time identity and hashes. Outputs must include model/version/config, data as-of, feature lineage, horizon, units, predictions/quantiles, evaluation summary and calibration metadata. Qlib must not submit orders, change risk or directly mutate AMI strategy configuration.

Before installing: measure RAM/disk; verify Windows-native compatibility and Python version against the selected pinned revision; isolate its Python environment; inspect model/data download volume; confirm license/terms; use a fixture/no-network adapter test first.

## VeighNa

Study event-driven design, gateways and futures instrument/event models. Do not transfer gateway code blindly. Any selected gateway/add-on must be separately checked for broker requirements, credential handling, platform support, dependencies and license. AMI's own contract and risk gate remain authoritative. A gateway is not enabled merely because it compiles.

## Freqtrade

Freqtrade is explicitly a crypto trading bot project and its repository LICENSE is GPL-3.0. The AMI guide says external code under GPL-family licenses is excluded. Therefore: use documentation and public behavior as external conceptual references only; do not copy files, port close translations, vendor the code or add the project as a code dependency under the current policy. If the owner wishes to change this policy, that is a separate legal/architecture decision, not an implementation convenience.

## Papers and curated lists

Use academic results as hypotheses to reproduce, not as profitability claims. For each candidate paper: record exact citation/DOI, rules, data, sample, market, horizon, costs, publication caveats, repository/source commit, license and replication delta. Do not treat a reported Sharpe ratio as independently verified.

## Adapter contract

All research adapters should support:
- versioned request/response schemas;
- stable provider/model identity and source commit;
- input snapshot IDs/hashes and `asOf` timestamps;
- explicit timeouts/retries/error classes;
- health checks and status (`DISABLED`, `NOT_CONFIGURED`, `MOCK_ONLY`, `DEGRADED`, `READY` etc.); map to existing AMI conventions;
- no-network fixture tests;
- budget/resource limits and cost recording;
- no order/risk mutation capabilities;
- reproducible run IDs and logs with secret redaction.

## No blind dependency bundle

Do not install all four frameworks into the AMI main runtime. Qlib/VeighNa are Python-facing and should be isolated. Freqtrade remains reference-only. Charting dependency selection should happen after React/API compatibility and license notices are checked. Pin exact commits/versions and run license, security, platform, dependency-size and performance review before adoption.
