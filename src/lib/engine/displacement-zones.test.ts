/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import type { Bar } from "./types";
import { buildDisplacementZones } from "./displacement-zones";

const STEP = 60_000;

function bars(values: Array<{
  open: number;
  high: number;
  low: number;
  close: number;
}>): Bar[] {
  return values.map((value, index) => ({
    t: (index + 1) * STEP,
    ct: (index + 2) * STEP - 1,
    o: value.open,
    h: value.high,
    l: value.low,
    c: value.close,
    v: 1,
  }));
}

const settings = {
  atrPeriod: 2,
  baseBars: 2,
  minImpulseBodyAtr: 1,
  maxBaseRangeAtr: 1.5,
};

const demandBase = [
  { open: 100, high: 101, low: 99, close: 100 },
  { open: 100, high: 101, low: 99, close: 100 },
  { open: 100.1, high: 100.6, low: 99.8, close: 100.2 },
  { open: 100.1, high: 100.5, low: 99.9, close: 100.3 },
  { open: 100.3, high: 104.5, low: 100.1, close: 104 },
];

const supplyBase = [
  { open: 100, high: 101, low: 99, close: 100 },
  { open: 100, high: 101, low: 99, close: 100 },
  { open: 100.2, high: 100.6, low: 99.8, close: 100.4 },
  { open: 100.1, high: 100.5, low: 99.9, close: 100.3 },
  { open: 100.3, high: 100.4, low: 96.0, close: 96.5 },
];

describe("causal displacement-origin zones", () => {
  test("creates a demand zone only after a closed bullish displacement beyond the base", () => {
    const source = bars(demandBase);
    const notYetConfirmed = buildDisplacementZones(source.slice(0, 4), settings);
    const confirmed = buildDisplacementZones(source, settings);

    expect(notYetConfirmed).toHaveLength(0);
    expect(confirmed).toHaveLength(1);
    expect(confirmed[0]).toMatchObject({
      direction: "DEMAND",
      status: "ACTIVE",
      lower: 99.8,
      upper: 100.3,
      originStartTs: 3 * STEP,
      confirmedAtTs: 6 * STEP - 1,
      firstRetestTs: null,
      invalidatedTs: null,
      retestCount: 0,
    });
  });

  test("creates a supply zone from a bearish displacement below its base", () => {
    const zones = buildDisplacementZones(bars(supplyBase), settings);
    expect(zones).toHaveLength(1);
    expect(zones[0].direction).toBe("SUPPLY");
    expect(zones[0].status).toBe("ACTIVE");
    expect(zones[0].lower).toBeCloseTo(100.1, 8);
    expect(zones[0].upper).toBe(100.6);
  });

  test("tracks a first retest and subsequent invalidation using later closed bars", () => {
    const extended = bars([
      ...demandBase,
      { open: 104, high: 104.2, low: 100.0, close: 100.1 },
      { open: 100.1, high: 100.2, low: 99.5, close: 99.7 },
    ]);
    const zones = buildDisplacementZones(extended, settings);

    expect(zones).toHaveLength(1);
    expect(zones[0].status).toBe("INVALIDATED");
    expect(zones[0].firstRetestTs).toBe(7 * STEP - 1);
    expect(zones[0].invalidatedTs).toBe(8 * STEP - 1);
    expect(zones[0].retestCount).toBe(1);
  });

  test("future bars can update lifecycle but cannot change a zone's confirmation facts", () => {
    const initial = buildDisplacementZones(bars(demandBase), settings);
    const extended = buildDisplacementZones(bars([
      ...demandBase,
      { open: 104, high: 104.2, low: 100.0, close: 100.1 },
      { open: 100.1, high: 100.2, low: 99.5, close: 99.7 },
    ]), settings);

    expect(extended[0]).toMatchObject({
      id: initial[0].id,
      direction: initial[0].direction,
      lower: initial[0].lower,
      upper: initial[0].upper,
      originStartTs: initial[0].originStartTs,
      originEndTs: initial[0].originEndTs,
      confirmedAtTs: initial[0].confirmedAtTs,
    });
    expect(initial[0].status).toBe("ACTIVE");
    expect(extended[0].status).toBe("INVALIDATED");
  });

  test("sorts and deduplicates input chronologically using final-row-wins semantics", () => {
    const source = bars(demandBase);
    const replacement = { ...source[2], h: 100.45, c: 100.25 };
    const shuffled = [
      source[4],
      source[2],
      source[0],
      source[1],
      replacement,
      source[3],
    ];

    expect(buildDisplacementZones(shuffled, settings))
      .toEqual(buildDisplacementZones(source.map((bar, index) => index === 2 ? replacement : bar), settings));
  });

  test("rejects invalid settings and never emits zones from invalid OHLC", () => {
    expect(buildDisplacementZones(bars(demandBase), { ...settings, baseBars: 0 })).toEqual([]);
    expect(buildDisplacementZones(bars(demandBase), { ...settings, atrPeriod: 1 })).toEqual([]);
    expect(buildDisplacementZones(bars(demandBase), { ...settings, maxZones: 101 })).toEqual([]);

    const invalid = bars(demandBase);
    invalid[3] = { ...invalid[3], h: 98 };
    expect(buildDisplacementZones(invalid, settings)).toHaveLength(0);
  });

  test("does not create a zone when an invalid or missing candle creates a gap", () => {
    const source = bars(demandBase);
    const withMissingBaseCandle = source.filter((_, index) => index !== 3);
    expect(buildDisplacementZones(withMissingBaseCandle, settings)).toEqual([]);
  });

  test("bounds retained zone history to maxZones", () => {
    const source = bars([
      ...demandBase,
      ...supplyBase,
      ...demandBase,
      ...supplyBase,
    ]);
    expect(buildDisplacementZones(source, { ...settings, maxZones: 2 })).toHaveLength(2);
  });
});
