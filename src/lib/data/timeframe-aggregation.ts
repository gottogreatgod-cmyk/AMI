import type { Bar } from "../engine/types";

export type M1VolumeSemantics =
  | "PROVIDER_REPORTED"
  | "TICK_COUNT"
  | "UNKNOWN"
  | "UNAVAILABLE";

export type AggregatedTimeframe = "m5" | "m15" | "m30" | "h1" | "h4" | "d1";

export const AGGREGATED_TIMEFRAME_MS: Record<AggregatedTimeframe, number> = {
  m5: 5 * 60_000,
  m15: 15 * 60_000,
  m30: 30 * 60_000,
  h1: 60 * 60_000,
  h4: 4 * 60 * 60_000,
  d1: 24 * 60 * 60_000,
};

export interface M1AggregationResult {
  timeframe: AggregatedTimeframe;
  bars: Bar[];
  sourceBars: number;
  completeBuckets: number;
  incompleteBuckets: Array<{
    bucketStartTs: number;
    expectedBars: number;
    actualBars: number;
    missingTimestamps: number[];
    reason: string;
  }>;
  volumeSemantics: M1VolumeSemantics;
  outputVolumeSemantics: "SUM_OF_SOURCE_VALUES" | "UNAVAILABLE";
}

function isValidBar(bar: Bar): boolean {
  return [bar.t, bar.ct, bar.o, bar.h, bar.l, bar.c, bar.v].every(Number.isFinite) &&
    bar.t > 0 && bar.ct >= bar.t &&
    bar.o > 0 && bar.h > 0 && bar.l > 0 && bar.c > 0 && bar.v >= 0 &&
    bar.h >= Math.max(bar.o, bar.c, bar.l) &&
    bar.l <= Math.min(bar.o, bar.c, bar.h);
}

/**
 * Deterministically aggregate closed M1 bars into fixed UTC-aligned buckets.
 * Incomplete buckets are reported and omitted; no candle or volume is fabricated.
 * Volume is summed only when its source semantics explicitly permit summation.
 */
export function aggregateM1Bars(input: {
  bars: readonly Bar[];
  timeframe: AggregatedTimeframe;
  volumeSemantics: M1VolumeSemantics;
}): M1AggregationResult {
  const timeframeMs = AGGREGATED_TIMEFRAME_MS[input.timeframe];
  const expectedBars = timeframeMs / 60_000;
  const sorted = input.bars.slice().sort((a, b) => a.t - b.t);
  const buckets = new Map<number, Bar[]>();
  let previousTs: number | null = null;

  for (const bar of sorted) {
    if (!isValidBar(bar)) {
      throw new Error("M1 aggregation rejected an invalid source candle at " + bar.t + ".");
    }
    if (bar.t % 60_000 !== 0 || bar.ct !== bar.t + 59_999) {
      throw new Error("M1 aggregation requires UTC minute-open timestamps and inclusive minute closes.");
    }
    if (previousTs !== null && bar.t === previousTs) {
      throw new Error("M1 aggregation rejected duplicate source timestamps.");
    }
    previousTs = bar.t;

    const bucketStartTs = Math.floor(bar.t / timeframeMs) * timeframeMs;
    const bucket = buckets.get(bucketStartTs) ?? [];
    bucket.push(bar);
    buckets.set(bucketStartTs, bucket);
  }

  const bars: Bar[] = [];
  const incompleteBuckets: M1AggregationResult["incompleteBuckets"] = [];
  const canSumVolume = input.volumeSemantics === "PROVIDER_REPORTED" ||
    input.volumeSemantics === "TICK_COUNT";

  for (const [bucketStartTs, bucket] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    const byTs = new Map(bucket.map((bar) => [bar.t, bar]));
    const missingTimestamps: number[] = [];
    for (let index = 0; index < expectedBars; index++) {
      const expectedTs = bucketStartTs + index * 60_000;
      if (!byTs.has(expectedTs)) missingTimestamps.push(expectedTs);
    }

    if (missingTimestamps.length > 0 || bucket.length !== expectedBars) {
      incompleteBuckets.push({
        bucketStartTs,
        expectedBars,
        actualBars: bucket.length,
        missingTimestamps,
        reason: "Incomplete M1 source bucket; no aggregate candle was emitted.",
      });
      continue;
    }

    const ordered = Array.from({ length: expectedBars }, (_, index) =>
      byTs.get(bucketStartTs + index * 60_000)!
    );
    bars.push({
      t: bucketStartTs,
      ct: bucketStartTs + timeframeMs - 1,
      o: ordered[0].o,
      h: Math.max(...ordered.map((bar) => bar.h)),
      l: Math.min(...ordered.map((bar) => bar.l)),
      c: ordered[ordered.length - 1].c,
      v: canSumVolume ? ordered.reduce((sum, bar) => sum + bar.v, 0) : 0,
    });
  }

  return {
    timeframe: input.timeframe,
    bars,
    sourceBars: sorted.length,
    completeBuckets: bars.length,
    incompleteBuckets,
    volumeSemantics: input.volumeSemantics,
    outputVolumeSemantics: canSumVolume ? "SUM_OF_SOURCE_VALUES" : "UNAVAILABLE",
  };
}
