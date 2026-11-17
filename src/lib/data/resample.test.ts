/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import type { Bar } from "@/lib/engine/types";
import { detectGaps, resample } from "./resample";

const MINUTE = 60_000;

function bar(index: number, tfMs: number, values: Partial<Bar> = {}): Bar {
  const t = index * tfMs;
  const close = 100 + index;
  return {
    t,
    o: close - 0.25,
    h: close + 0.5,
    l: close - 0.5,
    c: close,
    v: index + 1,
    ct: t + tfMs - 1,
    ...values,
  };
}

describe("causal resampling", () => {
  test("aggregates OHLCV and retains the last constituent close timestamp", () => {
    const source = [bar(0, 15 * MINUTE), bar(1, 15 * MINUTE), bar(2, 15 * MINUTE)];
    const [result] = resample(source, "1h");

    expect(result.t).toBe(0);
    expect(result.o).toBe(source[0].o);
    expect(result.h).toBe(Math.max(...source.map((item) => item.h)));
    expect(result.l).toBe(Math.min(...source.map((item) => item.l)));
    expect(result.c).toBe(source[2].c);
    expect(result.v).toBe(source.reduce((sum, item) => sum + item.v, 0));
    expect(result.ct).toBe(source[2].ct);
  });

  test("emits a partial bucket at its actual final source-bar close", () => {
    const hourly = [bar(0, 60 * MINUTE), bar(1, 60 * MINUTE), bar(3, 60 * MINUTE)];
    const result = resample(hourly, "3h");

    expect(result).toHaveLength(2);
    expect(result[0].t).toBe(0);
    expect(result[0].ct).toBe(hourly[1].ct);
    expect(result[0].c).toBe(hourly[1].c);
    expect(result[1].t).toBe(3 * 60 * MINUTE);
    expect(result[1].ct).toBe(hourly[2].ct);
  });

  test("detects gaps only when spacing exceeds two source timeframes", () => {
    const source = [
      bar(0, 15 * MINUTE),
      bar(1, 15 * MINUTE),
      bar(4, 15 * MINUTE),
      bar(5, 15 * MINUTE),
    ];
    expect(detectGaps(source, "15m")).toBe(1);
  });

  test("empty input remains empty", () => {
    expect(resample([], "1h")).toEqual([]);
  });
});
