import type { Bar } from "./types";

export type OpportunityDirection = "long" | "short";
export type OpportunityStatus =
  | "WATCH"
  | "NEAR_TRIGGER"
  | "TRIGGERED"
  | "INVALIDATED"
  | "EXPIRED"
  | "SUPPRESSED";

export type OpportunityEventType =
  | "CREATED"
  | "NEAR_TRIGGER"
  | "RETURNED_TO_WATCH"
  | "TRIGGERED"
  | "INVALIDATED"
  | "EXPIRED"
  | "SUPPRESSED"
  | "RESUMED";

export interface OpportunityEvidence {
  source: "strategy" | "structure" | "displacement-zone" | "analyst" | "manual";
  code: string;
  description: string;
  observedAtTs: number;
}

export interface OpportunityCandidate {
  /** Stable deduplication key for this setup, not a database-generated event ID. */
  id: string;
  symbol: string;
  timeframe: string;
  strategyKey: string;
  direction: OpportunityDirection;
  triggerPrice: number;
  invalidationPrice: number;
  /** Price distance from trigger at which the candidate becomes NEAR_TRIGGER. */
  nearDistance: number;
  createdAtTs: number;
  expiresAtTs: number;
  /** The historical source or evidence context used to create the candidate. */
  datasetId?: string;
  evidence: OpportunityEvidence[];
}

export interface OpportunityGates {
  marketFresh: boolean;
  datasetAllowed: boolean;
  signalAllowed: boolean;
  htfAllowed: boolean;
}

export interface OpportunityObservation {
  /** A closed bar only. Forming candles must not enter this state machine. */
  bar: Bar;
  gates: OpportunityGates;
  suppressionReasons?: string[];
}

export interface OpportunityEvent {
  type: OpportunityEventType;
  fromStatus: OpportunityStatus | null;
  toStatus: OpportunityStatus;
  atTs: number;
  barCloseTs: number | null;
  reason: string;
}

export interface OpportunitySnapshot {
  candidate: OpportunityCandidate;
  status: OpportunityStatus;
  /** State to return to after a transient data/policy suppression. */
  resumeStatus: Exclude<OpportunityStatus, "SUPPRESSED"> | null;
  createdAtTs: number;
  updatedAtTs: number;
  lastProcessedBarCloseTs: number | null;
  triggeredAtTs: number | null;
  invalidatedAtTs: number | null;
  expiredAtTs: number | null;
  suppressionReasons: string[];
  events: OpportunityEvent[];
}

const TERMINAL: ReadonlySet<OpportunityStatus> = new Set([
  "TRIGGERED",
  "INVALIDATED",
  "EXPIRED",
]);

function assertCandidate(candidate: OpportunityCandidate): void {
  if (!candidate.id.trim() || !candidate.symbol.trim() ||
      !candidate.timeframe.trim() || !candidate.strategyKey.trim()) {
    throw new Error("Opportunity id, symbol, timeframe and strategyKey are required.");
  }
  if (
    !Number.isFinite(candidate.createdAtTs) ||
    !Number.isFinite(candidate.expiresAtTs) ||
    candidate.expiresAtTs <= candidate.createdAtTs
  ) {
    throw new Error("Opportunity expiry must be later than its creation timestamp.");
  }
  if (
    !Number.isFinite(candidate.triggerPrice) ||
    !Number.isFinite(candidate.invalidationPrice) ||
    candidate.triggerPrice <= 0 ||
    candidate.invalidationPrice <= 0 ||
    candidate.triggerPrice === candidate.invalidationPrice ||
    !Number.isFinite(candidate.nearDistance) ||
    candidate.nearDistance <= 0
  ) {
    throw new Error("Opportunity trigger, invalidation and near-distance values are invalid.");
  }
  if (
    (candidate.direction === "long" && candidate.invalidationPrice >= candidate.triggerPrice) ||
    (candidate.direction === "short" && candidate.invalidationPrice <= candidate.triggerPrice)
  ) {
    throw new Error("Invalidation must be below a long trigger and above a short trigger.");
  }
  if (
    !Array.isArray(candidate.evidence) ||
    candidate.evidence.length === 0 ||
    candidate.evidence.some((item) =>
      !item.source ||
      !item.code.trim() ||
      !item.description.trim() ||
      !Number.isFinite(item.observedAtTs)
    )
  ) {
    throw new Error("At least one complete, timestamped evidence item is required.");
  }
}

