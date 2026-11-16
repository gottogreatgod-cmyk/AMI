# 11 — Source references and verification notes

**Reference snapshot:** 2026-11-15. External specifications, licenses, prices, API versions, entitlements and contract data can change. Recheck before implementation.

## AMI private repository

- Repository: https://github.com/genetac/AMI
- `AGENTS.md`: repository operating instructions, preservation rules, Windows-native and paper-only boundaries.
- `AMI_Full_Integration_Map_Agent_Master_Spec.md`: integration architecture, contracts and non-goals.
- `AMI_Overnight_Intelligence_Trading_Stack_Agent_Guide.md`: worker and adapter recommendations.
- `NotImplemented.txt`: strategy research discipline, continuation strategy status and platform/strategy notes.
- `docs/engineering/ami-agent-system/context/CURRENT_HANDOFF.md`: most recent handoff read; includes 2026-11-15 UI continuation.
- `docs/engineering/AMI_MASTER_INTEGRATION_LEDGER.json`: current machine-readable stage ledger.
- `docs/engineering/ami-agent-system/CURRENT_STATE.md`: older state snapshot; treat the later 2026-11-15 handoff and live ledger as fresher.

## Frameworks and licenses

- Qlib repository: https://github.com/microsoft/qlib
- Qlib LICENSE: https://github.com/microsoft/qlib/blob/main/LICENSE (MIT at time checked).
- VeighNa repository: https://github.com/vnpy/vnpy
- VeighNa core LICENSE: https://github.com/vnpy/vnpy/blob/master/LICENSE (MIT at time checked; addons/gateways separate audit).
- Freqtrade repository: https://github.com/freqtrade/freqtrade
- Freqtrade LICENSE: https://github.com/freqtrade/freqtrade/blob/develop/LICENSE (GPL-3.0 at time checked).
- Awesome Systematic Trading: https://github.com/wangzhe3224/awesome-systematic-trading (catalog/reference only).
- User-supplied PapersWithBacktest candidate: https://github.com/paperswithbacktest/awesome-systematic-trading/ (verify exact location, status, contents and terms before relying on it).
- TradingView Lightweight Charts: https://github.com/tradingview/lightweight-charts
- Lightweight Charts license/attribution: https://github.com/tradingview/lightweight-charts/blob/master/LICENSE and https://github.com/tradingview/lightweight-charts/blob/master/README.md.
- Official pane documentation: https://tradingview.github.io/lightweight-charts/docs/panes (supports multiple panes, independent series placement and resizing in documented API v5.3 at time checked).

## Futures and data

- CME MNQ contract specifications: https://www.cmegroup.com/markets/equities/nasdaq/micro-e-mini-nasdaq-100.margins.html (contract multiplier and tick are also displayed on CME's current product page).
- CME NQ contract specifications: https://www.cmegroup.com/markets/equities/nasdaq/e-mini-nasdaq-100.contractSpecs.html
- CME MNQ/NQ comparison: https://www.cmegroup.com/markets/equities/sp-500-and-nasdaq-100-futures.html
- CME Micro Gold specifications: https://www.cmegroup.com/markets/microsuite/metals (10 troy ounces; one-tenth GC; $0.10/oz minimum price fluctuation).
- CME Gold futures specifications: https://www.cmegroup.com/markets/metals/precious/gold-futures.contractSpecs.html
- Databento GLBX.MDP3 dataset: https://databento.com/datasets/GLBX.MDP3
- Databento GLBX.MDP3 data specification: https://www.databento.tech/docs/datasets/glbx-mdp3 (CME MDP 3.0 coverage and timestamp/event semantics).
- Databento GLBX.MDP3 data specification: https://www.databento.tech/docs/datasets/glbx-mdp3 (CME MDP 3.0 coverage and timestamp/event semantics).
- Databento GLBX.MDP3 documentation: https://www.databento.com/docs/datasets/glbx-mdp3

## Notes

- Contract quantities/tick values above are reference facts for schema checks, not a substitute for current official contract master data.
- Margin requirements change and vary by broker/account; never encode a scraped margin estimate as a static exchange constant.
- Data product availability does not mean an entitlement is active or data may be redistributed. Confirm current license/data-use terms and pricing.
- A GitHub license on a framework repository does not necessarily cover every submodule, plugin, strategy, sample dataset, model weight or third-party dependency.


## Current official contract cross-check (15 November 2026)

- CME's current NQ/MNQ overview lists MNQ as USD 2 × Nasdaq-100, NQ as USD 20 × Nasdaq-100, both with 0.25 index-point minimum ticks; tick values are USD 0.50 and USD 5.00 per contract respectively: https://www.cmegroup.com/markets/equities/sp-500-and-nasdaq-100-futures.html
- CME's NQ contract page independently lists the USD 20 multiplier and 0.25 index-point minimum tick: https://www.cmegroup.com/markets/equities/nasdaq/e-mini-nasdaq-100.contractSpecs.html
- CME's Micro Gold product table lists 10 troy ounces and a USD 0.10/oz minimum price fluctuation. That equates to USD 1.00 per MGC contract tick: https://www.cmegroup.com/markets/microsuite/metals
- CME's Gold page lists GC as 100 troy ounces. At USD 0.10/oz, the contract tick value is USD 10.00: https://www.cmegroup.com/markets/metals/precious/gold-futures.contractSpecs.html

Tick-value arithmetic must be verified against the selected provider's contract master. The official product pages and rulebook are authoritative; seed metadata in this package is not a live contract resolver.


## Current official contract cross-check (15 November 2026)

- CME's current NQ/MNQ overview lists MNQ as USD 2 × Nasdaq-100, NQ as USD 20 × Nasdaq-100, both with 0.25 index-point minimum ticks; tick values are USD 0.50 and USD 5.00 per contract respectively: https://www.cmegroup.com/markets/equities/sp-500-and-nasdaq-100-futures.html
- CME's NQ contract page independently lists the USD 20 multiplier and 0.25 index-point minimum tick: https://www.cmegroup.com/markets/equities/nasdaq/e-mini-nasdaq-100.contractSpecs.html
- CME's Micro Gold product table lists 10 troy ounces and a USD 0.10/oz minimum price fluctuation. That equates to USD 1.00 per MGC contract tick: https://www.cmegroup.com/markets/microsuite/metals
- CME's Gold page lists GC as 100 troy ounces. At USD 0.10/oz, the contract tick value is USD 10.00: https://www.cmegroup.com/markets/metals/precious/gold-futures.contractSpecs.html

Tick-value arithmetic must be verified against the selected provider's contract master. The official product pages and rulebook are authoritative; seed metadata in this package is not a live contract resolver.
