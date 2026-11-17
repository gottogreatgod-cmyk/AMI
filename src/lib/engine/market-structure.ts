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
  const leftBars = options.leftBars ?? 3;
  const rightBars = options.rightBars ?? 3;
  if (
    !Number.isInteger(leftBars) ||
    !Number.isInteger(rightBars) ||
    leftBars < 1 ||
    rightBars < 1 ||
    bars.length < leftBars + rightBars + 1
  ) {
    return [];
  }

  let lastHigh: ConfirmedLevel | null = null;
  let lastLow: ConfirmedLevel | null = null;
  let trend: -1 | 0 | 1 = 0;
  const markers: StructureMarker[] = [];

  for (let index = 0; index < bars.length; index++) {
    const bar = bars[index];
    if (![bar.t, bar.h, bar.l, bar.c].every(Number.isFinite)) continue;

    const pivotIndex = index - rightBars;
    if (pivotIndex >= leftBars) {
      const pivot = bars[pivotIndex];
      let isSwingHigh = Number.isFinite(pivot.h);
      let isSwingLow = Number.isFinite(pivot.l);

      for (let offset = pivotIndex - leftBars; offset <= pivotIndex + rightBars; offset++) {
        if (offset === pivotIndex) continue;
        const other = bars[offset];
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
        lastHigh = { price: pivot.h, broken: bar.c > pivot.h };
      }
      if (isSwingLow) {
        lastLow = { price: pivot.l, broken: bar.c < pivot.l };
      }
    }

    const previousClose = index > 0 ? bars[index - 1].c : bar.c;

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