function assertClosedBar(bar: Bar): void {
  if (
    ![bar.t, bar.ct, bar.o, bar.h, bar.l, bar.c, bar.v].every(Number.isFinite) ||
    bar.t <= 0 ||
    bar.ct < bar.t ||
    bar.o <= 0 ||
    bar.h <= 0 ||
    bar.l <= 0 ||
    bar.c <= 0 ||
    bar.v < 0 ||
    bar.h < Math.max(bar.o, bar.c, bar.l) ||
    bar.l > Math.min(bar.o, bar.c, bar.h)
  ) {
    throw new Error("Opportunity observations must contain a valid closed OHLCV bar.");
  }
}

export function createOpportunitySnapshot(
  candidate: OpportunityCandidate
): OpportunitySnapshot {
  assertCandidate(candidate);
  const evidenceSummary = candidate.evidence
    .map((item) => item.source + ":" + item.code)
    .join(", ");

  return {
    candidate: {
      ...candidate,
      evidence: candidate.evidence.map((item) => ({ ...item })),
    },
    status: "WATCH",
    resumeStatus: null,
    createdAtTs: candidate.createdAtTs,
    updatedAtTs: candidate.createdAtTs,
    lastProcessedBarCloseTs: null,
    triggeredAtTs: null,
    invalidatedAtTs: null,
    expiredAtTs: null,
    suppressionReasons: [],
    events: [{
      type: "CREATED",
      fromStatus: null,
      toStatus: "WATCH",
      atTs: candidate.createdAtTs,
      barCloseTs: null,
      reason: "Candidate created from evidence: " + evidenceSummary,
    }],
  };
}

function getGateFailures(gates: OpportunityGates, extraReasons: string[] = []): string[] {
  const reasons = [...extraReasons];
  if (!gates.marketFresh) reasons.push("MARKET_DATA_NOT_FRESH");
  if (!gates.datasetAllowed) reasons.push("DATASET_NOT_ELIGIBLE");
  if (!gates.signalAllowed) reasons.push("SIGNAL_POLICY_BLOCKED");
  if (!gates.htfAllowed) reasons.push("HTF_GATE_BLOCKED");
  return [...new Set(reasons)];
}

function transitionEvent(
  fromStatus: OpportunityStatus,
  toStatus: OpportunityStatus,
  bar: Bar,
  reason: string
): OpportunityEvent {
  const type: OpportunityEventType =
    toStatus === "NEAR_TRIGGER" ? "NEAR_TRIGGER" :
    toStatus === "TRIGGERED" ? "TRIGGERED" :
    toStatus === "INVALIDATED" ? "INVALIDATED" :
    toStatus === "EXPIRED" ? "EXPIRED" :
    toStatus === "WATCH" && fromStatus === "NEAR_TRIGGER" ? "RETURNED_TO_WATCH" :
    "RESUMED";

  return {
    type,
    fromStatus,
    toStatus,
    atTs: bar.ct,
    barCloseTs: bar.ct,
    reason,
  };
}

/**
 * Apply one strictly newer closed-bar observation.
 *
 * Safety ordering:
 * 1. expired window;
 * 2. invalidation touch (wins if the same candle also touches the trigger);
 * 3. trigger touch;
 * 4. near-trigger distance;
 * 5. return to WATCH.
 *
 * TRIGGERED/INVALIDATED/EXPIRED are terminal opportunity states. They describe
 * setup lifecycle only and do not represent fills, positions or P&L.
 */
