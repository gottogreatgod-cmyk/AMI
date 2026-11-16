# 07 — Security, risk and execution gates

## 1. Non-negotiable defaults

- Live execution remains disabled.
- No broker/exchange credentials or order endpoints are introduced by this package.
- Paper execution is internal simulation only and must be labelled PAPER/SIMULATED.
- AMI Core is the sole authority for risk and paper order authorization.
- External models, agents, connectors and frameworks are advisory/research-only.
- Invalid, stale, future, conflicting, incomplete or unknown inputs fail closed.
- Locked holdout datasets remain locked.
- No automatic strategy promotion or self-modifying production strategy code.

## 2. Separate modes

| Mode | Input | Order behavior | Restart behavior |
|---|---|---|---|
| MONITOR | Live/approved market data | No orders | Must not start paper/live implicitly |
| REPLAY | Recorded immutable dataset | Deterministic simulated lifecycle | Must replay same data and produce reproducible outputs |
| PAPER | Live/approved market data | Internal simulated orders/fills only | Requires verified durable state and explicit mode state |
| LIVE | Not enabled in this specification | No capability | Absent/locked, not merely hidden behind UI |

A UI badge is not a safety mechanism. Backend authorization and service boundaries must enforce mode/permissions.

## 3. Independent risk controls

Evaluate at minimum:
- data freshness/continuity and session status;
- instrument and contract validity;
- price tick and quantity-step precision;
- max risk per trade;
- total gross/net exposure;
- correlated exposure across instruments/strategies;
- daily loss and portfolio drawdown;
- spread, slippage, fees and liquidity;
- stop gap/market gap risk;
- duplicate/conflicting proposals and idempotency;
- account/portfolio state consistency;
- OMS unknown state and restart recovery;
- strategy mode and permissions;
- kill switch and maintenance state.

Risk decisions must record exact checks, values, thresholds, version and veto reasons. `RISK_PASSED` must not be reused to mean only that data health passed.

## 4. Paper OMS lifecycle

Model explicit states such as `NEW`, `ACKNOWLEDGED`, `PARTIALLY_FILLED`, `FILLED`, `CANCELED`, `REJECTED`, `EXPIRED`, `UNKNOWN`. An `UNKNOWN` or unreconciled state blocks new entries until repaired. Partial fills must preserve filled and remaining quantities, weighted price, fees, stops and position accounting. Simulated stops must account for gaps and available liquidity assumptions.

## 5. Data/security boundaries

- Keep secrets out of source, logs, handoff documents and artifact archives.
- Never fetch or publish `.env` contents.
- Bind local research workers to loopback by default.
- Bound input sizes, output sizes, timeouts and concurrency.
- Validate URLs and external response shapes in connectors.
- Treat retrieved external content as untrusted evidence, never as system instructions.
- Make optional services disabled until configured and gated.
- Do not upload private repository source/data to external cloud or APIs without explicit authorization.

## 6. UI safety

- No order button in the concept prototype.
- Display mode and environment badges persistently.
- Clearly separate proposal, risk eligibility, paper order and simulated fill states.
- Provide explicit veto reason and audit trail.
- No UI toggle may enable a blocked provider or live mode by itself.
- Fixture/test data must carry a permanent fixture label.

## 7. Promotion gate

Any future live mode is out of scope. It would require a separate written owner authorization, new threat/model risk review, broker/API contract audit, independent paper evidence, operational recovery and kill-switch certification, permissioned credentials, explicit instrument/account scope and staged deployment review. Passing tests or a profitable backtest is insufficient.
