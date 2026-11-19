# AMI market conventions and golden-day registry

**Status:** initial proposal for the first local observation release. The assumptions below are intentionally conservative and are not confirmation of the user's actual broker or execution venue.

## 1. Initial instrument universe

| AMI instrument ID | Data identity | Initial use | Explicit non-equivalence |
|---|---|---|---|
| `XAUUSD-DUKA` | Dukascopy `xauusd`, OTC spot metal | Historical observation and experimental polling | Not COMEX GC/MGC futures |
| `NAS100-DUKA` | Dukascopy `usatechidxusd`, broker CFD | Historical observation and experimental polling | Not CME NQ/MNQ futures |

The local workstation must keep the exact provider instrument and data class attached to every candle, replay event and report. It must not merge the two datasets or relabel NAS100-DUKA as an exchange-traded future.

## 2. Timestamp and bar policy

- Internal time: UTC epoch milliseconds.
- M1 candle timestamp: UTC candle open.
- Candle close timestamp: open + timeframe duration - 1ms for an interval represented as inclusive milliseconds.
- Only closed candles are eligible for structure/replay transitions. A forming candle may be displayed from the polling monitor, but must not trigger a closed-bar event.
- Day Review selects an inclusive UTC calendar-day interval today. This is an operational fallback only; it is not a claim about the instrument's actual trading-day roll.
- Instrument-specific trading-day boundary, session labels, holiday schedule and DST calendar remain UNVERIFIED.

## 3. Quote-side policy

- Historical BID revisions can only be extended with the monitor's BID candles.
- Historical ASK revisions can only be extended with the monitor's ASK candles.
- The latest two-sided quote may show bid, ask and spread as quote metadata.
- Never synthesize midpoint OHLC from separate bid/ask highs and lows.
- Tick volume or provider-reported CFD volume must carry its exact semantics; do not label it centralized exchange traded volume.

## 4. First research detector proposal

The code's initial detector is `structure-break-retest` v1.0.0. Its default parameters are:

| Parameter | Default |
|---|---:|
| Left swing confirmation bars | 3 |
| Right swing confirmation bars | 3 |
| Maximum bars waiting for the retest after a structure break | 12 |
| Maximum bars waiting for a trigger after retest/arming | 8 |

Lifecycle rules:

1. A swing is known only after the configured right-side bars have closed.
2. A close through the most recently confirmed swing creates FORMING (BOS or CHoCH using the previously confirmed direction).
3. A subsequent bar retests the broken level and closes on the breakout side to become ARMED.
4. A later close beyond the retest candle's breakout extreme emits TRIGGERED.
5. A later close beyond the retest candle's opposite extreme emits INVALIDATED.
6. A setup that does not retest/trigger inside its configured bar-count window expires.
7. A new confirmed structure break may supersede an unfinished setup.

This is a deliberately simple, auditable research pattern. It is not validated for profitability, not a fill simulator, and not yet a user-approved trading strategy. Any change requires a new detector version and reviewed golden-day snapshots.

## 5. Golden-day registry template

Do not invent dates or market conditions. Populate this table only after importing and inspecting real data.

| Instrument | UTC date | Case label | Source revision (BID/ASK) | Reference notes | Expected setup/event IDs | Reviewed by |
|---|---|---|---|---|---|---|
| XAUUSD-DUKA | TBD | Trend day | TBD | TBD | TBD | TBD |
| XAUUSD-DUKA | TBD | Range/chop | TBD | TBD | TBD | TBD |
| XAUUSD-DUKA | TBD | High-volatility/news | TBD | TBD | TBD | TBD |
| XAUUSD-DUKA | TBD | Weekend/holiday reopen or gap | TBD | TBD | TBD | TBD |
| XAUUSD-DUKA | TBD | DST/calendar edge | TBD | TBD | TBD | TBD |
| NAS100-DUKA | TBD | Trend day | TBD | TBD | TBD | TBD |
| NAS100-DUKA | TBD | Range/chop | TBD | TBD | TBD | TBD |
| NAS100-DUKA | TBD | High-volatility/news | TBD | TBD | TBD | TBD |
| NAS100-DUKA | TBD | Weekend/holiday reopen or gap | TBD | TBD | TBD | TBD |
| NAS100-DUKA | TBD | DST/calendar edge | TBD | TBD | TBD | TBD |

## 6. Unresolved decisions

| Decision | Safe implementation default until decided | Why it remains open |
|---|---|---|
| Actual broker/venue | Dukascopy quote for research only | User's executable venue may differ |
| Price universe | CFD/OTC spot, not CME futures | Exact product must match intended trading |
| Trading-day roll | UTC calendar day for review only | No verified broker calendar chosen |
| Account currency and risk basis | Risk sizing disabled for these two feeds | Contract economics and FX conversion are unknown |
| User's desired setup vocabulary | Structure-break/retest v1.0.0 is a proposed research baseline | Must be validated against golden days and approved before any trading use |
| Live provider cadence | 60-second polling experiment | Provider endpoint availability, rate limits and terms need live certification |

No risk size, margin requirement, profitability metric or live trading session is to be inferred from the defaults above.
