/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import type { Bar } from "./types";
import { atr, bollinger, donchian, ema, rsi, sma } from "./indicators";

function makeBars(closes: number[]): Bar[] {
  const stepMs = 15 * 60_000;
  return closes.map((c, i) => {
    const t = i * stepMs;
    return {
      t,
      o: c - 0.1,
      h: c + 0.5,
      l: c - 0.5,
      c,
      v: i + 1,
      ct: t + stepMs - 1,
    };
  });
}

describe("causal indicators", () => {
  test("SMA leaves warmup values empty and averages the trailing window", () => {
    const actual = sma([1, 2, 3, 4], 3);
    expect(Number.isNaN(actual[0])).toBe(true);
    expect(Number.isNaN(actual[1])).toBe(true);
    expect(actual[2]).toBe(2);
    expect(actual[3]).toBe(3);
  });

  test("EMA seeds from the first complete SMA window", () => {
    const actual = ema([1, 2, 3, 4], 3);
    expect(Number.isNaN(actual[0])).toBe(true);
    expect(Number.isNaN(actual[1])).toBe(true);
    expect(actual[2]).toBe(2);
    expect(actual[3]).toBe(3);
  });

  test("Wilder ATR is unavailable during warmup and stable on constant true range", () => {
    const actual = atr(makeBars([10, 11, 12, 13]), 2);
    expect(Number.isNaN(actual[0])).toBe(true);
    expect(actual[1]).toBe(1.5);
    expect(actual[2]).toBe(1.5);
    expect(actual[3]).toBe(1.5);
  });

  test("RSI returns the expected extreme for monotonic gains and losses", () => {
    expect(rsi([1, 2, 3, 4], 2)[2]).toBe(100);
    expect(rsi([4, 3, 2, 1], 2)[2]).toBe(0);
  });

  test("Donchian values use only the preceding bars, not the current bar", () => {
    const bars = makeBars([10, 11, 12, 13]);
    const channel = donchian(bars, 2);
    expect(Number.isNaN(channel.upper[1])).toBe(true);
    expect(channel.upper[2]).toBe(11.5);
    expect(channel.lower[2]).toBe(9.5);

    const extended = [...bars, { ...bars[4 - 1], t: bars[3].t + 900_000, ct: bars[3].ct + 900_000, h: 50_000, l: -50_000, c: 49_999 }];
    const extendedChannel = donchian(extended, 2);
    expect(extendedChannel.upper[2]).toBe(channel.upper[2]);
    expect(extendedChannel.lower[2]).toBe(channel.lower[2]);
  });

  test("Bollinger bands are symmetric around the moving average", () => {
    const result = bollinger([1, 2, 3], 3, 2);
    expect(result.mid[2]).toBe(2);
    expect(result.upper[2] - result.mid[2]).toBeCloseTo(result.mid[2] - result.lower[2], 12);
  });
});
