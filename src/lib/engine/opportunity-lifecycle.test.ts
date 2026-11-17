/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import type { Bar } from "./types";
import {
  createOpportunitySnapshot,
  evaluateOpportunity,
  type OpportunityCandidate,
  type OpportunityGates,
} from "./opportunity-lifecycle";

const STEP = 60_000;
const createdAt = 10 * STEP;

const gates: OpportunityGates = {
  marketFresh: true,
  datasetAllowed: true,
  signalAllowed: true,
  htfAllowed: true,
};

const evidence = [{
  source: "strategy" as const,
  code: "DONCHIAN_BREAK",
  description: "Closed-bar breakout setup with HTF alignment.",
  observedAtTs: createdAt,
}];

function candidate(
  overrides: Partial<OpportunityCandidate> = {}
): OpportunityCandidate {
  return {
    id: "setup-xau-001",
    symbol: "XAUUSD-DUKA",
    timeframe: "15m",
    strategyKey: "donchian-breakout",
    direction: "long",
    triggerPrice: 2050,
    invalidationPrice: 2040,
    nearDistance: 2,
    createdAtTs: createdAt,
    expiresAtTs: createdAt + 12 * STEP,
    evidence,
    ...overrides,
  };
}

function bar(
  index: number,
  values: Partial<Pick<Bar, "o" | "h" | "l" | "c">> = {}
): Bar {
  const close = values.c ?? 2045;
  const t = (index + 1) * STEP;
  return {
    t,
    ct: t + STEP - 1,
    o: values.o ?? close - 0.2,
    h: values.h ?? close + 0.5,
    l: values.l ?? close - 0.5,
    c: close,
    v: 1,
  };
}

function observe(
  snapshot: ReturnType<typeof createOpportunitySnapshot>,
  index: number,
  values: Partial<Pick<Bar, "o" | "h" | "l" | "c">>,
  gateOverrides: Partial<OpportunityGates> = {},
  suppressionReasons: string[] = []
) {
  return evaluateOpportunity(snapshot, {
    bar: bar(index, values),
    gates: { ...gates, ...gateOverrides },
    suppressionReasons,
  });
}

describe("deterministic opportunity lifecycle", () => {
  test("requires timestamped evidence and correctly oriented invalidation", () => {
    expect(() => createOpportunitySnapshot(candidate({ evidence: [] }))).toThrow();
    expect(() => createOpportunitySnapshot(candidate({ invalidationPrice: 2051 }))).toThrow();
    expect(() => createOpportunitySnapshot(candidate({ expiresAtTs: createdAt }))).toThrow();
  });

  test("long candidate advances WATCH -> NEAR_TRIGGER -> TRIGGERED on closed bars", () => {
    let state = createOpportunitySnapshot(candidate());
    state = observe(state, 10, { c: 2047.5, h: 2048, l: 2046 });
    expect(state.status).toBe("WATCH");

    state = observe(state, 11, { c: 2049, h: 2049.5, l: 2048.5 });
    expect(state.status).toBe("NEAR_TRIGGER");

    state = observe(state, 12, { c: 2050.2, h: 2051, l: 2049 });
    expect(state.status).toBe("TRIGGERED");
    expect(state.triggeredAtTs).toBe(13 * STEP - 1);
    expect(state.events.map((event) => event.type)).toEqual([
      "CREATED",
      "NEAR_TRIGGER",
      "TRIGGERED",
    ]);
  });

  test("short candidate uses the inverse trigger and invalidation direction", () => {
    let state = createOpportunitySnapshot(candidate({
      id: "setup-nq-short",
      direction: "short",
      triggerPrice: 20_000,
      invalidationPrice: 20_100,
    }));
    state = observe(state, 10, { c: 20_003, h: 20_010, l: 20_002 });
    expect(state.status).toBe("WATCH");

    state = observe(state, 11, { c: 20_001, h: 20_004, l: 19_999 });
    expect(state.status).toBe("TRIGGERED");
  });

  test("same-bar invalidation wins over a trigger touch", () => {
    const state = createOpportunitySnapshot(candidate());
    const next = observe(state, 10, { o: 2045, h: 2051, l: 2039, c: 2049 });
    expect(next.status).toBe("INVALIDATED");
    expect(next.triggeredAtTs).toBeNull();
    expect(next.invalidatedAtTs).toBe(11 * STEP - 1);
    expect(next.events.at(-1)?.type).toBe("INVALIDATED");
  });

  test("expires without triggering after the configured time window", () => {
    const state = createOpportunitySnapshot(candidate({ expiresAtTs: 11 * STEP - 1 }));
    const next = observe(state, 12, { c: 2049, h: 2049.5, l: 2048.5 });
    expect(next.status).toBe("EXPIRED");
    expect(next.expiredAtTs).toBe(13 * STEP - 1);
  });

  test("stale data suppresses evaluation and a fresh closed bar resumes it", () => {
    let state = createOpportunitySnapshot(candidate());
    state = observe(
      state,
      10,
      { c: 2049, h: 2049.5, l: 2048.5 },
      { marketFresh: false },
      ["MONITOR_STALE"]
    );
    expect(state.status).toBe("SUPPRESSED");
    expect(state.resumeStatus).toBe("WATCH");
    expect(state.suppressionReasons).toEqual(["MONITOR_STALE"]);

    state = observe(state, 11, { c: 2049.5, h: 2049.8, l: 2049.1 });
    expect(state.status).toBe("NEAR_TRIGGER");
    expect(state.resumeStatus).toBeNull();
    expect(state.events.map((event) => event.type)).toEqual([
      "CREATED",
      "SUPPRESSED",
      "RESUMED",
      "NEAR_TRIGGER",
    ]);
  });

  test("HTF and dataset policy gates suppress opportunities with explicit reasons", () => {
    const state = createOpportunitySnapshot(candidate());
    const next = observe(
      state,
      10,
      { c: 2049, h: 2049.5, l: 2048.5 },
      { datasetAllowed: false, htfAllowed: false }
    );
    expect(next.status).toBe("SUPPRESSED");
    expect(next.suppressionReasons).toContain("DATASET_NOT_ELIGIBLE");
    expect(next.suppressionReasons).toContain("HTF_GATE_BLOCKED");
  });

  test("duplicate and out-of-order observations are idempotently ignored", () => {
    const state = createOpportunitySnapshot(candidate());
    const first = observe(state, 10, { c: 2049, h: 2049.5, l: 2048.5 });
    const duplicate = observe(first, 10, { c: 2051, h: 2052, l: 2048 });
    const older = observe(first, 9, { c: 2051, h: 2052, l: 2048 });

    expect(duplicate).toBe(first);
    expect(older).toBe(first);
    expect(first.status).toBe("NEAR_TRIGGER");
    expect(first.events).toHaveLength(2);
  });

  test("terminal opportunities cannot emit duplicate trigger or invalidation events", () => {
    const state = createOpportunitySnapshot(candidate());
    const triggered = observe(state, 11, { c: 2051, h: 2052, l: 2048 });
    const after = observe(triggered, 12, { c: 2030, h: 2055, l: 2020 });

    expect(triggered.status).toBe("TRIGGERED");
    expect(after).toBe(triggered);
    expect(after.events.filter((event) => event.type === "TRIGGERED")).toHaveLength(1);
  });

  test("invalid OHLC bars are rejected instead of updating candidate state", () => {
    const state = createOpportunitySnapshot(candidate());
    const malformed = { ...bar(10), h: 2000 };
    expect(() => evaluateOpportunity(state, {
      bar: malformed,
      gates,
    })).toThrow("valid closed OHLCV");
  });
});