export function evaluateOpportunity(
  snapshot: OpportunitySnapshot,
  observation: OpportunityObservation
): OpportunitySnapshot {
  if (TERMINAL.has(snapshot.status)) return snapshot;
  assertClosedBar(observation.bar);

  const bar = observation.bar;
  if (
    bar.ct <= snapshot.candidate.createdAtTs ||
    (snapshot.lastProcessedBarCloseTs !== null &&
      bar.ct <= snapshot.lastProcessedBarCloseTs)
  ) {
    return snapshot;
  }

  const currentReasons = getGateFailures(
    observation.gates,
    observation.suppressionReasons
  );

  if (currentReasons.length > 0) {
    const resumeStatus = snapshot.status === "SUPPRESSED"
      ? snapshot.resumeStatus ?? "WATCH"
      : snapshot.status;
    const changedReasons =
      currentReasons.length !== snapshot.suppressionReasons.length ||
      currentReasons.some((reason, index) => reason !== snapshot.suppressionReasons[index]);
    const events = [...snapshot.events];

    if (snapshot.status !== "SUPPRESSED" || changedReasons) {
      events.push({
        type: "SUPPRESSED",
        fromStatus: snapshot.status,
        toStatus: "SUPPRESSED",
        atTs: bar.ct,
        barCloseTs: bar.ct,
        reason: currentReasons.join(", "),
      });
    }

    return {
      ...snapshot,
      status: "SUPPRESSED",
      resumeStatus,
      updatedAtTs: bar.ct,
      lastProcessedBarCloseTs: bar.ct,
      suppressionReasons: currentReasons,
      events,
    };
  }

  const wasSuppressed = snapshot.status === "SUPPRESSED";
  const previousStatus = wasSuppressed
    ? snapshot.resumeStatus ?? "WATCH"
    : snapshot.status;
  const candidate = snapshot.candidate;

  let nextStatus: OpportunityStatus = "WATCH";
  let reason = "No near-trigger or trigger condition on this closed bar.";
  let triggeredAtTs = snapshot.triggeredAtTs;
  let invalidatedAtTs = snapshot.invalidatedAtTs;
  let expiredAtTs = snapshot.expiredAtTs;

  if (bar.ct > candidate.expiresAtTs) {
    nextStatus = "EXPIRED";
    expiredAtTs = bar.ct;
    reason = "Candidate expiry timestamp passed before a trigger.";
  } else if (
    candidate.direction === "long"
      ? bar.l <= candidate.invalidationPrice
      : bar.h >= candidate.invalidationPrice
  ) {
    nextStatus = "INVALIDATED";
    invalidatedAtTs = bar.ct;
    reason = "Closed bar touched the invalidation boundary; invalidation takes priority over a same-bar trigger.";
  } else if (
    candidate.direction === "long"
      ? bar.h >= candidate.triggerPrice
      : bar.l <= candidate.triggerPrice
  ) {
    nextStatus = "TRIGGERED";
    triggeredAtTs = bar.ct;
    reason = "Closed bar touched the candidate trigger boundary. This is not a fill.";
  } else {
    const near = candidate.direction === "long"
      ? bar.c >= candidate.triggerPrice - candidate.nearDistance &&
        bar.c < candidate.triggerPrice
      : bar.c <= candidate.triggerPrice + candidate.nearDistance &&
        bar.c > candidate.triggerPrice;

    if (near) {
      nextStatus = "NEAR_TRIGGER";
      reason = "Closed-bar price entered the configured near-trigger distance.";
    }
  }

  const events = [...snapshot.events];
  if (wasSuppressed) {
    events.push({
      type: "RESUMED",
      fromStatus: "SUPPRESSED",
      toStatus: previousStatus,
      atTs: bar.ct,
      barCloseTs: bar.ct,
      reason: "All required market, dataset, signal and HTF gates are available again.",
    });
  }
  if (nextStatus !== previousStatus) {
    events.push(transitionEvent(previousStatus, nextStatus, bar, reason));
  }

  return {
    ...snapshot,
    status: nextStatus,
    resumeStatus: null,
    updatedAtTs: bar.ct,
    lastProcessedBarCloseTs: bar.ct,
    triggeredAtTs,
    invalidatedAtTs,
    expiredAtTs,
    suppressionReasons: [],
    events,
  };
}
