import type { Bar } from "../types";

export interface ReplaySourceIdentity {
  provider: string;
  sourceId: string;
  dataClass: string;
  revisionId: string;
  revisionHash: string;
}

export interface ReplayEventDraft {
  /** Stable setup identity within this detector/revision. */
  setupKey: string;
  /** Stable event identity within a setup, e.g. FORMING, ARMED, TRIGGERED. */
  eventKey: string;
  type: string;
  /** Actual market-time occurrence. Defaults to the decision bar close. */
  occurredAtTs?: number;
  reason: string;
  evidence?: ReadonlyArray<{
    code: string;
    value?: string | number | boolean | null;
    threshold?: string | number | boolean | null;
    sourceBarTs: number;
  }>;
}

export interface ReplayContext {
  instrumentId: string;
  timeframe: string;
  /** Current closed bar available at this replay cursor. */
  bar: Bar;
  /** Zero-based absolute index in the validated input series. */
  barIndex: number;
  /** Only bars through the current decision bar; future bars are never exposed. */
  barsThroughDecision: readonly Bar[];
  /** Whether this decision bar belongs to the requested visible review interval. */
  inRequestedRange: boolean;
}

export interface ReplayStepResult<State> {
  state: State;
  events?: readonly ReplayEventDraft[];
}

/**
 * A deterministic state machine. It receives one closed bar at a time and
 * may inspect only the prefix ending at that bar. It has no I/O or wall clock.
 */
export interface ReplayMachine<State> {
  detectorId: string;
  detectorVersion: string;
  createInitialState(): State;
  onClosedBar(state: State, context: ReplayContext): ReplayStepResult<State>;
}

export interface ReplayRequest<State> {
  instrumentId: string;
  timeframe: string;
  source: ReplaySourceIdentity;
  interval: { fromTs: number; toTs: number };
  warmupBars: number;
  paramsHash: string;
  engineVersion: string;
  bars: readonly Bar[];
  machine: ReplayMachine<State>;
}

export interface ReplayEvent {
  id: string;
  setupId: string;
  eventKey: string;
  type: string;
  instrumentId: string;
  timeframe: string;
  source: ReplaySourceIdentity;
  detectorId: string;
  detectorVersion: string;
  paramsHash: string;
  engineVersion: string;
  /** Market-time occurrence; can predate confirmation/discovery. */
  occurredAtTs: number;
  /** Earliest closed-bar decision at which this event was observable. */
  discoveredAtTs: number;
  confirmationBarTs: number;
  confirmationBarCloseTs: number;
  reason: string;
  evidence: NonNullable<ReplayEventDraft["evidence"]>;
  origin: "HISTORICAL_REPLAY";
}

export interface ReplayResult {
  runId: string;
  instrumentId: string;
  timeframe: string;
  source: ReplaySourceIdentity;
  detectorId: string;
  detectorVersion: string;
  paramsHash: string;
  engineVersion: string;
  interval: { fromTs: number; toTs: number };
  warmupBarsRequested: number;
  warmupBarsUsed: number;
  inputBars: number;
  evaluatedBars: number;
  events: ReplayEvent[];
  origin: "HISTORICAL_REPLAY";
}

export class ReplayValidationError extends Error {
  readonly code:
    | "INVALID_REQUEST"
    | "INVALID_BAR"
    | "BARS_NOT_CHRONOLOGICAL"
    | "INSUFFICIENT_WARMUP"
    | "INVALID_EVENT"
    | "DUPLICATE_EVENT_ID";

  constructor(
    code: ReplayValidationError["code"],
    message: string
  ) {
    super(message);
    this.name = "ReplayValidationError";
    this.code = code;
  }
}

