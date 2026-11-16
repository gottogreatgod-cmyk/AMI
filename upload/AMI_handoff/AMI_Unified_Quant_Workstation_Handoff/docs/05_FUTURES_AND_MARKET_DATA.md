# 05 — Nasdaq and gold futures: instruments, sessions and data

## Scope

Add genuine CME/COMEX futures identity and data support for:
- `MNQ` — Micro E-mini Nasdaq-100 futures.
- `NQ` — E-mini Nasdaq-100 futures.
- `MGC` — Micro Gold futures.
- `GC` — Gold futures.

Recommended research sequence: MNQ and MGC first; add NQ and GC after the data, cost and risk model proves stable. The first integration must be paper-only.

## Verified contract facts to seed, not hard-code forever

The current CME product references state:

| Product | Contract multiplier / size | Minimum tick | Indicative value per outright tick |
|---|---:|---:|---:|
| MNQ | USD 2 × Nasdaq-100 index | 0.25 index points | USD 0.50 |
| NQ | USD 20 × Nasdaq-100 index | 0.25 index points | USD 5.00 |
| MGC | 10 troy ounces | USD 0.10 per troy ounce | USD 1.00 |
| GC | 100 troy ounces | USD 0.10 per troy ounce | USD 10.00 |

These tick values are arithmetic from multiplier/contract size and minimum price fluctuation. The exchange rulebook and selected provider's dated-contract master remain authoritative; calendar spreads, special contracts and future rule changes can use different increments.

Use these as cross-checks for the initial registry only. The contract master/provider metadata must remain authoritative and versioned by effective date. Do not hard-code current margin estimates as fixed rules; margins and exchange/broker requirements change.

## Contract registry requirements

Each tradable contract record must include:
- venue and exchange product code;
- root symbol and exact listed contract month/year;
- exchange instrument/security ID and provider symbol;
- expiration/last trade date and first notice/delivery dates where applicable;
- contract multiplier and quote unit;
- tick size and tick value in account currency;
- quantity/lot increment and min quantity;
- currency and settlement/delivery characteristics;
- session calendar/timezone and holiday schedule;
- price limits/halts where published;
- fees, exchange charges, broker commissions and margin assumptions with effective dates;
- data source, retrieval timestamp, schema version and validation status.

Unknown or conflicting specifications block tradability. A symbol root such as `MNQ` is not a complete instrument identity; the actual expiry contract is.

## Continuous futures policy

Store actual listed contracts as the tradable truth. Continuous series are research constructs with explicit methodology:
- roll trigger (calendar, volume, open interest or provider mapping);
- roll decision timestamp and the information available then;
- unadjusted and adjusted series separately;
- adjustment method and roll-gap record;
- mapping from every synthetic bar to its underlying contract;
- no look-ahead in historical roll selection.

Never submit, size or reconcile a paper order against a synthetic/back-adjusted continuous instrument.

## Market data tiers

### Tier 1 — minimum viable futures research

- Historical and live candles at required intervals.
- Contract master/reference data.
- Bid/ask top-of-book or sufficiently accurate spread data.
- Exchange timestamps, receive timestamps and source availability.
- Session calendar, trading halts and holiday schedule.
- Provider coverage and gaps documented.

### Tier 2 — intraday execution realism

- Trades and best bid/ask updates.
- Quote/trade sequence validation.
- Spread and queue/slippage assumptions.
- Partial fill modelling and market impact bounds.

### Tier 3 — microstructure research

- Full depth-of-book snapshots and incremental updates.
- Order-level data where licensed/available.
- Book resynchronization, checksums, sequence-gap recovery.
- Event-time replay and latency observations.

Do not pay for Tier 3 until a registered microstructure experiment demonstrates it needs that resolution.

## Candidate provider

Databento's `GLBX.MDP3` documentation describes CME/CBOT/NYMEX/COMEX futures and options market data, with event-level and aggregated-depth content and historical availability dating to 2010. It is a candidate to evaluate, not a selected/activated provider. Confirm current symbol coverage, entitlement, delayed/real-time options, licensing, price, retention, data-use rights, local resource impact and contract mapping before approval.

## Data integrity rules

- Normalize times to UTC while preserving event, receive and ingestion times separately.
- Respect exchange session and maintenance breaks; do not treat session gaps as feed corruption automatically.
- A sequence gap invalidates a dependent order book until a valid resnapshot and replay.
- No forming candle may be used as a completed candle.
- Higher-timeframe bars must be native or causally aggregated.
- Historical data must preserve corrections and source revisions; record the data snapshot/hash used in each experiment.
- Stale/future/conflicting/missing data blocks new entries.
- Distinguish price units, index points, dollars per point, ounces, contracts and account currency explicitly.
- Apply commissions, exchange fees, spread, slippage, latency and conservative fill rules.

## Contract validation before strategy tests

For each contract: verify at least two independent metadata references or one authoritative exchange source plus provider metadata; verify price/tick/quantity conversion tests; verify session and expiry calendar tests; verify contract-month resolution; verify roll mapping; verify missing/stale/sequence behavior; verify paper sizing and fee calculations; replay representative session/holiday/roll scenarios.
