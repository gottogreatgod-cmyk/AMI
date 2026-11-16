# 04 — Nasdaq-100 and gold futures expansion

## 1. Initial instrument set

| Root | Product | Venue | Intended role | Initial treatment |
|---|---|---|---|---|
| `MNQ` | Micro E-mini Nasdaq-100 | CME | First Nasdaq research contract | Start historical/replay/paper research here |
| `NQ` | E-mini Nasdaq-100 | CME | Standard-sized Nasdaq contract | Register; test only after MNQ data/risk chain is sound |
| `MGC` | Micro Gold | COMEX | First gold research contract | Start historical/replay/paper research here |
| `GC` | Gold futures | COMEX | Standard-sized gold contract | Register; test only after MGC data/risk chain is sound |

Root symbols are not sufficient identities for live/dated futures. Every tradable instrument must resolve to a specific expiration contract and exchange/vendor-qualified symbol. Continuous contracts are a separate research instrument and cannot be routed to execution.

## 2. Product specification seed (must be re-verified)

The following common contract characteristics are useful as registry seed values, not an authority for production. Verify against current CME/COMEX contract-specification pages and the selected provider's symbol master at the time of implementation. Store effective dates and source references with each specification.

| Product | Common multiplier / size | Common minimum tick | Indicative tick value |
|---|---:|---:|---:|
| NQ | USD 20 × index | 0.25 index points | USD 5.00 |
| MNQ | USD 2 × index | 0.25 index points | USD 0.50 |
| GC | 100 troy oz | USD 0.10/oz | USD 10.00 |
| MGC | 10 troy oz | USD 0.10/oz | USD 1.00 |

Do not hard-code these values as forever constants. Exchange rules, vendor representations, tick schedules and contract definitions must be discoverable and versioned.

## 3. Required contract metadata

- exchange and venue MIC/product identifier as available;
- root symbol and full dated contract symbol;
- expiration month/year and provider symbol mapping;
- first notice date / last trade date / delivery metadata where applicable;
- tick size and tick value;
- multiplier and currency;
- quantity step/minimum quantity;
- contract status and listing status;
- exchange session calendar and timezone;
- holidays and exceptional closures;
- price limits/settlement rules when needed by the simulator;
- exchange/broker fees and commission schedule;
- margin/initial/maintenance margin only when sourced and dated;
- provider source, mapping timestamp, effective-from/effective-to and hash.

## 4. Continuous series rules

Maintain distinct series types:
- `DATED_CONTRACT`: actual tradable expiry-specific contract;
- `CONTINUOUS_UNADJUSTED`: stitching policy explicit, may show roll gaps;
- `CONTINUOUS_BACK_ADJUSTED`: research-only adjusted prices, never tradable;
- `CASH_INDEX`, `ETF`, `CFD`, `SPOT_METAL`: separate context/asset identities.

For every continuous series, record roll trigger (calendar, volume, open interest or explicit rule), roll dates, adjustment method, contract mapping, gaps, source files and transformation hash. Never use back-adjusted values as actual fill prices.

## 5. Data provider investigation

Evaluate Databento/CME Globex datasets and a broker-supported feed. Provider evaluation must cover:
- actual instrument coverage and depth (trades, top-of-book, depth, bars);
- historical range and granularity;
- real-time entitlement and exchange licensing;
- timestamp semantics and event sequence guarantees;
- symbol mapping and expiry metadata;
- correction/cancel handling;
- rate limits, retention, redistribution and non-display rights;
- local capture/export and replay suitability;
- cost, billing and download/resource limits;
- sample data quality and gap-rate tests.

No paid subscription or usage is authorized by this document. Record provider pricing and entitlements with date and owner approval before any spend.

## 6. Futures replay and cost simulation

- Include per-contract commissions and exchange/clearing fees.
- Simulate bid/ask spread and market impact appropriate to bar/depth fidelity.
- Model slippage separately from commission.
- Model limit/stop order trigger and fill rules, partial fills, queue assumptions and gaps.
- Do not assume a stop fills at its stop price when the market gaps through it.
- Distinguish trade-entry timestamp from bar availability timestamp.
- Apply tick rounding before risk and net-R calculations, not after.
- Enforce quantity increments and minimum size.
- Record each assumption, parameter and execution-model version.
- Sensitivity-test fees and slippage; report when a strategy's edge disappears under plausible adverse assumptions.

## 7. Session and event effects

Use official exchange schedules and instrument-specific session templates. Model daylight-saving transitions, maintenance windows, holidays, early closes and contract-specific events. Optional event context includes scheduled macro releases and inventory reports, but only with timestamped sources and point-in-time availability. Do not hard-code a universal session schedule.

## 8. Staged validation

1. Contract symbol resolver fixtures and instrument metadata tests.
2. Historical data import with schema/time/gap validation.
3. Deterministic replay and repeatable event hashes.
4. Cost/fill simulation unit tests and stress tests.
5. MNQ and MGC baseline strategy evaluation, with no parameter fishing.
6. Walk-forward and untouched holdout.
7. Forward paper observation against provider data.
8. NQ and GC only after the same gates pass; do not infer that the micro product validates the standard-sized one without checking liquidity, slippage, risk and fill differences.

## 9. Futures-specific failure codes

`CONTRACT_UNKNOWN`, `CONTRACT_EXPIRED`, `ROLL_WINDOW`, `CONTINUOUS_SERIES_NOT_TRADABLE`, `EXCHANGE_CALENDAR_MISSING`, `SESSION_CLOSED`, `HOLIDAY_OR_EARLY_CLOSE`, `TICK_RULE_UNKNOWN`, `MULTIPLIER_UNKNOWN`, `QUANTITY_STEP_INVALID`, `PROVIDER_SYMBOL_MISMATCH`, `DATA_GAP`, `DEPTH_RESYNC_REQUIRED`, `COST_MODEL_MISSING`.
