/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import type { Bar } from "./types";
import { buildStructureMarkers } from "./market-structure";

const STEP = 60_000;

function makeBars(
  values: Array<{ high: number; low: number; close: number }>
): Bar[] {
  return values.map((value, index) => ({
    t: index * STEP,
    o: value.close,
    h: value.high,
    l: value.low,
    c: value.close,
    v: 1,
    ct: (index + 1) * STEP - 1,
  }));
}

describe("causal market structure markers", () => {
  test("does not expose a swing before the right-side confirmation bars close", () => {
    const bars = makeBars([
      { high: 10, low: 8, close: 9 },
      { high: 12, low: 8, close: 11 },
      { high: 15, low: 9, close: 14 },
      { high: 12, low: 8, close: 11 },
      { high: 13, low: 9, close: 12 },
      { high: 16, low: 11, close: 16 },
    ]);

    expect(buildStructureMarkers(bars.slice(0, 3), { leftBars: 1, rightBars: 1 })).toEqual([]);
    const markers = buildStructureMarkers(bars, { leftBars: 1, rightBars: 1 });
    expect(markers).toHaveLength(1);
    expect(markers[0].time).toBe(5 * STEP);
    expect(markers[0].text).toBe("BOS ↑");
  });

  test("labels a break against the established trend as CHoCH", () => {
    const bars = makeBars([
      { high: 10, low: 8, close: 9 },
      { high: 12, low: 8, close: 11 },
      { high: 15, low: 9, close: 14 },
      { high: 12, low: 9, close: 11 },
      { high: 13, low: 8, close: 12 },
      { high: 16, low: 11, close: 16 },
      { high: 14, low: 12, close: 13 },
      { high: 12, low: 10, close: 11 },
      { high: 11, low: 7, close: 7.5 },
    ]);

    const markers = buildStructureMarkers(bars, { leftBars: 1, rightBars: 1 });
    expect(markers.map((marker) => marker.text)).toEqual(["BOS ↑", "CHoCH ↓"]);
    expect(markers[1].time).toBe(8 * STEP);
  });

  test("future bars cannot alter markers that were already confirmed", () => {
    const bars = makeBars([
      { high: 10, low: 8, close: 9 },
      { high: 12, low: 8, close: 11 },
      { high: 15, low: 9, close: 14 },
      { high: 12, low: 9, close: 11 },
      { high: 13, low: 9, close: 12 },
      { high: 16, low: 11, close: 16 },
    ]);
    const before = buildStructureMarkers(bars, { leftBars: 1, rightBars: 1 });
    const extended = [
      ...bars,
      ...makeBars([
        { high: 14, low: 12, close: 13 },
        { high: 13, low: 10, close: 11 },
      ]).map((bar, index) => ({
        ...bar,
        t: (bars.length + index) * STEP,
        ct: (bars.length + index + 1) * STEP - 1,
      })),
    ];
    const after = buildStructureMarkers(extended, { leftBars: 1, rightBars: 1 });
    expect(after.slice(0, before.length)).toEqual(before);
  });

  test("equal highs/lows are not accepted as unique pivots", () => {
    const bars = makeBars([
      { high: 10, low: 8, close: 9 },
      { high: 12, low: 8, close: 11 },
      { high: 15, low: 9, close: 14 },
      { high: 15, low: 9, close: 14 },
      { high: 13, low: 10, close: 12 },
      { high: 16, low: 11, close: 16 },
    ]);
    expect(buildStructureMarkers(bars, { leftBars: 1, rightBars: 1 })).toEqual([]);
  });

  test("invalid options and insufficient history return no markers", () => {
    const bars = makeBars([{ high: 2, low: 1, close: 1.5 }]);
    expect(buildStructureMarkers(bars)).toEqual([]);
    expect(buildStructureMarkers(bars, { leftBars: 0, rightBars: 1 })).toEqual([]);
    expect(buildStructureMarkers(bars, { leftBars: 1.5, rightBars: 1 })).toEqual([]);
  });
});
