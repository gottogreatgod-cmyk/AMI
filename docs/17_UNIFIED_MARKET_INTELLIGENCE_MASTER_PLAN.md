# AMI — Unified Market Intelligence Master Plan

**Status:** implementation specification / architecture baseline  
**Date:** 20 November 2026  
**Feature branch:** `ami/unified-market-intelligence`  
**Parent implementation:** `ami/local-live-opportunity-completion` at `7d6093597530b91ca687acd326aafdbb5b54f486`  
**Parent PR:** [#3 — Local live monitoring and historical opportunity](https://github.com/gottogreatgod-cmyk/AMI/pull/3)  
**Operating scope:** local research, chart analysis, historical replay and opportunity observation. No live broker order routing.

---

## 0. Executive decision

AMI should evolve from separate chart overlays, strategy signals and a market confluence briefing into one evidence-driven **Unified Market Intelligence** system.

The feature combines five complementary analytical dimensions:

1. **Multi-timeframe analysis** — Weekly, Daily, 4H, 1H, 15M and 5M context for each primary instrument.
2. **Key-level intelligence** — identify, cluster, rank and track reactions to structurally important price levels and zones.
3. **Intermarket intelligence** — measure how related markets and indexes behave around their own important levels, then evaluate whether those reactions confirm, contradict or condition the primary market thesis.
4. **Opportunity and scenario intelligence** — identify conditional bullish, bearish and neutral paths, including activation, invalidation, targets and estimated horizon.
5. **Causal monitoring and validation** — update the thesis only from information available at each decision time; preserve snapshots and validate outcomes through replay and forward observation.

The system must reuse the existing workstation, analyst confluence, indicators, market-structure, displacement-zone, replay and opportunity lifecycle foundations. It must not create a parallel charting, signal, data or opportunity stack.

The product experience remains the progressive five-screen workflow:

1. Macro and cross-market context.
2. Intermediate structure and key-level map.
3. Setup formation.
4. Entry timing.
5. Unified market projection.

The five steps are a guided analysis process, not a requirement that every timeframe be available. Missing or stale evidence must be visible and must never be silently treated as neutral.

## 1. Repository audit — existing source of truth

Audited against the parent branch at the commit above. This is a code-level audit; it does not certify real provider data, local Windows runtime, broker economics or profitability.

### 1.1 Existing workstation and chart foundation

- Next.js 16 App Router, React 19, TypeScript, Bun, Prisma/SQLite, NextAuth and Lightweight Charts 5.3.
- Workstation includes Desk, Day Review, Lab and Analyst areas.
- Desk supports multi-chart layouts (1/2/4), symbol and timeframe selection, local dataset selection and a persisted layout.
- Current selectable chart timeframes include 1m, 15m, 45m, 1h, 3h, 4h, 1d and 1w.
- Derived local aggregation currently supports M5/M15/M30/H1/H4/D1, but chart selectable/mapping coverage does not expose every derived interval. Reconcile this in the canonical timeframe registry; do not create a second list.
- Existing chart overlays include:
  - previous available UTC calendar-date high/low;
  - closed-bar BOS/CHoCH structure markers;
  - ATR-normalized displacement-origin supply/demand zones.
- The previous UTC-date level is explicitly not a verified exchange session high/low.
- Displacement zones are explicitly mechanical research heuristics, not institutional order-flow observations.
- MiniChart uses Lightweight Charts and has separate marker and price-line overlay mechanisms.

**Gap:** no unified key-level registry, multi-source level clustering, session-aware level engine, VWAP/opening-range engine, reaction-state engine or intermarket level-reaction map exists in the audited code.

### 1.2 Existing analyst confluence and bias

The existing `src/lib/analyst.ts` calculates market pulses using:

- Weekly, Daily and 4H EMA-based trend votes.
- Trend weights: Weekly 1.5, Daily 1.0, 4H 0.5.
- A composite trend score and a STRONG/MILD/NONE confluence label.
- Daily realized volatility comparison (14-day versus 90-day) to classify ELEVATED/NORMAL/QUIET.
- Daily ATR percentage and prior-20-day Donchian upper/lower levels.
- Economic-calendar event risk.
- A VIX backdrop based on absolute level thresholds (at/above 22 and at/below 14) for selected risk assets.

The Analyst UI already includes a per-market confluence board, market pulse, session/calendar context and an AI-assisted briefing generated from deterministic context. The LLM is a narrative layer, not the numeric source of truth.

**Gap:** the current VIX context is a level threshold note, not a level interaction engine. It does not detect VIX approaching/rejecting/respecting/accepting/breaking/reclaiming a historical level and correlate that event with a simultaneous Nasdaq level interaction. The current trend-score model does not represent key-level clusters, reaction quality, market lead/lag, cross-asset divergence or regime-conditioned relationships.

The current analyst context uses the generic provider instrument registry. It does not yet unify the primary Dukascopy local revisions with the contextual index series through an exact common source/provenance contract.

### 1.3 Existing strategy signals and higher-timeframe filters

- `src/lib/engine/runner.ts` exposes strategy-specific current signal state.
- Strategy configurations can include higher-timeframe EMA, Donchian, momentum or range-neutral filters.
- These are strategy signals and filters, not a complete market-wide directional thesis.
- The RightSidebar and BottomDock display per-strategy signals and research runs.

**Gap:** strategy bias, analyst market bias and chart structure are distinct systems. The new design must preserve their meaning and reconcile them in a higher-level view rather than overwrite one with another.

### 1.4 Existing deterministic analytical modules

- `src/lib/engine/indicators.ts`: causal SMA, EMA, ATR, RSI, Donchian, Bollinger, ADX and realized volatility utilities.
- `src/lib/engine/market-structure.ts`: confirmed swing-based BOS/CHoCH and previous available UTC date levels.
- `src/lib/engine/displacement-zones.ts`: ATR-normalized base/impulse zone heuristic and subsequent retest/invalidation lifecycle.
- `src/lib/engine/replay/`: deterministic closed-bar replay and structure-break/retest detector.
- `src/lib/engine/live/`: persistent live opportunity cursor and closed-bar event processing.
- `src/lib/engine/opportunity-lifecycle.ts` and store: append-only lifecycle events and persisted opportunity snapshots.
- `src/lib/data/timeframe-aggregation.ts`: deterministic UTC aggregation and incomplete-bucket diagnostics.

**Important causal review:** displacement-zone lifecycle can be updated by later bars. A historical as-of analysis must only evaluate bars available at that as-of timestamp, or use a causal event stream. Never take a zone's current status from a full future-inclusive array and display it as if that status was known earlier.

### 1.5 Instrument and data identity audit

Existing provider registry includes instruments such as BTCUSDT, NQ=F, GC=F, ^VIX, EURUSD=X and USDJPY=X. The local Dukascopy dataset path separately uses:

- `XAUUSD-DUKA`: Dukascopy OTC spot metal quote.
- `NAS100-DUKA`: Dukascopy index CFD quote.

These identities are not interchangeable:

- `NQ=F` is a continuous futures research proxy, not NAS100-DUKA.
- `GC=F` is a continuous futures research proxy, not XAUUSD-DUKA.
- `^VIX` is a volatility index, not an outright tradable asset.
- Provider and instrument identity, quote side, data class, timestamp, dataset revision and quality status must accompany every observation.

A cross-market relationship may compare a CFD with a futures proxy as contextual evidence, but it must explicitly label the relationship and basis mismatch. It must never merge their candles or contract economics.

### 1.6 Existing operational foundation and limitations

Parent PR #3 provides local setup, supervisor, Dukascopy polling workers, separate BID/ASK processing, immutable dataset manifests, replay, opportunity persistence, M1-to-higher-timeframe aggregation and a local runbook.

Parent PR #3 is an open draft and must not be described as merged. Its latest recorded head is `7d6093597530b91ca687acd326aafdbb5b54f486`; CI run #622 succeeded. This validates the committed offline CI suite, not actual Windows/provider/session certification.

Still external or uncertified:
- real BID/ASK history downloads and data-quality review;
- provider cadence and outage recovery in real sessions;
- actual Windows startup/stop/restart;
- verified session calendars and DST/holiday behavior;
- authenticated browser E2E;
- real broker/venue contract economics;
- golden-day annotations and forward session acceptance.

Risk sizing remains fail-closed for the Dukascopy OTC/CFD instruments until venue-specific economics are independently verified. Live order routing remains disabled.

---

## 2. Correct conceptual model

### 2.1 The five intelligence planes

**A. Instrument and timeframe intelligence**
- Analyses the primary instrument independently at 1W, 1D, 4H, 1H, 15M and 5M.
- Produces trend, regime, structure, volatility, zones, liquidity references, evidence and invalidation.
- Each result is tied to an exact source revision and decision timestamp.

**B. Key-Level Intelligence**
- Finds important price references across multiple timeframes and level families.
- Groups nearby references into level clusters or zones.
- Tracks how price approaches and reacts to each level.
- Separates a price magnet/target from a support/resistance barrier.
- Distinguishes repeated rejection from repeated acceptance/erosion. Repeated touches do not automatically make a level stronger.

**C. Intermarket Intelligence**
- Tracks contextual markets and indexes as separate instruments.
- Detects their own level approaches and reactions.
- Evaluates whether those events historically and currently confirm, contradict or condition the primary instrument's thesis.
- Models regime-dependent relationships and divergence rather than assuming a permanent inverse correlation.

**D. Confluence and Scenario Intelligence**
- Combines primary-market structure, key-level clusters, intermarket reactions, volatility, event risk and timeframe agreement.
- Produces bullish, bearish and neutral conditional scenarios.
- Explains why a scenario is preferred, what would activate it, what invalidates it and what evidence is missing.

**E. Projection, Monitoring and Validation**
- Projects candidate destinations using actual level clusters and volatility-aware horizons.
- Monitors new closed candles and relevant cross-market events.
- Preserves each previous thesis and records changes.
- Replays historical decisions causally and calibrates probabilities only after out-of-sample validation.

### 2.2 Bias is not one number

AMI must preserve at least these separate outputs:

1. **Macro directional bias:** long-horizon market structure and regime.
2. **Primary instrument bias:** the instrument's own multi-timeframe structure.
3. **Intermarket backdrop:** supportive, adverse, mixed or unknown contextual conditions.
4. **Level map:** nearby support/resistance, liquidity, magnets and reaction clusters.
5. **Opportunity bias:** whether a specific conditional setup is developing.
6. **Entry readiness:** whether lower-timeframe trigger conditions are actually met.

Do not collapse all six into one weighted number. A single headline label may summarize them, but the underlying dimensions and contradictions remain inspectable.

---

## 3. Key-Level Intelligence specification

### 3.1 Level families

Implement level sources as separate providers/adapters that emit a canonical `PriceLevel` contract.

Initial level families:

- Confirmed Weekly and Daily swing highs/lows.
- Confirmed 4H and 1H swing highs/lows.
- Previous day/week/month highs and lows, with correct calendar/session provenance.
- Verified session highs/lows when an authoritative instrument calendar exists.
- Opening range levels when the session definition and opening window are configured.
- VWAP and anchored VWAP only where source volume semantics and anchor/session definitions are valid.
- Donchian boundaries and range extremes.
- Confirmed displacement-origin supply/demand zones.
- Equal-high/equal-low and liquidity-cluster references.
- Optional round-number / psychological levels as a separately labelled heuristic.

Do not label a UTC calendar-day high/low as an exchange session level. Do not calculate volume-weighted measures from a numeric zero placeholder or unknown CFD tick-volume semantics.

### 3.2 Canonical level contract

Each level should include:

- stable ID and version;
- instrument/provider/data identity;
- price side and price basis;
- level family and subtype;
- source timeframe;
- lower/upper price bounds or exact price;
- origin candle timestamps and source revision/hash;
- creation/confirmation timestamp;
- last evaluated timestamp;
- source engine/version and parameters;
- observed interaction count and distinct reaction-event IDs;
- current reaction state;
- invalidation/expiry policy;
- evidence and quality status.

### 3.3 Level clustering and ranking

Nearby levels can be clustered using a volatility- and tick-size-aware distance rule, not a fixed arbitrary number of price points.

Cluster features:
- independent source count;
- timeframe hierarchy;
- source recency and age decay;
- distance between source levels;
- number of distinct tests;
- rejection/hold/acceptance/break/reclaim outcomes;
- reaction displacement after interaction;
- time spent beyond/inside the zone;
- volatility regime at interaction;
- data quality and source independence.

Do not double-count correlated or duplicate references. For example, a Daily swing and a 4H swing derived from the same underlying pivot may not be independent evidence.

Repeated touches can have different meanings:
- repeated clean rejection with displacement may strengthen evidence of defended supply/demand;
- repeated acceptance through a level may weaken its barrier role;
- repeated tests without meaningful reaction may indicate absorption, compression or eventual break risk.

The engine must preserve the event history so the UI can explain the ranking.

### 3.4 Level reaction state machine

Use explicit event states:

- `APPROACHING`
- `TOUCHED`
- `REJECTED`
- `RESPECTED`
- `ACCEPTED`
- `BROKEN`
- `RECLAIMED`
- `INVALIDATED`
- `EXPIRED`
- `UNKNOWN_DATA`

The exact definitions must be configurable and versioned:
- approach distance uses ATR/tick-normalized thresholds;
- touch means observed range intersects the level/zone;
- rejection requires a defined close-back/response condition, not merely a wick;
- respect requires the defined hold condition over specified closed bars;
- acceptance requires a defined amount of close/time beyond the zone;
- break and reclaim require explicit close/confirmation rules;
- missing or stale data cannot emit a reaction event.

Every reaction event records the candle that first made it knowable and its discovery timestamp.

### 3.5 Magnet map versus barrier map

A cluster may function as:
- a **barrier** likely to produce rejection/decision;
- a **magnet** or objective toward which price may travel;
- a **decision zone** where acceptance/rejection determines the next path;
- an **invalidated zone** no longer eligible as the current thesis anchor.

Do not infer magnet behavior from touch count alone. Use structural path, distance, historical arrival/reaction statistics, liquidity context and current regime. Show the evidence behind any ranking.

---

## 4. Intermarket Intelligence specification

### 4.1 Market roles

Create a configurable market-context registry. Separate primary tradable/research instruments from contextual drivers.

Initial primary targets:
- XAUUSD-DUKA.
- NAS100-DUKA.

Initial contextual series already present or proposed for certification:
- `^VIX`: volatility regime/level reaction context.
- `NQ=F`: Nasdaq futures proxy; never identical to NAS100-DUKA.
- `GC=F`: gold futures proxy; never identical to XAUUSD-DUKA.
- S&P 500 / ES proxy: broad US equity confirmation, subject to provider certification.
- DXY / USD index: dollar strength context, subject to provider certification.
- US Treasury yields and, for gold research, real-yield proxy: subject to provider and timestamp certification.
- Optional breadth/sector context (e.g. Russell 2000, semiconductor index) behind explicit feature flags and data-quality gates.

Do not add every proposed market to the live dependency graph at once. Start with VIX and the available Nasdaq/gold proxies; add other contextual instruments only after their history, cadence, session and source identity are verified.

### 4.2 VIX reaction example

The intended workflow is:

1. Detect a VIX level/zone from its own historical structure (swing, range boundary, prior period level or versioned regime band).
2. Detect VIX approaching that level.
3. Classify the closed-bar interaction: rejection, respect, acceptance, break or reclaim.
4. Record the VIX reaction event with its exact source timestamp and level provenance.
5. Align that event with the contemporaneous Nasdaq structure and key-level map.
6. Evaluate whether the observed combination has historically supported Nasdaq continuation, reversal, volatility expansion or no reliable directional implication under the current regime.
7. Update the Nasdaq scenario only if its own price structure and level conditions also support the path.

A VIX rejection can support a risk-on/Nasdaq-up thesis in some regimes, but it is not a standalone buy signal. A VIX break higher can indicate volatility stress, but the Nasdaq response must be observed and validated rather than assumed.

### 4.3 Intermarket event features

For each primary/context pair, evaluate:
- synchronized returns over multiple horizons;
- rolling correlation as descriptive context, not a standalone signal;
- rolling beta/sensitivity where statistically valid;
- relative strength and divergence;
- lead/lag distributions with no future data;
- level reaction event alignment;
- volatility regime;
- session overlap and event calendar;
- stale/missing source status;
- relationship stability and regime changes.

A relationship may be positive, negative, unstable, lagged or unknown. The system must allow the relationship to change.

### 4.4 Time alignment and source quality

- All timestamps stored in UTC.
- Use only closed bars for confirmed reactions.
- Align observations by event/close time, not by array index.
- Do not forward-fill stale contextual markets into a current signal without explicit maximum-age rules.
- Respect differing market sessions, holidays and maintenance intervals.
- Record provider receive time separately from market event time.
- A stale or missing contextual market lowers evidence completeness; it is not neutral confirmation.
- No cross-provider candle splicing.

### 4.5 Intermarket influence is conditional, not causal certainty

The UI should say:
- supportive evidence;
- contradictory evidence;
- no reliable relationship in this regime;
- insufficient synchronized history.

It must not claim that VIX caused a Nasdaq move merely because the two moved in opposite directions. Correlation and lead/lag statistics are descriptive/conditional until validated.

---

## 5. Five-screen progressive analysis UX

Preserve the five-screen experience and integrate cross-market intelligence into it.

### Screen 1 — Macro and intermarket context (1W / 1D)

- Weekly/Daily primary instrument bias and regime.
- Cross-market board: VIX, Nasdaq/S&P context, dollar/yield context when certified.
- Major Weekly/Daily levels and key clusters.
- Market calendar and volatility regime.
- Each market's own level reaction state.
- Manual `Confirm Macro Analysis` captures immutable snapshots.

### Screen 2 — Intermediate structure and level map (4H)

- 4H BOS/CHoCH, swing structure and pullback/continuation context.
- Level cluster map: barrier, magnet, decision zone.
- Repeated reaction history and level strength evidence.
- Intermarket events that remain relevant to the 4H horizon.
- Confirm 4H snapshot.

### Screen 3 — Setup formation (1H)

- Candidate setup, structure break/retest, displacement and liquidity.
- Primary and alternative scenario conditions.
- Nearby level-cluster targets and structural invalidation.
- Intermarket context can qualify/suppress a candidate but cannot manufacture its trigger.
- Confirm 1H snapshot.

### Screen 4 — Entry timing (15M / 5M)

- Local structure, sweep, retest, displacement and trigger conditions.
- Current spread/quote freshness and source quality.
- Entry region, structural invalidation and target distance.
- Explicit WAIT when no trigger is confirmed.
- Confirm entry-timing snapshot.

### Screen 5 — Unified projection

- Macro bias, primary instrument bias, intermarket backdrop, level map and opportunity state as separate dimensions.
- Preferred scenario plus bullish/bearish/neutral alternatives.
- Conditional activation and invalidation.
- Traceable target zones and estimated horizon range.
- Missing evidence and conflicting markets.
- Current versus previous thesis diff.
- Automatic updates after baseline confirmation, visibly distinguished from manual confirmation.

A confirmation confirms that a chart/data snapshot has been analysed; it does not confirm that the prediction is true and does not place an order.

---

## 6. Unified data contracts and persistence

Build contracts before engines. Suggested logical records (adapt to current Prisma conventions and existing models):

- `MarketAnalysisSession`
- `TimeframeAnalysisSnapshot`
- `AnalysisConfirmation`
- `MarketLevel`
- `LevelCluster`
- `LevelInteractionEvent`
- `IntermarketObservation`
- `IntermarketReactionEvent`
- `ConfluenceAssessment`
- `MultiMarketScenario`
- `ScenarioTransitionEvent`
- `ProjectionEvaluation`
- `ForecastEvaluation`
- `AnalysisAuditEvent`

Do not duplicate `ReplayRun`, `Opportunity`, `OpportunityEvent`, live cursors or live event records. Link to existing records by stable IDs.

Every analytical record includes:
- instrument and market role;
- timeframe and exact source identity;
- price side / basis;
- dataset revision ID and hashes or live snapshot/sequence identity;
- decision timestamp and latest eligible closed-bar timestamp;
- discovery timestamp;
- engine and parameter versions;
- input fingerprint;
- evidence and contradictions;
- data quality/freshness state.

Snapshots and events are immutable. A correction or changed source creates a new revision and an explicit supersession/reconciliation event.

---

## 7. Unified bias and confluence model

Do not replace the current weighted EMA confluence immediately. Keep it as a named legacy/technical trend component and compare it with the new model during shadow evaluation.

The new composite assessment contains independent dimensions:

- macro direction;
- primary instrument multi-timeframe structure;
- key-level proximity and interaction;
- level-cluster destination map;
- intermarket backdrop and reaction events;
- volatility regime;
- event risk;
- data quality/freshness;
- strategy-specific signals;
- opportunity lifecycle and entry readiness.

A summary may be:
- `BULLISH`
- `BEARISH`
- `NEUTRAL`
- `MIXED`
- `TRANSITIONING`
- `UNKNOWN`

But the system must retain the underlying vector and explanation. A weighted score can be displayed as a secondary diagnostic only if each component, normalization, missing-data rule and calibration is documented.

Never allow multiple correlated indicators or duplicated level sources to overwhelm a structural contradiction. No missing data is silently assigned zero/neutral.

---

## 8. Scenario and projection engine

For every unified analysis, evaluate:
- bullish scenario;
- bearish scenario;
- neutral/range scenario.

Scenario states:
- `CREATED`
- `DEVELOPING`
- `ARMED`
- `TRIGGERED`
- `ACTIVE_RESEARCH`
- `COMPLETED`
- `INVALIDATED`
- `EXPIRED`
- `SUPERSEDED`
- `SUSPENDED_DATA_QUALITY`

A scenario contains:
- thesis and supporting evidence;
- contradictions;
- activation conditions;
- invalidation conditions;
- source level clusters and reaction events;
- target sequence;
- estimated horizon/range and method;
- required intermarket confirmation (if any);
- source snapshot fingerprints;
- lifecycle events.

Targets can derive from:
- confirmed higher-timeframe swings;
- level clusters and liquidity references;
- prior period/session levels with verified calendar semantics;
- displacement zones;
- Donchian/range boundaries;
- ATR/range expansion projections.

Every displayed target must be traceable to source bars and a named method. Time-to-target starts as a qualitative/range estimate and must be based on historical observations before numeric probability is displayed.

No uncalibrated percentage confidence or invented prices.

---

## 9. Automatic monitoring and thesis revision

After manual baseline confirmation:
- monitor new closed bars for each confirmed timeframe;
- update only the affected timeframe and dependent calculations;
- evaluate relevant contextual-market events;
- update level interaction states;
- recompute confluence and scenario state;
- write a diff and append-only transition event.

Origin labels:
- `MANUAL_BASELINE`
- `AUTOMATIC_UPDATE`
- `OPERATOR_RECONFIRMATION`
- `HISTORICAL_REPLAY`

If source data becomes stale, corrected, discontinuous or unavailable:
- suspend affected conclusions;
- preserve the previous snapshot;
- show the reason;
- resume only after exact reconciliation.

No historical snapshot is rewritten. No replay event is presented as a live alert.

---

## 10. Proposed module architecture

Create a single feature boundary under `src/lib/intelligence/`, with independent modules and tests.

```text
src/lib/intelligence/
├── contracts/
│   ├── market-role.schema.ts
│   ├── analysis-snapshot.schema.ts
│   ├── level.schema.ts
│   ├── level-interaction.schema.ts
│   ├── intermarket-observation.schema.ts
│   ├── confluence.schema.ts
│   └── scenario.schema.ts
├── snapshots/
│   ├── chart-snapshot-service.ts
│   ├── source-revision-resolver.ts
│   ├── fingerprint.ts
│   └── validator.ts
├── timeframe/
│   ├── macro-bias-engine.ts
│   ├── structure-analysis.ts
│   ├── regime-analysis.ts
│   ├── liquidity-analysis.ts
│   └── entry-timing-engine.ts
├── levels/
│   ├── sources/
│   ├── level-normalizer.ts
│   ├── level-cluster-engine.ts
│   ├── level-ranking.ts
│   ├── interaction-detector.ts
│   ├── interaction-state-machine.ts
│   └── magnet-barrier-classifier.ts
├── intermarket/
│   ├── market-role-registry.ts
│   ├── synchronization.ts
│   ├── relationship-engine.ts
│   ├── divergence-engine.ts
│   ├── lead-lag-analysis.ts
│   ├── reaction-correlator.ts
│   └── regime-conditioner.ts
├── confluence/
│   ├── confluence-engine.ts
│   ├── conflict-resolver.ts
│   └── explanation-builder.ts
├── scenarios/
│   ├── scenario-generator.ts
│   ├── scenario-state-machine.ts
│   ├── target-engine.ts
│   ├── invalidation-engine.ts
│   └── horizon-estimator.ts
├── monitoring/
│   ├── closed-bar-trigger.ts
│   ├── dependency-graph.ts
│   ├── thesis-reconciler.ts
│   └── stale-analysis-detector.ts
└── validation/
    ├── causal-asof.ts
    ├── historical-replay.ts
    ├── golden-day-evaluator.ts
    ├── calibration.ts
    └── robustness.ts

src/components/workstation/
├── multi-timeframe-flow/
├── level-map/
├── intermarket-board/
├── scenario-panel/
└── analysis-history/
```

Domain engines are pure TypeScript where possible. They do not import React, Prisma or provider SDKs. Provider adapters do not import UI. Persistence is handled by repositories. API routes authenticate, validate, call services and serialize typed outputs.

---

## 11. Phased implementation program

### Phase 0 — Unified baseline audit and architecture freeze
- Re-audit parent branch and document exact file/function reuse.
- Map existing chart desk, Analyst, strategy signals, indicators, market structure, displacement zones, replay, live opportunity and data registry.
- Define canonical timeframes and market-role registry.
- Add feature flag and shadow mode.
- Record decisions in ADRs.
- **Gate:** no duplicate engine/data store; contracts typecheck; current suite remains green.

### Phase 1 — Canonical source and snapshot contracts
- Provider/source identity contract.
- Multi-market timestamp and freshness contract.
- Immutable chart snapshot/fingerprint.
- Manual confirmation and revision service.
- User-scoped persistence and authenticated API.
- **Gate:** idempotent repeat, immutable revision, no future bars, invalid/missing source rejected.

### Phase 2 — Existing engine adapters and individual timeframe analysis
- Reuse causal indicators and structure logic.
- Wrap BOS/CHoCH, displacement zones, ATR/volatility, Donchian and existing trend votes.
- Add 1W/1D/4H/1H/15M/5M analysis profiles.
- Add explicit warmup and missing-interval policy.
- **Gate:** deterministic tests, long/short, trend/range, corrections, gaps, warmup.

### Phase 3 — Key-Level Intelligence
- Implement level source adapters and canonical level registry.
- Add verified previous period/session levels; session levels remain disabled/unknown until calendars are verified.
- Add opening range/VWAP only when session and volume semantics permit.
- Add volatility-normalized level clustering.
- Add level reaction state machine and distinct reaction history.
- Add magnet/barrier/decision-zone classification.
- **Gate:** no duplicate inflation, touch/rejection/acceptance/break/reclaim tests, no future reaction leakage.

### Phase 4 — Intermarket market-role registry and data synchronization
- Separate primary markets from contextual drivers.
- Start with VIX and available Nasdaq/gold proxies.
- Add ES/S&P, DXY and yield proxies only after source and cadence certification.
- Add same-time/as-of alignment, max-age rules, session intersection and provider provenance.
- **Gate:** stale/missing/unsynchronized inputs fail closed; proxy identities never merge.

### Phase 5 — Intermarket level-reaction engine
- Run level detection on contextual markets independently.
- Detect VIX level approach/rejection/respect/acceptance/break/reclaim.
- Correlate reaction events with primary-market levels and structure.
- Add rolling relationship, relative strength, divergence and lead/lag descriptors.
- Add regime-conditioned evidence and relationship-stability tests.
- **Gate:** causal event alignment; no assumed fixed inverse correlation; synthetic fixtures and historical replay pass.

### Phase 6 — Unified five-screen workflow
- Screen 1 macro/intermarket.
- Screen 2 4H structure and level map.
- Screen 3 1H setup.
- Screen 4 15M/5M timing.
- Screen 5 unified projection.
- Reuse current workstation chart desk and Analyst board; do not create a separate chart product.
- **Gate:** browser journey, reload, resume, partial confirmation and revision comparison.

### Phase 7 — Unified confluence and bias
- Preserve legacy EMA trend score as a separate component.
- Add structural bias, key-level interaction, intermarket reaction, volatility, event risk, data quality and strategy signal dimensions.
- Add explicit contradiction and missing-evidence handling.
- Shadow compare legacy versus new assessment.
- **Gate:** conflict matrix, no correlated evidence double counting, explanations traceable.

### Phase 8 — Scenario, targets and horizon projection
- Bullish/bearish/neutral scenarios.
- Scenario lifecycle and immutable transitions.
- Targets from actual level clusters, liquidity and structure.
- Invalidation and time-horizon estimator.
- Evidence-grade output; probabilities disabled pending calibration.
- **Gate:** all prices traceable, invalidation monotonic, no unsupported horizon claims.

### Phase 9 — Chart overlays and unified market map
- Render levels, clusters, interactions, intermarket reaction markers and scenario paths.
- Add source/timeframe labels and provenance tooltips.
- Add layer visibility controls.
- Preserve historical versus current status.
- **Gate:** overlay values match persisted snapshots; as-of replay has no future-derived visuals.

### Phase 10 — Automatic monitoring and thesis reconciliation
- Closed-bar update dependency graph.
- Update only affected timeframe/market analyses.
- Reconcile cross-market events.
- Produce thesis diffs and scenario transitions.
- Handle stale feeds, gaps, corrections and restart recovery.
- **Gate:** no duplicate events; stale inputs suspend dependent conclusions; restart/recovery deterministic.

### Phase 11 — Historical replay and golden-day validation
- Causal multi-timeframe replay at each historical decision timestamp.
- Causal intermarket synchronization.
- Golden days: trend, range, high volatility/news, gap/reopen, DST/session edge, VIX level rejection/break and Nasdaq level confluence.
- Hand-annotated expected levels, interactions, scenarios and outcomes.
- Compare replay to forward events.
- **Gate:** no lookahead, golden-day review, stable replay/live behavior.

### Phase 12 — Calibration and robustness
- Scenario outcome definitions and horizons.
- Out-of-sample hit/miss/invalidation/target statistics.
- Calibration and reliability metrics.
- Regime and instrument segmentation.
- Walk-forward and sensitivity analysis.
- Enable numeric probabilities only when sample and calibration gates pass.
- **Gate:** independent out-of-sample evidence; otherwise remain evidence-grade only.

### Phase 13 — Operational certification and release
- Authenticated Playwright E2E.
- Windows startup/status/stop/restart.
- Real provider data and session certification.
- Ten consecutive observation sessions per instrument.
- Resource profiling, persistence recovery and security review.
- Documentation and rollback.
- **Gate:** actual local/provider evidence recorded separately from CI.

---

## 12. Test and agent execution protocol

Every package has:
- pure unit tests;
- boundary/integration tests;
- deterministic fixture replay;
- API authorization/schema tests;
- browser E2E where UI changes;
- regression suite;
- explicit limitations and rollback.

Mandatory market cases:
- all timeframes aligned;
- macro bullish / intermediate bearish;
- macro bearish / intermediate bullish;
- VIX rejection with Nasdaq support;
- VIX break higher with Nasdaq breakdown;
- VIX rejection but Nasdaq fails to respond;
- Nasdaq reaches its own multi-timeframe cluster while VIX is neutral;
- intermarket divergence;
- correlation regime change;
- market closed/stale;
- unsynchronized timestamps;
- missing source instrument;
- provider proxy basis divergence;
- repeated level touch that weakens rather than strengthens the barrier;
- level acceptance then reclaim;
- corrected source candle;
- missing candle interval;
- historical as-of replay.

Every implementation loop must report:

```text
PACKAGE:
STATUS: PASS / BLOCKED / FAIL
FILES CREATED:
FILES MODIFIED:
BEHAVIOR:
UNIT TESTS:
INTEGRATION TESTS:
E2E:
REGRESSION:
CI COMMIT / RUN / URL:
KNOWN LIMITATIONS:
EXTERNAL BLOCKERS:
ROLLBACK:
NEXT PACKAGE:
```

A package is not PASS merely because TypeScript compiles. A failure must be fixed and the relevant tests rerun, followed by full regression.

---

## 13. Critical design invariants

1. One canonical instrument/timeframe/source contract.
2. No conflation of NAS100 CFD with NQ futures or XAUUSD OTC with GC futures.
3. BID and ASK remain separate; no synthetic midpoint candles.
4. All timestamps UTC internally; session semantics require verified calendars.
5. Closed bars drive confirmed analysis and reaction states.
6. Forming bars are provisional.
7. Every analysis has immutable provenance and a decision timestamp.
8. No future candle, future indicator, future level reaction or future cross-market observation may influence a historical decision.
9. No missing/stale data is silently neutral.
10. No level cluster strength from duplicated/correlated references.
11. Repeated tests can weaken a barrier; touch count is not a strength score.
12. Intermarket relationships are conditional, regime-aware and testable, not assumed causal.
13. The LLM may explain deterministic results but cannot set bias, activate a scenario or invent a target.
14. Probabilities require out-of-sample calibration.
15. Risk sizing remains fail-closed until venue economics are verified.
16. No live order routing, fills or positions in this scope.
17. Existing replay/opportunity records remain the source of their respective lifecycle histories.
18. Historical replay discoveries are never presented as alerts that occurred live.

---

## 14. Definition of done

The feature is complete only when:
- all five screens work with partial and complete analysis;
- existing chart layouts and overlays are reused and enhanced;
- all six timeframe engines produce reproducible snapshots;
- key levels are sourced, clustered, ranked and tracked through reaction states;
- intermarket level interactions are synchronized and provenance-aware;
- VIX and other contextual market reactions are conditionally evaluated against Nasdaq/gold structure;
- unified bias preserves component-level agreement and contradiction;
- bullish, bearish and neutral scenarios are explainable and stateful;
- targets and invalidation are traceable to source evidence;
- automatic monitoring updates without rewriting prior analysis;
- historical replay is causal and passes golden-day review;
- probability is disabled unless calibrated;
- browser and local operational gates pass;
- all remaining external limitations are explicitly reported.

## 15. Recommended execution sequence

Start with Phase 0 and Phase 1 on this feature branch, then continue sequentially through the dependency graph. Do not wait until the end to add UI: build the five-screen experience in Phase 6 using the stable contracts and fixture data, while the deeper analytical modules continue to mature.

The first deliverable is not a speculative prediction. It is a unified, reproducible market map that explains:
- the primary instrument's structure;
- the most important nearby price zones;
- how those zones are reacting;
- what related markets are doing at their own levels;
- which scenario that evidence supports;
- what must happen next;
- what invalidates the thesis.
