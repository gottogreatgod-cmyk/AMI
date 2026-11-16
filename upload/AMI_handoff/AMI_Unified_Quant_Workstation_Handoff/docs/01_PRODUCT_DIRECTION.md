# 01 — Product direction and definition of done

## Mission

Evolve AMI into a local-first, multi-market quantitative research and trading workstation. The system should help the owner understand market state, research competing hypotheses, inspect the provenance of every proposal, measure strategy performance after realistic costs, and operate a paper-only execution lifecycle under one authoritative risk gate.

The product is not defined by the number of indicators, agents, frameworks or generated trades. Its success is the ability to produce reproducible evidence about which hypotheses work, where they work, where they fail, and why.

## The two parallel problems

### A. Strategy quality

Existing modules have generated losing results. This must be treated as a research and measurement problem, not solved by adding more indicators or AI agents. Freeze each existing strategy version, reproduce its runs, inspect rejection/entry/exit geometry, include costs and fills, and register new hypotheses before testing them.

### B. Platform usability

The old page/tab-oriented user experience should be replaced as the primary interaction model by one persistent workstation. The user's main tasks—monitoring charts, metrics, strategy evidence, risk, module health and experiment state—should be reachable without navigating away from the main screen.

The UI redesign must not change strategy semantics or execution permissions.

## Product principles

1. **One source of truth:** AMI owns the instrument registry, canonical market events, feature snapshots, strategy identities, decision proposals, risk decisions, simulated orders/fills/positions and performance ledger.
2. **One risk authority:** AMI Core alone authorizes paper orders and applies portfolio/trade/operational risk constraints.
3. **Adapters, not codebase mergers:** external research engines run behind isolated, versioned contracts.
4. **Evidence before promotion:** every strategy is versioned and evaluated with chronological development/validation/locked-holdout rules and realistic costs.
5. **Failures remain visible:** losing, rejected and inconclusive modules remain queryable with their complete run histories.
6. **Causal data:** a decision may use only information available at the decision time. Use closed bars unless an explicitly registered intrabar experiment is supported by tick/quote data.
7. **Fail closed:** stale, missing, future-dated, conflicting or insufficient data blocks new trade proposals or returns `WATCH`/`NO_TRADE`.
8. **No false confidence:** uncalibrated confidence scores must not be presented as probabilities.
9. **Observable system:** show module status, provider health, latency, provenance, missing data, errors and decision lineage.
10. **Local-first / Windows-native:** preserve the current Windows-native operational constraint; do not introduce WSL or Docker.
11. **Paper-only:** live execution is out of scope and remains locked.
12. **No accidental resource spend:** provider plans, paid data, cloud calls, storage and model weights require explicit cost/resource approval.

## Definition of done

The workstation is considered implemented only when it can:

- Display multiple independent charts from AMI canonical market data with optional synchronized crosshair/time ranges.
- Show the instrument/contract identity and source freshness for every chart.
- Surface core metrics with exact timestamps, units, strategy versions and provenance.
- Display a module graph representing actual registry/dependency/runtime facts rather than static decorative nodes.
- Let the operator inspect a decision's complete lineage from source events through features, agents, fusion, strategy, risk and paper fill.
- Provide research runs that are reproducible and preserve losing results.
- Support verified MNQ/NQ and MGC/GC instrument metadata and futures session/roll logic before strategy evaluation.
- Enforce the same backend paper and risk gates regardless of UI state, browser reload or service restart.
- Pass acceptance criteria in `docs/09_ACCEPTANCE_AND_TEST_PLAN.md`.

A polished dashboard, more connected models or a green test suite alone is not definition of done.
