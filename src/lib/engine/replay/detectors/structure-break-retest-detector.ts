import type { Bar } from "../../types";
import type { ReplayEventDraft, ReplayMachine } from "../replay-engine";

export interface StructureBreakRetestOptions {
  leftBars?: number;
  rightBars?: number;
  maxBarsAfterBreak?: number;
  maxBarsAfterRetest?: number;
}

interface ConfirmedLevel {
  price: number;
  pivotBarTs: number;
  confirmedAtTs: number;
  broken: boolean;
}

interface ActiveRetestSetup {
  setupKey: string;
  direction: "long" | "short";
  structureKind: "BOS" | "CHoCH";
  pivotBarTs: number;
  breakLevel: number;
  breakBarIndex: number;
  invalidationReference: number | null;
  phase: "FORMING" | "ARMED";
  retestBarIndex: number | null;
  retestHigh: number | null;
  retestLow: number | null;
}

export interface StructureBreakRetestState {
  rollingBars: Bar[];
  previousClose: number | null;
  lastHigh: ConfirmedLevel | null;
  lastLow: ConfirmedLevel | null;
  trend: -1 | 0 | 1;
  activeSetup: ActiveRetestSetup | null;
}

function isValidOptions(options: Required<StructureBreakRetestOptions>): boolean {
  return Number.isInteger(options.leftBars) && options.leftBars >= 1 &&
    Number.isInteger(options.rightBars) && options.rightBars >= 1 &&
    Number.isInteger(options.maxBarsAfterBreak) && options.maxBarsAfterBreak >= 1 &&
    Number.isInteger(options.maxBarsAfterRetest) && options.maxBarsAfterRetest >= 1;
}

function createEmptyState(): StructureBreakRetestState {
  return {
    rollingBars: [],
    previousClose: null,
    lastHigh: null,
    lastLow: null,
    trend: 0,
    activeSetup: null,
  };
}

/**
 * Deterministic causal structure-break/retest pattern:
 *
 * 1. A swing is confirmed only after rightBars additional bars close.
 * 2. A close through the latest confirmed swing creates a FORMING setup.
 * 3. Within maxBarsAfterBreak, price must retest the broken level and close
 *    back on the breakout side to become ARMED.
 * 4. A subsequent close beyond the retest bar's opposite extreme invalidates;
 *    a close beyond the retest bar's breakout extreme triggers.
 * 5. The setup expires after its configured bar-count window.
 *
 * This is an explainable research heuristic, not a profitability claim or
 * trade instruction. It uses close-based confirmation only; it does not
 * claim intrabar execution or fill prices.
 */
