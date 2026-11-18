/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import { createStructureBreakRetestMachine } from "../replay/detectors/structure-break-retest-detector";
import {
  fingerprintForwardBar,
  processForwardClosedBars,
  type ForwardBar,
  type ForwardCursor,
} from "./live-opportunity-processor";

function makeBars(count: number, start = Date.parse("2026-11-18T09:00:00.000Z")): ForwardBar[] {
  return Array.from({ length: count }, (_, index) => {
    const t = start + index * 60_000;
    const c = 2600 + index;
    return {
      t, ct: t + 59_999, o: c - 0.2, h: c + 0.5,
      l: c - 0.5, c, v: 10, forming: false,
    };
  });
}

function emptyCursor(): ForwardCursor {
  return {
    state: null,
    barsProcessedCount: 0,
    lastProcessedBarTs: null,
    lastProcessedBarCloseTs: null,
    lastProcessedBarFingerprint: null,
  };
}

function machine() {
  return createStructureBreakRetestMachine({
    leftBars: 1, rightBars: 1, maxBarsAfterBreak: 4, maxBarsAfterRetest: 3,
  });
}

describe("forward live closed-bar processor", () => {
  test("seeds a new cursor from closed bars and labels emitted events as bootstrap context", () => {
    const bars = makeBars(8);
    const result = processForwardClosedBars({
      cursor: emptyCursor(),
      bars,
      machine: machine(),
      instrumentId: "XAUUSD-DUKA",
      timeframe: "m1",
      timeframeMs: 60_000,
    });

    expect(result.status).toBe("BOOTSTRAPPED");
    expect(result.processedBars).toBe(8);
    expect(result.lastProcessedBarTs).toBe(bars[7].t);
    expect(result.events.every((event) => event.origin === "LIVE_BOOTSTRAP")).toBe(true);
  });

  test("processes only new closed bars and never processes forming bars", () => {
    const bars = makeBars(8);
    const seeded = processForwardClosedBars({
      cursor: emptyCursor(), bars, machine: machine(),
      instrumentId: "XAUUSD-DUKA", timeframe: "m1", timeframeMs: 60_000,
    });
    const nextBar = makeBars(1, bars[7].t + 60_000)[0];
    const forming = { ...makeBars(1, nextBar.t + 60_000)[0], forming: true };
    const next = processForwardClosedBars({
      cursor: {
        state: seeded.state,
        barsProcessedCount: seeded.barsProcessedCount,
        lastProcessedBarTs: seeded.lastProcessedBarTs,
        lastProcessedBarCloseTs: seeded.lastProcessedBarCloseTs,
        lastProcessedBarFingerprint: seeded.lastProcessedBarFingerprint,
      },
      bars: [...bars.slice(-7), nextBar, forming],
      machine: machine(),
      instrumentId: "XAUUSD-DUKA",
      timeframe: "m1",
      timeframeMs: 60_000,
    });

    expect(next.status).toBe("PROCESSED");
    expect(next.processedBars).toBe(1);
    expect(next.lastProcessedBarTs).toBe(nextBar.t);
    expect(next.events.every((event) => event.origin === "LIVE_MONITOR")).toBe(true);
  });

  test("is idempotent when snapshot repeats already processed bars", () => {
    const bars = makeBars(8);
    const seeded = processForwardClosedBars({
      cursor: emptyCursor(), bars, machine: machine(),
      instrumentId: "XAUUSD-DUKA", timeframe: "m1", timeframeMs: 60_000,
    });
    const cursor = {
      state: seeded.state,
      barsProcessedCount: seeded.barsProcessedCount,
      lastProcessedBarTs: seeded.lastProcessedBarTs,
      lastProcessedBarCloseTs: seeded.lastProcessedBarCloseTs,
      lastProcessedBarFingerprint: seeded.lastProcessedBarFingerprint,
    };
    const result = processForwardClosedBars({
      cursor, bars: bars.slice(-8), machine: machine(),
      instrumentId: "XAUUSD-DUKA", timeframe: "m1", timeframeMs: 60_000,
    });
    expect(result.status).toBe("NO_NEW_BARS");
    expect(result.events).toHaveLength(0);
  });

  test("blocks an unclassified gap instead of skipping a missed candle", () => {
    const bars = makeBars(8);
    const seeded = processForwardClosedBars({
      cursor: emptyCursor(), bars, machine: machine(),
      instrumentId: "XAUUSD-DUKA", timeframe: "m1", timeframeMs: 60_000,
    });
    const afterGap = makeBars(1, bars[7].t + 2 * 60_000)[0];
    const result = processForwardClosedBars({
      cursor: {
        state: seeded.state,
        barsProcessedCount: seeded.barsProcessedCount,
        lastProcessedBarTs: seeded.lastProcessedBarTs,
        lastProcessedBarCloseTs: seeded.lastProcessedBarCloseTs,
        lastProcessedBarFingerprint: seeded.lastProcessedBarFingerprint,
      },
      bars: [...bars.slice(-7), afterGap],
      machine: machine(),
      instrumentId: "XAUUSD-DUKA",
      timeframe: "m1",
      timeframeMs: 60_000,
    });
    expect(result.status).toBe("GAP_UNRECONCILED");
    expect(result.processedBars).toBe(0);
    expect(result.lastProcessedBarTs).toBe(bars[7].t);
  });

  test("blocks revisions that modify an already-processed candle", () => {
    const bars = makeBars(8);
    const seeded = processForwardClosedBars({
      cursor: emptyCursor(), bars, machine: machine(),
      instrumentId: "XAUUSD-DUKA", timeframe: "m1", timeframeMs: 60_000,
    });
    const revised = bars.slice(-8).map((bar) => ({ ...bar }));
    revised[7] = { ...revised[7], c: revised[7].c + 0.1 };
    const result = processForwardClosedBars({
      cursor: {
        state: seeded.state,
        barsProcessedCount: seeded.barsProcessedCount,
        lastProcessedBarTs: seeded.lastProcessedBarTs,
        lastProcessedBarCloseTs: seeded.lastProcessedBarCloseTs,
        lastProcessedBarFingerprint: seeded.lastProcessedBarFingerprint,
      },
      bars: revised,
      machine: machine(),
      instrumentId: "XAUUSD-DUKA",
      timeframe: "m1",
      timeframeMs: 60_000,
    });
    expect(result.status).toBe("GAP_UNRECONCILED");
  });


  test("labels bars replayed from a recovered history as LIVE_RECOVERY, not LIVE_MONITOR", () => {
    const bars = makeBars(8);
    const seeded = processForwardClosedBars({
      cursor: emptyCursor(), bars: bars.slice(0, 7), machine: machine(),
      instrumentId: "XAUUSD-DUKA", timeframe: "m1", timeframeMs: 60_000,
    });
    const recoveryBar = bars[7];
    const recovered = processForwardClosedBars({
      cursor: {
        state: seeded.state,
        barsProcessedCount: seeded.barsProcessedCount,
        lastProcessedBarTs: seeded.lastProcessedBarTs,
        lastProcessedBarCloseTs: seeded.lastProcessedBarCloseTs,
        lastProcessedBarFingerprint: seeded.lastProcessedBarFingerprint,
      },
      bars,
      machine: machine(),
      instrumentId: "XAUUSD-DUKA",
      timeframe: "m1",
      timeframeMs: 60_000,
      processingOrigin: "LIVE_RECOVERY",
    });

    expect(recovered.status).toBe("PROCESSED");
    expect(recovered.lastProcessedBarTs).toBe(recoveryBar.t);
    expect(recovered.events.every((event) => event.origin === "LIVE_RECOVERY")).toBe(true);
  });

  test("fingerprint is deterministic for exact bar content", () => {
    const bar = makeBars(1)[0];
    expect(fingerprintForwardBar(bar)).toBe(fingerprintForwardBar({ ...bar }));
  });
});
