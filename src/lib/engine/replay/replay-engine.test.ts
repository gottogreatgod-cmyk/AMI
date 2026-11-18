/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import type { Bar } from "../types";
import {
  ReplayValidationError,
  runHistoricalReplay,
  type ReplayMachine,
  type ReplaySourceIdentity,
} from "./replay-engine";

const source: ReplaySourceIdentity = {
  provider: "fixture",
  sourceId: "golden-fixture-xau",
  dataClass: "OTC_SPOT_METAL",
  revisionId: "fixture-r1",
  revisionHash: "sha256:fixture",
};

function makeBars(count: number): Bar[] {
  const start = Date.parse("2026-11-18T09:00:00.000Z");
  return Array.from({ length: count }, (_, index) => {
    const t = start + index * 60_000;
    const close = 2_600 + index;
    return {
      t,
      ct: t + 59_999,
      o: close - 0.2,
      h: close + 0.8,
      l: close - 0.8,
      c: close,
      v: 10 + index,
    };
  });
}

function baseRequest<State>(bars: Bar[], machine: ReplayMachine<State>) {
  return {
    instrumentId: "XAUUSD-DUKA",
    timeframe: "m1",
    source,
    interval: {
      fromTs: bars[3].t,
      toTs: bars[5].t,
    },
    warmupBars: 2,
    paramsHash: "params-v1",
    engineVersion: "replay-test-1",
    bars,
    machine,
  };
}

describe("deterministic historical replay engine", () => {
  test("steps in chronological order with only the current closed bar exposed", () => {
    const bars = makeBars(8);
    const seen: number[] = [];
    const machine: ReplayMachine<number> = {
      detectorId: "prefix-audit",
      detectorVersion: "1",
      createInitialState: () => 0,
      onClosedBar: (state, context) => {
        expect(context.barsProcessedBeforeDecision).toBe(context.barIndex);
        seen.push(context.bar.t);
        return { state: state + 1 };
      },
    };

    const result = runHistoricalReplay(baseRequest(bars, machine));
    expect(seen).toEqual(bars.slice(1, 6).map((bar) => bar.t));
    expect(result.evaluatedBars).toBe(3);
    expect(result.warmupBarsUsed).toBe(2);
  });

  test("records occurrence separately from the earliest closed-bar discovery", () => {
    const bars = makeBars(8);
    const machine: ReplayMachine<number> = {
      detectorId: "delayed-confirmation",
      detectorVersion: "2",
      createInitialState: () => 0,
      onClosedBar: (state, context) => ({
        state: state + 1,
        events: context.inRequestedRange && context.barIndex === 3
          ? [{
              setupKey: "swing-setup-1",
              eventKey: "FORMING",
              type: "FORMING",
              occurredAtTs: bars[2].t,
              reason: "Swing became confirmable at this close.",
              evidence: [{ code: "right-side-confirmation", value: 2, sourceBarTs: context.bar.t }],
            }]
          : [],
      }),
    };

    const result = runHistoricalReplay(baseRequest(bars, machine));
    expect(result.events).toHaveLength(1);
    expect(result.events[0].occurredAtTs).toBe(bars[2].t);
    expect(result.events[0].discoveredAtTs).toBe(bars[3].ct);
    expect(result.events[0].origin).toBe("HISTORICAL_REPLAY");
  });

  test("is deterministic for identical bars and provenance", () => {
    const bars = makeBars(8);
    const machine: ReplayMachine<number> = {
      detectorId: "deterministic",
      detectorVersion: "1",
      createInitialState: () => 0,
      onClosedBar: (_state, context) => ({
        state: 0,
        events: context.inRequestedRange && context.barIndex === 4
          ? [{
              setupKey: "setup-x",
              eventKey: "ARMED",
              type: "ARMED",
              reason: "Fixture setup armed.",
            }]
          : [],
      }),
    };
    const request = baseRequest(bars, machine);
    expect(runHistoricalReplay(request)).toEqual(runHistoricalReplay(request));
  });

  test("does not emit earlier results differently when later future bars change", () => {
    const original = makeBars(8);
    const altered = makeBars(8);
    altered[7] = { ...altered[7], h: altered[7].h + 1_000 };
    const makeMachine = (): ReplayMachine<number> => ({
      detectorId: "future-invariance",
      detectorVersion: "1",
      createInitialState: () => 0,
      onClosedBar: (_state, context) => ({
        state: 0,
        events: context.inRequestedRange
          ? [{
              setupKey: "s-" + context.barIndex,
              eventKey: "OBSERVED",
              type: "OBSERVED",
              reason: "Observed on current close.",
            }]
          : [],
      }),
    });

    const first = runHistoricalReplay(baseRequest(original, makeMachine()));
    const second = runHistoricalReplay(baseRequest(altered, makeMachine()));
    expect(first.events).toEqual(second.events);
  });

  test("rejects future-dated event occurrence and future-dated evidence", () => {
    const bars = makeBars(8);
    const machine: ReplayMachine<number> = {
      detectorId: "causality-guard",
      detectorVersion: "1",
      createInitialState: () => 0,
      onClosedBar: (_state, context) => ({
        state: 0,
        events: context.inRequestedRange && context.barIndex === 3
          ? [{
              setupKey: "bad",
              eventKey: "BAD",
              type: "BAD",
              occurredAtTs: bars[7].ct,
              reason: "Invalid future event.",
            }]
          : [],
      }),
    };

    expect(() => runHistoricalReplay(baseRequest(bars, machine))).toThrow(ReplayValidationError);
  });

  test("rejects insufficient warmup and duplicate/out-of-order bars", () => {
    const bars = makeBars(8);
    const emptyMachine: ReplayMachine<number> = {
      detectorId: "empty",
      detectorVersion: "1",
      createInitialState: () => 0,
      onClosedBar: (state) => ({ state, events: [] }),
    };

    expect(() => runHistoricalReplay({
      ...baseRequest(bars, emptyMachine),
      warmupBars: 4,
    })).toThrow("only 3 bars precede");

    const duplicate = [...bars];
    duplicate[4] = { ...duplicate[4], t: duplicate[3].t };
    expect(() => runHistoricalReplay(baseRequest(duplicate, emptyMachine))).toThrow(
      ReplayValidationError
    );
  });
});