function validBar(bar: Bar): boolean {
  return [
    bar.t,
    bar.ct,
    bar.o,
    bar.h,
    bar.l,
    bar.c,
    bar.v,
  ].every(Number.isFinite) &&
    bar.t > 0 &&
    bar.ct >= bar.t &&
    bar.o > 0 &&
    bar.h > 0 &&
    bar.l > 0 &&
    bar.c > 0 &&
    bar.v >= 0 &&
    bar.h >= Math.max(bar.o, bar.c, bar.l) &&
    bar.l <= Math.min(bar.o, bar.c, bar.h);
}

function validateRequest<State>(request: ReplayRequest<State>): void {
  if (
    !request.instrumentId.trim() ||
    !request.timeframe.trim() ||
    !request.source.provider.trim() ||
    !request.source.sourceId.trim() ||
    !request.source.dataClass.trim() ||
    !request.source.revisionId.trim() ||
    !request.source.revisionHash.trim() ||
    !request.paramsHash.trim() ||
    !request.engineVersion.trim() ||
    !request.machine.detectorId.trim() ||
    !request.machine.detectorVersion.trim() ||
    !Number.isFinite(request.interval.fromTs) ||
    !Number.isFinite(request.interval.toTs) ||
    request.interval.fromTs <= 0 ||
    request.interval.toTs < request.interval.fromTs ||
    !Number.isInteger(request.warmupBars) ||
    request.warmupBars < 0 ||
    !Array.isArray(request.bars)
  ) {
    throw new ReplayValidationError("INVALID_REQUEST", "Replay identity, interval, warmup or detector fields are invalid.");
  }

  for (let index = 0; index < request.bars.length; index++) {
    const bar = request.bars[index];
    if (!validBar(bar)) {
      throw new ReplayValidationError("INVALID_BAR", "Invalid closed OHLCV bar at input index " + index + ".");
    }
    if (index > 0) {
      const previous = request.bars[index - 1];
      if (bar.t <= previous.t || bar.t <= previous.ct) {
        throw new ReplayValidationError(
          "BARS_NOT_CHRONOLOGICAL",
          "Replay bars must be strictly chronological, non-overlapping and free of duplicate timestamps."
        );
      }
    }
  }
}

function stableIdentity(parts: readonly string[]): string {
  return parts.map((part) => encodeURIComponent(part)).join("|");
}

/**
 * Run an immutable historical replay.
 *
 * The machine is stepped through warmup and requested bars in chronological
 * order. At every step, its context includes only the bars available through
 * the current closed bar. This is the no-lookahead boundary shared with the
 * future live worker.
 */
