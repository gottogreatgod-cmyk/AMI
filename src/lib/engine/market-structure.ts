import type { Bar } from "@/lib/engine/types";

export interface StructureMarker {
  time: number;
  position: "aboveBar" | "belowBar";
  color: string;
  shape: "arrowUp" | "arrowDown";
  text: string;
}

interface ConfirmedLevel {
  price: number;
  broken: boolean;
}

function normalizeStructureBars(input: readonly Bar[]): Bar[] {
  const sorted = [...input]
    .filter((bar) =>
      [bar.t, bar.h, bar.l, bar.c].every(Number.isFinite) &&
      bar.t > 0 &&
      bar.h > 0 &&
      bar.l > 0 &&
      bar.c > 0 &&
      bar.h >= Math.max(bar.l, bar.c) &&
      bar.l <= Math.min(bar.h, bar.c)
    )
    .sort((a, b) => a.t - b.t);

  const byTimestamp = new Map<number, Bar>();
  for (const bar of sorted) byTimestamp.set(bar.t, bar);
  return [...byTimestamp.values()];
}


export interface PriorUtcDateLevels {
  /** UTC midnight of the prior available calendar date. */
  sourceDayStartTs: number;
  /** UTC midnight of the latest available calendar date in the input. */
  latestDayStartTs: number;
  high: number;
  low: number;
  firstBarTs: number;
  lastBarTs: number;
  barsObserved: number;
}

/**
 * Observed high/low from the nearest earlier UTC calendar date present in the
 * closed-bar input. This deliberately does not claim to be an exchange
 * session high/low; provider omissions and holidays are not calendar-filled.
 */
export function buildPreviousAvailableUtcDateLevels(
  bars: readonly Bar[]
): PriorUtcDateLevels | null {
  const chronologicalBars = normalizeStructureBars(bars);
  if (chronologicalBars.length < 2) return null;

  const utcDayStart = (timestamp: number) => {
    const date = new Date(timestamp);
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  };

  const latestDayStartTs = utcDayStart(chronologicalBars[chronologicalBars.length - 1].t);
  const priorDays = chronologicalBars
    .map((bar) => utcDayStart(bar.t))
    .filter((dayStart) => dayStart < latestDayStartTs);
  if (priorDays.length === 0) return null;

  const sourceDayStartTs = Math.max(...priorDays);
  const sourceBars = chronologicalBars.filter(
    (bar) => utcDayStart(bar.t) === sourceDayStartTs
  );
  if (sourceBars.length === 0) return null;

  return {
    sourceDayStartTs,
    latestDayStartTs,
    high: Math.max(...sourceBars.map((bar) => bar.h)),
    low: Math.min(...sourceBars.map((bar) => bar.l)),
    firstBarTs: sourceBars[0].t,
    lastBarTs: sourceBars[sourceBars.length - 1].t,
    barsObserved: sourceBars.length,
  };
}

/**
 * Causal swing-break markers for closed OHLC bars.
 *
 * A pivot at index p becomes available only at p + rightBars, after all
 * right-side confirmation bars have closed. Break markers are stamped on
 * the candle that closes beyond the latest confirmed level; no future bar
 * can move or remove an already emitted marker.
 *
 * This first version intentionally marks structure breaks only (BOS/CHoCH).
 * Supply/demand zones and session VWAP are separate follow-on overlays.
 */
export function buildStructureMarkers(
  bars: readonly Bar[],
  options: { leftBars?: number; rightBars?: number } = {}
): StructureMarker[] {
  const chronologicalBars = normalizeStructureBars(bars);
  const leftBars = options.leftBars ?? 3;
  const rightBars = options.rightBars ?? 3;
  if (
    !Number.isInteger(leftBars) ||
    !Number.isInteger(rightBars) ||
    leftBars < 1 ||
    rightBars < 1 ||
    chronologicalBars.length < leftBars + rightBars + 1
  ) {
    return [];
  }

  let lastHigh: ConfirmedLevel | null = null;
  let lastLow: ConfirmedLevel | null = null;
  let trend: -1 | 0 | 1 = 0;
  const markers: StructureMarker[] = [];

  for (let index = 0; index < chronologicalBars.length; index++) {
    const bar = chronologicalBars[index];
    if (![bar.t, bar.h, bar.l, bar.c].every(Number.isFinite)) continue;
    const previousClose = index > 0 ? chronologicalBars[index - 1].c : bar.c;

    const pivotIndex = index - rightBars;
    if (pivotIndex >= leftBars) {
      const pivot = chronologicalBars[pivotIndex];
      let isSwingHigh = Number.isFinite(pivot.h);
      let isSwingLow = Number.isFinite(pivot.l);

      for (let offset = pivotIndex - leftBars; offset <= pivotIndex + rightBars; offset++) {
        if (offset === pivotIndex) continue;
        const other = chronologicalBars[offset];
        if (!other || !Number.isFinite(other.h) || !Number.isFinite(other.l)) {
          isSwingHigh = false;
          isSwingLow = false;
          break;
        }
        // Equal highs/lows are not unique pivots; suppress ambiguous clusters.
        if (other.h >= pivot.h) isSwingHigh = false;
        if (other.l <= pivot.l) isSwingLow = false;
      }

      if (isSwingHigh) {
        lastHigh = { price: pivot.h, broken: previousClose > pivot.h };
      }
      if (isSwingLow) {
        lastLow = { price: pivot.l, broken: previousClose < pivot.l };
      }
    }

    if (
      lastHigh &&
      !lastHigh.broken &&
      Number.isFinite(previousClose) &&
      previousClose <= lastHigh.price &&
      bar.c > lastHigh.price
    ) {
      const isChangeOfCharacter = trend === -1;
      markers.push({
        time: bar.t,
        position: "aboveBar",
        color: "#4bc39a",
        shape: "arrowUp",
        text: isChangeOfCharacter ? "CHoCH ↑" : "BOS ↑",
      });
      lastHigh.broken = true;
      trend = 1;
    } else if (lastHigh && bar.c > lastHigh.price) {
      // The level was already broken before it could be confirmed. Do not
      // emit a retrospective marker after the fact.
      lastHigh.broken = true;
    }

    if (
      lastLow &&
      !lastLow.broken &&
      Number.isFinite(previousClose) &&
      previousClose >= lastLow.price &&
      bar.c < lastLow.price
    ) {
      const isChangeOfCharacter = trend === 1;
      markers.push({
        time: bar.t,
        position: "belowBar",
        color: "#ef777d",
        shape: "arrowDown",
        text: isChangeOfCharacter ? "CHoCH ↓" : "BOS ↓",
      });
      lastLow.broken = true;
      trend = -1;
    } else if (lastLow && bar.c < lastLow.price) {
      lastLow.broken = true;
    }
  }

  return markers;
}
