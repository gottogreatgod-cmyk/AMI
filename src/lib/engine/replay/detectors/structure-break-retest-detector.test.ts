/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import type { Bar } from "../../types";
import { runHistoricalReplay } from "../replay-engine";
import { createStructureBreakRetestMachine } from "./structure-break-retest-detector";

function series(values: Array<{
  high: number;
  low: number;
  close: number;
}>): Bar[] {
  const start = Date.parse("2026-11-18T09:00:00.000Z");
  return values.map((value, index) => {
    const t = start + index * 60_000;
    const open = (value.high + value.low) / 2;
    return {
      t,
      ct: t + 59_999,
      o: open,
      h: value.high,
      l: value.low,
      c: value.close,
      v: 10,
    };
  });
}

const source = {
  provider: "fixture",
  sourceId: "xau-m1-fixture-bid",
  dataClass: "OTC_SPOT_METAL",
  revisionId: "golden-r1",
  revisionHash: "sha256:golden",
};

function replay(bars: Bar[], intervalStartIndex = 0) {
  return runHistoricalReplay({
    instrumentId: "XAUUSD-DUKA",
    timeframe: "m1",
    source,
    interval: {
      fromTs: bars[intervalStartIndex].t,
      toTs: bars[bars.length - 1].t,
    },
    warmupBars: 0,
    paramsHash: "left1-right1-expiry6",
    engineVersion: "replay-test-1",
    bars,
    machine: createStructureBreakRetestMachine({
      leftBars: 1,
      rightBars: 1,
      maxBarsAfterBreak: 6,
      maxBarsAfterRetest: 3,
    }),
  });
}

const base = [
  { high: 11, low: 9, close: 10 },
  { high: 15, low: 10, close: 14 },
  { high: 12, low: 8, close: 11 },
  { high: 17, low: 9, close: 16 },
];

describe("causal structure-break/retest detector", () => {
  test("emits FORMING only when the confirmed swing is actually broken", () => {
    const bars = series([
      { high: 11, low: 9, close: 10 },
      { high: 15, low: 10, close: 14 },
      { high: 12, low: 8, close: 11 },
      { high: 14, low: 9, close: 13 },
      { high: 17, low: 9, close: 16 },
    ]);
    const result = replay(bars);
    const forming = result.events.find((event) => event.type === "FORMING");
    expect(forming).toBeDefined();
    expect(forming?.discoveredAtTs).toBe(bars[4].ct);
    expect(forming?.occurredAtTs).toBe(bars[4].ct);
    expect(forming?.evidence.find((item) => item.code === "broken-swing-high")?.value).toBe(15);
  });

  test("transitions through FORMING, ARMED and TRIGGERED on later closed bars", () => {
    const bars = series([
      ...base,
      { high: 16.5, low: 14.5, close: 15.5 },
      { high: 17, low: 15.2, close: 16.8 },
    ]);
    const result = replay(bars);
    expect(result.events.map((event) => event.type)).toEqual([
      "FORMING",
      "ARMED",
      "TRIGGERED",
    ]);
    expect(result.events[1].discoveredAtTs).toBe(bars[4].ct);
    expect(result.events[2].discoveredAtTs).toBe(bars[5].ct);
  });

  test("invalidation takes precedence over a trigger and remains close-based", () => {
    const bars = series([
      ...base,
      { high: 16.5, low: 14.5, close: 15.5 },
      { high: 16.6, low: 13.8, close: 14.2 },
    ]);
    const result = replay(bars);
    expect(result.events.map((event) => event.type)).toEqual([
      "FORMING",
      "ARMED",
      "INVALIDATED",
    ]);
    expect(result.events[2].reason).toContain("invalidation extreme");
  });

  test("expires an unarmed setup after the configured number of bars", () => {
    const bars = series([
      ...base,
      { high: 18, low: 15.5, close: 17 },
      { high: 18, low: 15.2, close: 16.9 },
      { high: 18, low: 16, close: 17.2 },
      { high: 18.2, low: 16, close: 17.3 },
      { high: 18.3, low: 16.1, close: 17.4 },
      { high: 18.4, low: 16.2, close: 17.5 },
      { high: 18.5, low: 16.3, close: 17.6 },
      { high: 18.6, low: 16.4, close: 17.7 },
    ]);
    const result = replay(bars);
    expect(result.events.map((event) => event.type)).toContain("EXPIRED");
  });

  test("records the later discovery close, not the swing anchor time", () => {
    const bars = series(base);
    const result = replay(bars);
    const forming = result.events.find((event) => event.type === "FORMING");
    const swingEvidence = forming?.evidence.find((item) => item.code === "broken-swing-high");
    const confirmation = forming?.evidence.find((item) => item.code === "swing-confirmed-at");

    expect(swingEvidence?.sourceBarTs).toBe(bars[1].t);
    expect(confirmation?.value).toBe(bars[2].ct);
    expect(forming?.discoveredAtTs).toBe(bars[3].ct);
    expect(forming?.discoveredAtTs).toBeGreaterThan(bars[1].ct);
  });

  test("uses stable event identities across repeated replay", () => {
    const bars = series([
      ...base,
      { high: 16.5, low: 14.5, close: 15.5 },
      { high: 17, low: 15.2, close: 16.8 },
    ]);
    const first = replay(bars);
    const second = replay(bars);
    expect(first).toEqual(second);
  });

  test("rejects invalid detector configuration", () => {
    expect(() => createStructureBreakRetestMachine({ rightBars: 0 })).toThrow();
  });
});