export function createStructureBreakRetestMachine(
  input: StructureBreakRetestOptions = {}
): ReplayMachine<StructureBreakRetestState> {
  const options: Required<StructureBreakRetestOptions> = {
    leftBars: input.leftBars ?? 3,
    rightBars: input.rightBars ?? 3,
    maxBarsAfterBreak: input.maxBarsAfterBreak ?? 12,
    maxBarsAfterRetest: input.maxBarsAfterRetest ?? 8,
  };
  if (!isValidOptions(options)) {
    throw new Error("Structure break/retest options must be positive integer bar counts.");
  }

  const windowSize = options.leftBars + options.rightBars + 1;

  return {
    detectorId: "structure-break-retest",
    detectorVersion: "1.0.0",
    createInitialState: createEmptyState,
    onClosedBar(state, context) {
      const bar = context.bar;
      const next: StructureBreakRetestState = {
        ...state,
        rollingBars: [...state.rollingBars, bar].slice(-windowSize),
        lastHigh: state.lastHigh ? { ...state.lastHigh } : null,
        lastLow: state.lastLow ? { ...state.lastLow } : null,
        activeSetup: state.activeSetup ? { ...state.activeSetup } : null,
      };
      const events: ReplayEventDraft[] = [];

      const previousClose = state.previousClose;
      const pivotReady = next.rollingBars.length === windowSize;
      if (pivotReady) {
        const pivot = next.rollingBars[options.leftBars];
        let isSwingHigh = true;
        let isSwingLow = true;

        for (let index = 0; index < windowSize; index++) {
          if (index === options.leftBars) continue;
          const other = next.rollingBars[index];
          if (other.h >= pivot.h) isSwingHigh = false;
          if (other.l <= pivot.l) isSwingLow = false;
        }

        if (isSwingHigh) {
          next.lastHigh = {
            price: pivot.h,
            pivotBarTs: pivot.t,
            confirmedAtTs: bar.ct,
            broken: previousClose !== null && previousClose > pivot.h,
          };
        }
        if (isSwingLow) {
          next.lastLow = {
            price: pivot.l,
            pivotBarTs: pivot.t,
            confirmedAtTs: bar.ct,
            broken: previousClose !== null && previousClose < pivot.l,
          };
        }
      }

      let newBreakCreated = false;
      if (
        next.lastHigh &&
        !next.lastHigh.broken &&
        previousClose !== null &&
        previousClose <= next.lastHigh.price &&
        bar.c > next.lastHigh.price
      ) {
        if (next.activeSetup) {
          events.push({
            setupKey: next.activeSetup.setupKey,
            eventKey: "EXPIRED_SUPERSEDED",
            type: "EXPIRED",
            reason: "A newer confirmed structure break superseded the unfinished setup.",
            evidence: [{ code: "superseding-break", value: next.lastHigh.price, sourceBarTs: bar.t }],
          });
        }
        const structureKind = next.trend === -1 ? "CHoCH" : "BOS";
        const setupKey = "long:" + next.lastHigh.pivotBarTs + ":" + bar.t;
        next.activeSetup = {
          setupKey,
          direction: "long",
          structureKind,
          pivotBarTs: next.lastHigh.pivotBarTs,
          breakLevel: next.lastHigh.price,
          breakBarIndex: context.barIndex,
          invalidationReference: next.lastLow?.price ?? null,
          phase: "FORMING",
          retestBarIndex: null,
          retestHigh: null,
          retestLow: null,
        };
        next.lastHigh.broken = true;
        next.trend = 1;
        newBreakCreated = true;
        events.push({
          setupKey,
          eventKey: "FORMING",
          type: "FORMING",
          reason: structureKind + " upward: a closed bar broke the latest confirmed swing high.",
          evidence: [
            { code: "broken-swing-high", value: next.lastHigh.price, sourceBarTs: next.lastHigh.pivotBarTs },
            { code: "swing-confirmed-at", value: next.lastHigh.confirmedAtTs, sourceBarTs: bar.t },
            { code: "break-close", value: bar.c, sourceBarTs: bar.t },
            ...(next.lastLow
              ? [{ code: "opposite-invalidation-reference", value: next.lastLow.price, sourceBarTs: next.lastLow.pivotBarTs }]
              : []),
          ],
        });
      } else if (
        next.lastLow &&
        !next.lastLow.broken &&
        previousClose !== null &&
        previousClose >= next.lastLow.price &&
        bar.c < next.lastLow.price
      ) {
        if (next.activeSetup) {
          events.push({
            setupKey: next.activeSetup.setupKey,
            eventKey: "EXPIRED_SUPERSEDED",
            type: "EXPIRED",
            reason: "A newer confirmed structure break superseded the unfinished setup.",
            evidence: [{ code: "superseding-break", value: next.lastLow.price, sourceBarTs: bar.t }],
          });
        }
        const structureKind = next.trend === 1 ? "CHoCH" : "BOS";
        const setupKey = "short:" + next.lastLow.pivotBarTs + ":" + bar.t;
        next.activeSetup = {
          setupKey,
          direction: "short",
          structureKind,
          pivotBarTs: next.lastLow.pivotBarTs,
          breakLevel: next.lastLow.price,
          breakBarIndex: context.barIndex,
          invalidationReference: next.lastHigh?.price ?? null,
          phase: "FORMING",
          retestBarIndex: null,
          retestHigh: null,
          retestLow: null,
        };
        next.lastLow.broken = true;
        next.trend = -1;
        newBreakCreated = true;
        events.push({
          setupKey,
          eventKey: "FORMING",
          type: "FORMING",
          reason: structureKind + " downward: a closed bar broke the latest confirmed swing low.",
          evidence: [
            { code: "broken-swing-low", value: next.lastLow.price, sourceBarTs: next.lastLow.pivotBarTs },
            { code: "swing-confirmed-at", value: next.lastLow.confirmedAtTs, sourceBarTs: bar.t },
            { code: "break-close", value: bar.c, sourceBarTs: bar.t },
            ...(next.lastHigh
              ? [{ code: "opposite-invalidation-reference", value: next.lastHigh.price, sourceBarTs: next.lastHigh.pivotBarTs }]
              : []),
          ],
        });
      }

      if (next.activeSetup && !newBreakCreated) {
        const setup = next.activeSetup;
        const barsAfterBreak = context.barIndex - setup.breakBarIndex;

        if (barsAfterBreak > options.maxBarsAfterBreak) {
          events.push({
            setupKey: setup.setupKey,
            eventKey: "EXPIRED",
            type: "EXPIRED",
            reason: "No valid retest occurred within the configured post-break window.",
          });
          next.activeSetup = null;
        } else if (setup.phase === "FORMING") {
          const breachedOppositeSwing = setup.invalidationReference !== null &&
            (setup.direction === "long"
              ? bar.c < setup.invalidationReference
              : bar.c > setup.invalidationReference);

          if (breachedOppositeSwing) {
            events.push({
              setupKey: setup.setupKey,
              eventKey: "INVALIDATED",
              type: "INVALIDATED",
              reason: "A closed bar invalidated the structure before a valid retest.",
              evidence: [{
                code: "opposite-swing-invalidation",
                value: setup.invalidationReference,
                sourceBarTs: bar.t,
              }],
            });
            next.activeSetup = null;
          } else {
            const retested = setup.direction === "long"
              ? bar.l <= setup.breakLevel && bar.c >= setup.breakLevel
              : bar.h >= setup.breakLevel && bar.c <= setup.breakLevel;

            if (retested) {
              setup.phase = "ARMED";
              setup.retestBarIndex = context.barIndex;
              setup.retestHigh = bar.h;
              setup.retestLow = bar.l;
              events.push({
                setupKey: setup.setupKey,
                eventKey: "ARMED",
                type: "ARMED",
                reason: "Price retested the broken structure level and closed back on the breakout side.",
                evidence: [
                  { code: "retested-structure-level", value: setup.breakLevel, sourceBarTs: bar.t },
                  {
                    code: setup.direction === "long" ? "trigger-close-above" : "trigger-close-below",
                    value: setup.direction === "long" ? bar.h : bar.l,
                    sourceBarTs: bar.t,
                  },
                  {
                    code: setup.direction === "long" ? "invalidation-close-below" : "invalidation-close-above",
                    value: setup.direction === "long" ? bar.l : bar.h,
                    sourceBarTs: bar.t,
                  },
                ],
              });
            }
          }
        } else if (setup.phase === "ARMED") {
          const invalidated = setup.direction === "long"
            ? bar.c < setup.retestLow!
            : bar.c > setup.retestHigh!;
          const triggered = setup.direction === "long"
            ? bar.c > setup.retestHigh!
            : bar.c < setup.retestLow!;
          const barsAfterRetest = context.barIndex - (setup.retestBarIndex ?? context.barIndex);

          if (invalidated) {
            events.push({
              setupKey: setup.setupKey,
              eventKey: "INVALIDATED",
              type: "INVALIDATED",
              reason: "A closed bar crossed the retest candle's invalidation extreme.",
              evidence: [{
                code: "retest-invalidation",
                value: setup.direction === "long" ? setup.retestLow : setup.retestHigh,
                sourceBarTs: bar.t,
              }],
            });
            next.activeSetup = null;
          } else if (triggered) {
            events.push({
              setupKey: setup.setupKey,
              eventKey: "TRIGGERED",
              type: "TRIGGERED",
              reason: "A later closed bar closed beyond the retest candle's trigger extreme. This is not a fill.",
              evidence: [{
                code: "retest-trigger",
                value: setup.direction === "long" ? setup.retestHigh : setup.retestLow,
                sourceBarTs: bar.t,
              }],
            });
            next.activeSetup = null;
          } else if (barsAfterRetest > options.maxBarsAfterRetest) {
            events.push({
              setupKey: setup.setupKey,
              eventKey: "EXPIRED",
              type: "EXPIRED",
              reason: "The armed retest setup did not trigger within its configured bar window.",
            });
            next.activeSetup = null;
          }
        }
      }

      next.previousClose = bar.c;
      return { state: next, events };
    },
  };
}
