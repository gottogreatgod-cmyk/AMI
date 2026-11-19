/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import { evaluateClosedBar, hasHtfWarmup, htfStateAt, runBacktest } from "./backtest";
import type { Bar, StrategyConfig } from "./types";

const BAR_MS = 15 * 60_000;

function risingBars(count: number): Bar[] {
  return Array.from({ length: count }, (_, i) => {
    const t = i * BAR_MS;
    const close = 100 + i;
    return {
      t,
      o: close - 0.1,
      h: close + 0.2,
      l: close - 0.2,
      c: close,
      v: 1,
      ct: t + BAR_MS - 1,
    };
  });
}

function config(withHtf = false): StrategyConfig {
  return {
    key: "test-donchian",
    name: "Test Donchian",
    description: "Deterministic fixture for regression tests.",
    family: "test",
    timeframe: "15m",
    direction: "long",
    entry: { kind: "donchian-break", lookback: 2 },
    exit: { takeR: null, trailAtr: null },
    risk: {
      riskPerTrade: 0.01,
      leverageCap: 3,
      stopAtr: 100,
      sizeMode: "risk",
    },
    costs: { feeBpsPerSide: 0, slipBpsPerSide: 0 },
    htf: withHtf ? { tf: "1h", type: "ema-trend", fast: 2, slow: 3 } : null,
    atrPeriod: 2,
    warmupBars: 2,
  };
}

describe("canonical live/backtest signal evaluation", () => {
  test("evaluates only the requested closed bar and ignores future bars", () => {
    const bars = risingBars(8);
    const cfg = config();
    const atIndex = evaluateClosedBar(bars, 3, cfg);
    const withFutureExtreme = [
      ...bars,
      {
        ...bars[7],
        t: bars[7].t + BAR_MS,
        ct: bars[7].ct + BAR_MS,
        h: 50_000,
        l: -50_000,
        c: 49_999,
      },
    ];

    expect(atIndex.signal).toBe(1);
    expect(evaluateClosedBar(withFutureExtreme, 3, cfg).signal).toBe(atIndex.signal);
    expect(evaluateClosedBar(bars, -1, cfg).signal).toBe(0);
    expect(Number.isNaN(evaluateClosedBar(bars, bars.length, cfg).atr)).toBe(true);
  });

  test("backtest fills a closed-bar signal at the following bar open", () => {
    const bars = risingBars(36);
    const cfg = config();
    const output = runBacktest(
      "TEST",
      "15m",
      bars,
      null,
      cfg,
      { feeBpsPerSide: 0, slipBpsPerSide: 0, mmr: 0.005 },
      10_000
    );

    expect(output.diagnostics.insufficientData).toBe(false);
    expect(output.trades.length).toBeGreaterThan(0);
    expect(output.trades[0].entryTs).toBe(bars[4].t);
    expect(output.trades[0].entryPrice).toBe(bars[4].o);
    expect(output.trades[0].exitReason).toBe("end-of-data");
  });
});

describe("higher-timeframe safety", () => {
  test("HTF state lookup never reads a bar before its close", () => {
    const states = { closeTs: [100, 200], state: [1, -1] };
    expect(htfStateAt(states, 99)).toBe(0);
    expect(htfStateAt(states, 199)).toBe(1);
    expect(htfStateAt(states, 200)).toBe(-1);
  });

  test("HTF warmup requires the full closed-bar count", () => {
    const cfg = config(true);
    const htfBars: Bar[] = Array.from({ length: 5 }, (_, i) => ({
      t: i * 3_600_000,
      o: 100,
      h: 101,
      l: 99,
      c: 100 + i,
      v: 1,
      ct: (i + 1) * 3_600_000 - 1,
    }));

    expect(hasHtfWarmup(htfBars, cfg, htfBars[3].ct)).toBe(false);
    expect(hasHtfWarmup(htfBars, cfg, htfBars[4].ct)).toBe(true);
  });

  test("a missing configured HTF dataset fails closed with zero trades", () => {
    const output = runBacktest(
      "TEST",
      "15m",
      risingBars(36),
      null,
      config(true),
      { feeBpsPerSide: 0, slipBpsPerSide: 0, mmr: 0.005 },
      10_000
    );

    expect(output.diagnostics.insufficientData).toBe(true);
    expect(output.trades).toHaveLength(0);
  });
});
