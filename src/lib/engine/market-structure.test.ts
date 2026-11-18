/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import type { Bar } from "./types";
import {
  buildPreviousAvailableUtcDateLevels,
  buildStructureMarkers,
} from "./market-structure";

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

  test("sorts out-of-order bars and keeps the final duplicate timestamp like the chart", () => {
    const bars = makeBars([
      { high: 10, low: 8, close: 9 },
      { high: 12, low: 8, close: 11 },
      { high: 15, low: 9, close: 14 },
      { high: 12, low: 9, close: 11 },
      { high: 13, low: 8, close: 12 },
      { high: 16, low: 11, close: 16 },
    ]);
    const replacement = { ...bars[2], h: 14, c: 13 };
    const shuffledWithDuplicate = [
      bars[0],
      bars[2],
      bars[1],
      replacement,
      ...bars.slice(3),
    ];
    const chartNormalized = [...bars];
    chartNormalized[2] = replacement;

    expect(buildStructureMarkers(shuffledWithDuplicate, { leftBars: 1, rightBars: 1 }))
      .toEqual(buildStructureMarkers(chartNormalized, { leftBars: 1, rightBars: 1 }));
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


describe("observed prior available UTC date levels", () => {
  const utc = (date: string) => Date.parse(date);

  test("uses the nearest earlier UTC calendar date and its observed high/low", () => {
    const bars: Bar[] = [
      { t: utc("2026-11-15T22:00:00Z"), o: 100, h: 104, l: 99, c: 102, v: 1, ct: utc("2026-11-15T22:14:59Z") },
      { t: utc("2026-11-16T08:00:00Z"), o: 102, h: 110, l: 101, c: 108, v: 1, ct: utc("2026-11-16T08:14:59Z") },
      { t: utc("2026-11-16T12:00:00Z"), o: 108, h: 112, l: 106, c: 109, v: 1, ct: utc("2026-11-16T12:14:59Z") },
      { t: utc("2026-11-17T00:15:00Z"), o: 109, h: 111, l: 107, c: 110, v: 1, ct: utc("2026-11-17T00:29:59Z") },
    ];

    const levels = buildPreviousAvailableUtcDateLevels(bars);
    expect(levels).toEqual({
      sourceDayStartTs: utc("2026-11-16T00:00:00Z"),
      latestDayStartTs: utc("2026-11-17T00:00:00Z"),
      high: 112,
      low: 101,
      firstBarTs: utc("2026-11-16T08:00:00Z"),
      lastBarTs: utc("2026-11-16T12:00:00Z"),
      barsObserved: 2,
    });
  });

  test("uses the previous available date across missing calendar days without fabricating bars", () => {
    const bars: Bar[] = [
      { t: utc("2026-11-13T12:00:00Z"), o: 100, h: 105, l: 98, c: 104, v: 1, ct: utc("2026-11-13T12:14:59Z") },
      { t: utc("2026-11-17T12:00:00Z"), o: 104, h: 108, l: 103, c: 107, v: 1, ct: utc("2026-11-17T12:14:59Z") },
    ];

    const levels = buildPreviousAvailableUtcDateLevels(bars);
    expect(levels?.sourceDayStartTs).toBe(utc("2026-11-13T00:00:00Z"));
    expect(levels?.high).toBe(105);
    expect(levels?.low).toBe(98);
    expect(levels?.barsObserved).toBe(1);
  });

  test("sorting and duplicate timestamps match the chart's final-row-wins rule", () => {
    const base = utc("2026-11-16T09:00:00Z");
    const bars: Bar[] = [
      { t: utc("2026-11-17T10:00:00Z"), o: 102, h: 104, l: 101, c: 103, v: 1, ct: utc("2026-11-17T10:14:59Z") },
      { t: base, o: 100, h: 105, l: 99, c: 101, v: 1, ct: base + STEP - 1 },
      { t: base, o: 101, h: 103, l: 97, c: 99, v: 2, ct: base + STEP - 1 },
    ];

    const levels = buildPreviousAvailableUtcDateLevels(bars);
    expect(levels?.high).toBe(103);
    expect(levels?.low).toBe(97);
    expect(levels?.barsObserved).toBe(1);
  });

  test("returns null without at least two available UTC dates", () => {
    const bars = makeBars([
      { high: 10, low: 8, close: 9 },
      { high: 12, low: 7, close: 11 },
    ]);
    expect(buildPreviousAvailableUtcDateLevels(bars)).toBeNull();
    expect(buildPreviousAvailableUtcDateLevels([])).toBeNull();
  });

  test("future bars on the latest date cannot alter previous-date levels", () => {
    const bars: Bar[] = [
      { t: utc("2026-11-16T08:00:00Z"), o: 100, h: 105, l: 98, c: 104, v: 1, ct: utc("2026-11-16T08:14:59Z") },
      { t: utc("2026-11-17T08:00:00Z"), o: 104, h: 108, l: 103, c: 107, v: 1, ct: utc("2026-11-17T08:14:59Z") },
    ];
    const before = buildPreviousAvailableUtcDateLevels(bars);
    const after = buildPreviousAvailableUtcDateLevels([
      ...bars,
      { t: utc("2026-11-17T16:00:00Z"), o: 107, h: 999, l: 1, c: 108, v: 1, ct: utc("2026-11-17T16:14:59Z") },
    ]);
    expect(after).toEqual(before);
  });
});
