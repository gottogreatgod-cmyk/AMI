/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import {
  classifyMonitorFreshness,
  normalizeMonitorCandles,
  normalizeMonitorTick,
  MONITOR_TIMEFRAME_MS,
} from "./realtime-monitor";

const MINUTE = MONITOR_TIMEFRAME_MS.m1;

describe("experimental Dukascopy monitor normalization", () => {
  test("sorts and deduplicates candles, retaining the last provider row", () => {
    const base = Date.parse("2026-11-17T10:00:00.000Z");
    const result = normalizeMonitorCandles([
      [base + MINUTE, 2001, 2004, 1999, 2003, 15],
      [base, 2000, 2002, 1998, 2001, 10],
      [base + MINUTE, 2001, 2005, 1999, 2004, 18],
    ], MINUTE, base + 4 * MINUTE);

    expect(result.bars.map((bar) => bar.t)).toEqual([base, base + MINUTE]);
    expect(result.bars[1].c).toBe(2004);
    expect(result.bars[1].v).toBe(18);
  });

  test("separates closed and forming candles using the UTC interval close", () => {
    const base = Date.parse("2026-11-17T10:00:00.000Z");
    const now = base + MINUTE + 20_000;
    const result = normalizeMonitorCandles([
      [base, 2000, 2002, 1999, 2001, 10],
      [base + MINUTE, 2001, 2005, 2000, 2004, 15],
    ], MINUTE, now);

    expect(result.closedBars).toHaveLength(1);
    expect(result.closedBars[0].ct).toBe(base + MINUTE - 1);
    expect(result.formingBar?.t).toBe(base + MINUTE);
    expect(result.formingBar?.forming).toBe(true);
  });

  test("rejects malformed OHLC and non-finite values", () => {
    const base = Date.parse("2026-11-17T10:00:00.000Z");
    const result = normalizeMonitorCandles([
      [base, 2000, 1990, 1999, 2001, 10],
      [base + MINUTE, "NaN", 2005, 2000, 2004, 15],
      [base + 2 * MINUTE, 2001, 2005, 2000, 2004, -5],
    ], MINUTE, base + 5 * MINUTE);

    expect(result.bars).toHaveLength(0);
  });

  test("rejects candle opens that are in the future even when within one timeframe", () => {
    const now = 100_000;
    const result = normalizeMonitorCandles([
      [90_000, 2000, 2002, 1999, 2001, 10],
      [120_000, 2001, 2005, 2000, 2004, 15],
    ], MINUTE, now);

    expect(result.bars).toHaveLength(1);
    expect(result.bars[0].t).toBe(90_000);
  });

  test("normalizes two-sided ticks and computes quote spread transparently", () => {
    const tick = normalizeMonitorTick([
      { timestamp: 1000, askPrice: 2001, bidPrice: 2000, askVolume: 2, bidVolume: 3 },
    ]);
    expect(tick?.spread).toBe(1);
    expect(tick?.spreadBps).toBeCloseTo((1 / 2000.5) * 10_000);
    expect(tick?.bidVolume).toBe(3);
  });

  test("rejects inverted or missing tick quotes rather than reordering sides", () => {
    expect(normalizeMonitorTick([{ timestamp: 1000, askPrice: 1999, bidPrice: 2000 }])).toBeNull();
    expect(normalizeMonitorTick([])).toBeNull();
  });

  test("rejects provider ticks beyond the allowed future clock-skew window", () => {
    const now = 100_000;
    expect(normalizeMonitorTick([
      [now + 10_001, 2001, 2000, 1, 1],
    ], now)).toBeNull();
    expect(normalizeMonitorTick([
      [now + 5_000, 2001, 2000, 1, 1],
    ], now)?.timestamp).toBe(now + 5_000);
  });

  test("freshness is explicit and missing ticks are not treated as a zero price", () => {
    expect(classifyMonitorFreshness(null, 100_000, 60_000)).toEqual({
      state: "NO_TICK",
      ageMs: null,
    });
    expect(classifyMonitorFreshness({
      timestamp: 90_000,
      bid: 2000,
      ask: 2001,
      bidVolume: null,
      askVolume: null,
      spread: 1,
      spreadBps: 4.99,
    }, 100_000, 60_000).state).toBe("FRESH");
    expect(classifyMonitorFreshness({
      timestamp: 10_000,
      bid: 2000,
      ask: 2001,
      bidVolume: null,
      askVolume: null,
      spread: 1,
      spreadBps: 4.99,
    }, 100_000, 60_000).state).toBe("STALE");
  });
});
