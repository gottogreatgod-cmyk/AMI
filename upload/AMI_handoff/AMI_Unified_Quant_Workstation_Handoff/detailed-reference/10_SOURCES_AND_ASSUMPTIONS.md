# 10 — Sources, assumptions and verification requirements

**Checked for this handoff:** 15 November 2026. Repository records and external GitHub source documents were inspected. Current exchange product terms, data-provider pricing/entitlements and provider-specific symbol mappings must be checked again at implementation time.

## AMI repository sources inspected

- `https://github.com/genetac/AMI`
- `https://github.com/genetac/AMI/blob/main/AGENTS.md`
- `https://github.com/genetac/AMI/blob/main/AMI_Full_Integration_Map_Agent_Master_Spec.md`
- `https://github.com/genetac/AMI/blob/main/AMI_Overnight_Intelligence_Trading_Stack_Agent_Guide.md`
- `https://github.com/genetac/AMI/blob/main/NotImplemented.txt`
- `https://github.com/genetac/AMI/blob/main/docs/engineering/ami-agent-system/README.md`
- `https://github.com/genetac/AMI/blob/main/docs/engineering/ami-agent-system/CURRENT_STATE.md`
- `https://github.com/genetac/AMI/blob/main/docs/engineering/ami-agent-system/context/CURRENT_HANDOFF.md`
- `https://github.com/genetac/AMI/blob/main/docs/engineering/AMI_MASTER_INTEGRATION_LEDGER.json`
- `https://github.com/genetac/AMI/blob/main/docs/engineering/AMI_BLOCKERS_AND_OWNER_DECISIONS.md`
- `https://github.com/genetac/AMI/tree/main/src/components/platform`
- `https://github.com/genetac/AMI/tree/main/src/lib/market-data`
- `https://github.com/genetac/AMI/tree/main/src/lib/lab`

## External framework references

- Qlib repository: https://github.com/microsoft/qlib
- Qlib license: https://github.com/microsoft/qlib/blob/main/LICENSE (MIT observed)
- Freqtrade repository: https://github.com/freqtrade/freqtrade
- Freqtrade license: https://github.com/freqtrade/freqtrade/blob/develop/LICENSE (GPL-3.0 observed)
- VeighNa repository: https://github.com/vnpy/vnpy
- VeighNa license: https://github.com/vnpy/vnpy/blob/master/LICENSE (MIT observed)
- TradingView Lightweight Charts: https://github.com/tradingview/lightweight-charts
- Lightweight Charts license: https://github.com/tradingview/lightweight-charts/blob/master/LICENSE (Apache-2.0 observed)
- PapersWithBacktest curated research: https://github.com/paperswithbacktest/awesome-systematic-trading
- Awesome Systematic Trading: https://github.com/wangzhe3224/awesome-systematic-trading
- Vibe-Trading discovery reference supplied in the request: https://www.youtube.com/watch?v=hh8G8_6v0Sg (canonical repository/license/performance not established by this handoff).
- AI trading tools roundup supplied in the request: https://www.youtube.com/watch?v=HTECq3p9l94 (discovery source only).

## Futures and data-provider references to validate

- CME E-mini Nasdaq-100 futures: https://www.cmegroup.com/markets/equities/nasdaq/e-mini-nasdaq-100.html
- CME Micro E-mini Nasdaq-100 futures: https://www.cmegroup.com/markets/equities/nasdaq/micro-e-mini-nasdaq-100.html
- COMEX Gold futures: https://www.cmegroup.com/markets/metals/precious/gold.html
- COMEX Micro Gold futures: https://www.cmegroup.com/markets/metals/precious/micro-gold.html
- CME trading hours and holiday calendars: https://www.cmegroup.com/trading-hours.html
- Databento: https://databento.com/ and https://databento.com/docs
- NinjaTrader market data documentation: https://ninjatrader.com/support/helpGuides/nt8/market_data.htm

## Assumptions requiring verification

1. Common NQ/MNQ/GC/MGC multipliers and minimum ticks in `04_FUTURES_MARKET_EXPANSION.md` are seed values only. Confirm current exchange product rulebooks and provider symbol master before use.
2. Futures root names do not identify a unique dated contract. A canonical symbol resolver and expiry calendar are prerequisites.
3. Databento coverage, pricing, entitlements, non-display rights, retention and redistribution permissions depend on product, account and agreement. No purchase is authorized.
4. Freqtrade is GPL-3.0 at the checked source. The AMI build note's restrictive dependency policy is treated as controlling until the owner changes it.
5. Qlib/VeighNa/Lightweight Charts repository licenses do not automatically cover every transitive dependency, plugin, connector, data source or model weight.
6. The dashboard prototype is synthetic and does not confirm actual chart library integration, market data or AMI API capability.
7. The AMI handoff's 392-test figure and other build results are repository-recorded claims, not tests performed while creating this package.
8. Work package ID WP17 is proposed. Reconcile the current ledger before allocating the ID.
9. Vibe-Trading capabilities, project provenance, repository, component licenses and advertised counts have not been independently established here; it remains discovery-only.

## Not evidence of profitability

No framework, GitHub star count, academic Sharpe ratio, benchmark screenshot, passing unit test or AI-generated recommendation proves future profitability. Any performance statement must be tied to a reproducible experiment and transparent data/cost assumptions.