export function runHistoricalReplay<State>(
  request: ReplayRequest<State>
): ReplayResult {
  validateRequest(request);

  const firstRequestedIndex = request.bars.findIndex((bar) =>
    bar.t >= request.interval.fromTs && bar.t <= request.interval.toTs
  );
  if (firstRequestedIndex < 0) {
    return {
      runId: stableIdentity([
        request.instrumentId,
        request.timeframe,
        request.source.revisionId,
        request.source.revisionHash,
        request.machine.detectorId,
        request.machine.detectorVersion,
        request.paramsHash,
        request.engineVersion,
        String(request.interval.fromTs),
        String(request.interval.toTs),
      ]),
      instrumentId: request.instrumentId,
      timeframe: request.timeframe,
      source: request.source,
      detectorId: request.machine.detectorId,
      detectorVersion: request.machine.detectorVersion,
      paramsHash: request.paramsHash,
      engineVersion: request.engineVersion,
      interval: request.interval,
      warmupBarsRequested: request.warmupBars,
      warmupBarsUsed: 0,
      inputBars: request.bars.length,
      evaluatedBars: 0,
      events: [],
      origin: "HISTORICAL_REPLAY",
    };
  }

  const lastRequestedIndex = request.bars.findLastIndex((bar) =>
    bar.t >= request.interval.fromTs && bar.t <= request.interval.toTs
  );
  const startIndex = firstRequestedIndex - request.warmupBars;
  if (startIndex < 0) {
    throw new ReplayValidationError(
      "INSUFFICIENT_WARMUP",
      "Requested " + request.warmupBars + " warmup bars but only " +
        firstRequestedIndex + " bars precede the review interval."
    );
  }

  let state = request.machine.createInitialState();
  const events: ReplayEvent[] = [];
  const eventIds = new Set<string>();
  let evaluatedBars = 0;

  for (let barIndex = startIndex; barIndex <= lastRequestedIndex; barIndex++) {
    const bar = request.bars[barIndex];
    const inRequestedRange = barIndex >= firstRequestedIndex;
    const step = request.machine.onClosedBar(state, {
      instrumentId: request.instrumentId,
      timeframe: request.timeframe,
      bar,
      barIndex,
      barsThroughDecision: request.bars.slice(0, barIndex + 1),
      inRequestedRange,
    });
    state = step.state;

    if (!inRequestedRange) continue;
    evaluatedBars++;

    for (const draft of step.events ?? []) {
      if (
        !draft.setupKey.trim() ||
        !draft.eventKey.trim() ||
        !draft.type.trim() ||
        !draft.reason.trim()
      ) {
        throw new ReplayValidationError("INVALID_EVENT", "Replay event identity, type and reason are required.");
      }

      const occurredAtTs = draft.occurredAtTs ?? bar.ct;
      if (!Number.isFinite(occurredAtTs) || occurredAtTs <= 0 || occurredAtTs > bar.ct) {
        throw new ReplayValidationError(
          "INVALID_EVENT",
          "Event occurrence cannot be later than the closed-bar decision time."
        );
      }

      const evidence = draft.evidence ?? [];
      if (evidence.some((item) =>
        !item.code.trim() ||
        !Number.isFinite(item.sourceBarTs) ||
        item.sourceBarTs > bar.ct
      )) {
        throw new ReplayValidationError(
          "INVALID_EVENT",
          "Replay evidence must be timestamped no later than the decision bar close."
        );
      }

      const setupId = stableIdentity([
        request.instrumentId,
        request.timeframe,
        request.source.revisionId,
        request.machine.detectorId,
        request.machine.detectorVersion,
        draft.setupKey,
      ]);
      const id = stableIdentity([setupId, draft.eventKey]);
      if (eventIds.has(id)) {
        throw new ReplayValidationError(
          "DUPLICATE_EVENT_ID",
          "Detector emitted a duplicate event identity: " + draft.setupKey + "/" + draft.eventKey
        );
      }
      eventIds.add(id);

      events.push({
        id,
        setupId,
        eventKey: draft.eventKey,
        type: draft.type,
        instrumentId: request.instrumentId,
        timeframe: request.timeframe,
        source: request.source,
        detectorId: request.machine.detectorId,
        detectorVersion: request.machine.detectorVersion,
        paramsHash: request.paramsHash,
        engineVersion: request.engineVersion,
        occurredAtTs,
        discoveredAtTs: bar.ct,
        confirmationBarTs: bar.t,
        confirmationBarCloseTs: bar.ct,
        reason: draft.reason,
        evidence,
        origin: "HISTORICAL_REPLAY",
      });
    }
  }

  const runId = stableIdentity([
    request.instrumentId,
    request.timeframe,
    request.source.revisionId,
    request.source.revisionHash,
    request.machine.detectorId,
    request.machine.detectorVersion,
    request.paramsHash,
    request.engineVersion,
    String(request.interval.fromTs),
    String(request.interval.toTs),
    String(request.warmupBars),
  ]);

  return {
    runId,
    instrumentId: request.instrumentId,
    timeframe: request.timeframe,
    source: request.source,
    detectorId: request.machine.detectorId,
    detectorVersion: request.machine.detectorVersion,
    paramsHash: request.paramsHash,
    engineVersion: request.engineVersion,
    interval: request.interval,
    warmupBarsRequested: request.warmupBars,
    warmupBarsUsed: request.warmupBars,
    inputBars: request.bars.length,
    evaluatedBars,
    events,
    origin: "HISTORICAL_REPLAY",
  };
}
