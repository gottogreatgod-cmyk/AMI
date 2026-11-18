import { createHash } from "node:crypto";
import type { Bar } from "../types";
import type { ReplayEventDraft, ReplayMachine } from "../replay/replay-engine";

export type ForwardEventOrigin = "LIVE_BOOTSTRAP" | "LIVE_MONITOR";
export type ForwardBatchStatus =
  | "BOOTSTRAPPED"
  | "PROCESSED"
  | "NO_NEW_BARS"
  | "NO_BARS"
  | "GAP_UNRECONCILED"
  | "INVALID_BAR";

export interface ForwardBar extends Bar {
  forming?: boolean;
  v: number;
}

export interface ForwardCursor {
  state: unknown;
  barsProcessedCount: number;
  lastProcessedBarTs: number | null;
  lastProcessedBarCloseTs: number | null;
  lastProcessedBarFingerprint: string | null;
}

export interface ForwardEventDraft extends ReplayEventDraft {
  bar: ForwardBar;
  sourceBarFingerprint: string;
  origin: ForwardEventOrigin;
}

export interface ForwardBatchResult<State> {
  status: ForwardBatchStatus;
  reason: string | null;
  state: State;
  barsProcessedCount: number;
  lastProcessedBarTs: number | null;
  lastProcessedBarCloseTs: number | null;
  lastProcessedBarFingerprint: string | null;
  events: ForwardEventDraft[];
  processedBars: number;
}

export function fingerprintForwardBar(bar: ForwardBar): string {
  return createHash("sha256").update(JSON.stringify([
    bar.t, bar.ct, bar.o, bar.h, bar.l, bar.c, bar.v,
  ])).digest("hex");
}

function normalizeClosedBars(input: readonly ForwardBar[]): {
  bars: ForwardBar[];
  error: string | null;
} {
  const bars = input.filter((bar) => bar.forming !== true).slice();
  for (let index = 0; index < bars.length; index++) {
    const bar = bars[index];
    if (
      ![bar.t, bar.ct, bar.o, bar.h, bar.l, bar.c, bar.v].every(Number.isFinite) ||
      bar.t <= 0 || bar.ct < bar.t ||
      bar.o <= 0 || bar.h <= 0 || bar.l <= 0 || bar.c <= 0 || bar.v < 0 ||
      bar.h < Math.max(bar.o, bar.c, bar.l) ||
      bar.l > Math.min(bar.o, bar.c, bar.h)
    ) {
      return { bars: [], error: "An invalid closed candle was received at index " + index + "." };
    }
    if (index > 0 && (
      bar.t <= bars[index - 1].t ||
      bar.t <= bars[index - 1].ct
    )) {
      return { bars: [], error: "Closed candles are duplicated, out of order or overlapping." };
    }
  }
  return { bars, error: null };
}

function invalidResult<State>(
  cursor: ForwardCursor,
  initialState: State,
  reason: string
): ForwardBatchResult<State> {
  return {
    status: "INVALID_BAR",
    reason,
    state: (cursor.state as State | undefined) ?? initialState,
    barsProcessedCount: cursor.barsProcessedCount,
    lastProcessedBarTs: cursor.lastProcessedBarTs,
    lastProcessedBarCloseTs: cursor.lastProcessedBarCloseTs,
    lastProcessedBarFingerprint: cursor.lastProcessedBarFingerprint,
    events: [],
    processedBars: 0,
  };
}

/**
 * Advance one persisted detector state through a bounded live snapshot.
 *
 * First start: seed from the recent closed-bar sample. Emitted events are
 * explicitly LIVE_BOOTSTRAP and must never be presented as alerts delivered
 * in real time. Subsequent starts require a continuous M1 sequence from the
 * last watermark. A missing interval or correction pauses processing.
 */
