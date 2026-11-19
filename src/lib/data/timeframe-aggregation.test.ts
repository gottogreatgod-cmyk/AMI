/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import { aggregateM1Bars } from "./timeframe-aggregation";
import type { Bar } from "../engine/types";

function minuteBars(count: number, start = Date.parse("2026-11-19T00:00:00.000Z")): Bar[] {
  return Array.from({ length: count }, (_, index) => {
    const t = start + index * 60_000;
    return {
      t,
      ct: t + 59_999,
      o: 100 + index,
      h: 102 + index,
      l: 99 + index,
      c: 101 + index,
      v: index + 1,
    };
  });
}

describe("M1 timeframe aggregation", () => {
  test("aggregates exact UTC-aligned M5 OHLC and explicitly summed source volume", () => {
    const result = aggregateM1Bars({
      bars: minuteBars(10),
      timeframe: "m5",
      volumeSemantics: "PROVIDER_REPORTED",
    });
    expect(result.bars).toHaveLength(2);
    expect(result.bars[0]).toEqual({
      t: Date.parse("2026-11-19T00:00:00.000Z"),
      ct: Date.parse("2026-11-19T00:04:59.999Z"),
      o: 100, h: 106, l: 99, c: 105, v: 15,
    });
    expect(result.bars[1].o).toBe(105);
    expect(result.bars[1].c).toBe(110);
    expect(result.bars[1].v).toBe(40);
    expect(result.outputVolumeSemantics).toBe("SUM_OF_SOURCE_VALUES");
  });

  test("omits incomplete buckets and reports exact missing M1 timestamps", () => {
    const bars = minuteBars(5).filter((bar) => bar.t !== minuteBars(5)[2].t);
    const result = aggregateM1Bars({
      bars,
      timeframe: "m5",
      volumeSemantics: "UNKNOWN",
    });
    expect(result.bars).toHaveLength(0);
    expect(result.incompleteBuckets).toHaveLength(1);
    expect(result.incompleteBuckets[0].missingTimestamps).toEqual([
      Date.parse("2026-11-19T00:02:00.000Z"),
    ]);
    expect(result.outputVolumeSemantics).toBe("UNAVAILABLE");
  });

  test("does not claim unknown volume is zero or sum it as traded volume", () => {
    const result = aggregateM1Bars({
      bars: minuteBars(5),
      timeframe: "m5",
      volumeSemantics: "UNKNOWN",
    });
    expect(result.bars[0].v).toBe(0);
    expect(result.outputVolumeSemantics).toBe("UNAVAILABLE");
    expect(result.volumeSemantics).toBe("UNKNOWN");
  });

  test("rejects duplicate timestamps and invalid OHLC geometry", () => {
    const bars = minuteBars(5);
    expect(() => aggregateM1Bars({
      bars: [...bars, bars[4]],
      timeframe: "m5",
      volumeSemantics: "TICK_COUNT",
    })).toThrow("duplicate");
    const invalid = bars.map((bar) => ({ ...bar }));
    invalid[0].h = 1;
    expect(() => aggregateM1Bars({
      bars: invalid,
      timeframe: "m5",
      volumeSemantics: "UNKNOWN",
    })).toThrow("invalid source candle");
  });

  test("does not merge partial UTC-day buckets", () => {
    const start = Date.parse("2026-11-19T00:01:00.000Z");
    const result = aggregateM1Bars({
      bars: minuteBars(5, start),
      timeframe: "m5",
      volumeSemantics: "UNAVAILABLE",
    });
    expect(result.bars).toHaveLength(0);
    expect(result.incompleteBuckets[0].bucketStartTs).toBe(
      Date.parse("2026-11-19T00:00:00.000Z")
    );
  });
});