export function processForwardClosedBars<State>(input: {
  cursor: ForwardCursor;
  bars: readonly ForwardBar[];
  machine: ReplayMachine<State>;
  instrumentId: string;
  timeframe: string;
  timeframeMs: number;
  maxBootstrapBars?: number;
}): ForwardBatchResult<State> {
  const initialState = input.machine.createInitialState();
  const normalized = normalizeClosedBars(input.bars);

  if (!Number.isInteger(input.timeframeMs) || input.timeframeMs <= 0) {
    return invalidResult(input.cursor, initialState, "Invalid timeframe duration.");
  }

  if (normalized.error) {
    return invalidResult(input.cursor, initialState, normalized.error);
  }
  const bars = normalized.bars;

  const isNewCursor = input.cursor.lastProcessedBarTs === null;
  const state = (input.cursor.state as State | undefined) ?? initialState;

  if (bars.length === 0) {
    return {
      status: "NO_BARS",
      reason: "The latest provider snapshot contains no valid closed bars.",
      state,
      barsProcessedCount: input.cursor.barsProcessedCount,
      lastProcessedBarTs: input.cursor.lastProcessedBarTs,
      lastProcessedBarCloseTs: input.cursor.lastProcessedBarCloseTs,
      lastProcessedBarFingerprint: input.cursor.lastProcessedBarFingerprint,
      events: [],
      processedBars: 0,
    };
  }

  if (isNewCursor) {
    const recentBars = bars.slice(-Math.max(1, input.maxBootstrapBars ?? 8));
    let seedStart = 0;
    for (let index = 1; index < recentBars.length; index++) {
      if (recentBars[index].t !== recentBars[index - 1].t + input.timeframeMs) {
        seedStart = index;
      }
    }
    const seedBars = recentBars.slice(seedStart);
    let seededState = initialState;
    let barsProcessedCount = input.cursor.barsProcessedCount;
    const events: ForwardEventDraft[] = [];
    for (const bar of seedBars) {
      const step = input.machine.onClosedBar(seededState, {
        instrumentId: input.instrumentId,
        timeframe: input.timeframe,
        bar,
        barIndex: barsProcessedCount,
        barsProcessedBeforeDecision: barsProcessedCount,
        inRequestedRange: true,
      });
      seededState = step.state;
      const sourceBarFingerprint = fingerprintForwardBar(bar);
      for (const event of step.events ?? []) {
        events.push({
          ...event,
          bar,
          sourceBarFingerprint,
          origin: "LIVE_BOOTSTRAP",
        });
      }
      barsProcessedCount++;
    }
    const last = seedBars[seedBars.length - 1];
    return {
      status: "BOOTSTRAPPED",
      reason: seedStart > 0
        ? "Initial detector context was seeded only from the latest contiguous suffix after an unclassified gap; earlier bars were intentionally excluded. Events are bootstrap context, not live alerts."
        : "Initial detector context was seeded from recent closed bars; events are bootstrap context, not live alerts.",
      state: seededState,
      barsProcessedCount,
      lastProcessedBarTs: last?.t ?? null,
      lastProcessedBarCloseTs: last?.ct ?? null,
      lastProcessedBarFingerprint: last ? fingerprintForwardBar(last) : null,
      events,
      processedBars: seedBars.length,
    };
  }

  const lastTs = input.cursor.lastProcessedBarTs!;
  const watermarkBar = bars.find((bar) => bar.t === lastTs);
  if (watermarkBar && input.cursor.lastProcessedBarFingerprint &&
      fingerprintForwardBar(watermarkBar) !== input.cursor.lastProcessedBarFingerprint) {
    return {
      ...invalidResult(input.cursor, initialState, "The provider changed an already-processed candle. A corrected source revision/replay is required."),
      status: "GAP_UNRECONCILED",
    };
  }

  if (bars[bars.length - 1].t < lastTs) {
    return {
      ...invalidResult(input.cursor, initialState, "Provider snapshot is older than the persisted closed-bar watermark."),
      status: "GAP_UNRECONCILED",
    };
  }

  const nextBars = bars.filter((bar) => bar.t > lastTs);

  if (nextBars.length === 0) {
    return {
      status: "NO_NEW_BARS",
      reason: null,
      state,
      barsProcessedCount: input.cursor.barsProcessedCount,
      lastProcessedBarTs: input.cursor.lastProcessedBarTs,
      lastProcessedBarCloseTs: input.cursor.lastProcessedBarCloseTs,
      lastProcessedBarFingerprint: input.cursor.lastProcessedBarFingerprint,
      events: [],
      processedBars: 0,
    };
  }

  const expectedFirstTs = lastTs + input.timeframeMs;
  if (nextBars[0].t !== expectedFirstTs) {
    return {
      ...invalidResult(
        input.cursor,
        initialState,
        "Unreconciled interval after watermark. Expected " +
          expectedFirstTs + " but first available closed bar is " + nextBars[0].t +
          ". Fetch/inspect missing bars before resuming."
      ),
      status: "GAP_UNRECONCILED",
    };
  }

  for (let i = 1; i < nextBars.length; i++) {
    if (nextBars[i].t !== nextBars[i - 1].t + input.timeframeMs) {
      return {
        ...invalidResult(
          input.cursor,
          initialState,
          "Unclassified gap inside new closed bars between " +
            nextBars[i - 1].t + " and " + nextBars[i].t + "."
        ),
        status: "GAP_UNRECONCILED",
      };
    }
  }

  let nextState = state;
  let barsProcessedCount = input.cursor.barsProcessedCount;
  let lastProcessedBarTs: number | null = input.cursor.lastProcessedBarTs;
  let lastProcessedBarCloseTs: number | null = input.cursor.lastProcessedBarCloseTs;
  let lastProcessedBarFingerprint: string | null = input.cursor.lastProcessedBarFingerprint;
  const events: ForwardEventDraft[] = [];

  for (const bar of nextBars) {
    const step = input.machine.onClosedBar(nextState, {
      instrumentId: input.instrumentId,
      timeframe: input.timeframe,
      bar,
      barIndex: barsProcessedCount,
      barsProcessedBeforeDecision: barsProcessedCount,
      inRequestedRange: true,
    });
    nextState = step.state;
    const sourceBarFingerprint = fingerprintForwardBar(bar);
    for (const event of step.events ?? []) {
      events.push({
        ...event,
        bar,
        sourceBarFingerprint,
        origin: "LIVE_MONITOR",
      });
    }
    barsProcessedCount++;
    lastProcessedBarTs = bar.t;
    lastProcessedBarCloseTs = bar.ct;
    lastProcessedBarFingerprint = sourceBarFingerprint;
  }

  return {
    status: "PROCESSED",
    reason: null,
    state: nextState,
    barsProcessedCount,
    lastProcessedBarTs,
    lastProcessedBarCloseTs,
    lastProcessedBarFingerprint,
    events,
    processedBars: nextBars.length,
  };
}
