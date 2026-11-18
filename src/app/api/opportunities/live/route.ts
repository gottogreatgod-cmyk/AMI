import { NextResponse } from "next/server";
import { requireSession, serverError } from "@/lib/api";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const MONITORED = ["XAUUSD-DUKA", "NAS100-DUKA"] as const;
const SIDES = ["bid", "ask"] as const;

function parseState(stateJson: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(stateJson) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function GET() {
  const guard = await requireSession();
  if (!guard.ok) return guard.res;

  try {
    const cursors = await db.liveOpportunityCursor.findMany({
      where: {
        instrumentId: { in: [...MONITORED] },
        priceSide: { in: [...SIDES] },
        timeframe: "m1",
      },
      orderBy: [
        { instrumentId: "asc" },
        { priceSide: "asc" },
      ],
      include: {
        events: {
          orderBy: { sequence: "desc" },
          take: 30,
        },
      },
    });

    const now = Date.now();
    const results = cursors.map((cursor) => {
      const state = parseState(cursor.stateJson);
      const heartbeatAt = cursor.heartbeatAt?.getTime() ?? null;
      const heartbeatAgeMs = heartbeatAt === null
        ? null
        : Math.max(0, now - heartbeatAt);
      const tickAgeMs = cursor.lastTickTimestamp === null
        ? null
        : Math.max(0, now - cursor.lastTickTimestamp);
      const snapshotAgeMs = cursor.lastSnapshotFetchedAt === null
        ? null
        : Math.max(0, now - cursor.lastSnapshotFetchedAt);

      return {
        id: cursor.id,
        cursorKey: cursor.cursorKey,
        instrumentId: cursor.instrumentId,
        providerInstrument: cursor.providerInstrument,
        timeframe: cursor.timeframe,
        priceSide: cursor.priceSide,
        detectorId: cursor.detectorId,
        detectorVersion: cursor.detectorVersion,
        paramsHash: cursor.paramsHash,
        engineVersion: cursor.engineVersion,
        generation: cursor.generation,
        status: cursor.status,
        lastError: cursor.lastError,
        barsProcessedCount: cursor.barsProcessedCount,
        lastProcessedBarTs: cursor.lastProcessedBarTs,
        lastProcessedBarCloseTs: cursor.lastProcessedBarCloseTs,
        lastRecoveryRevisionId: cursor.lastRecoveryRevisionId,
        lastRecoveryRevisionHash: cursor.lastRecoveryRevisionHash,
        heartbeatAt,
        heartbeatAgeMs,
        lastSnapshotFetchedAt: cursor.lastSnapshotFetchedAt,
        snapshotAgeMs,
        lastTickTimestamp: cursor.lastTickTimestamp,
        tickAgeMs,
        detectorState: state ? {
          trend: state.trend ?? 0,
          activeSetup: state.activeSetup ?? null,
          lastConfirmedHigh: state.lastHigh ?? null,
          lastConfirmedLow: state.lastLow ?? null,
        } : null,
        events: cursor.events
          .slice()
          .reverse()
          .map((event) => ({
            id: event.id,
            eventIdentity: event.eventIdentity,
            sequence: event.sequence,
            setupId: event.setupId,
            eventKey: event.eventKey,
            type: event.type,
            direction: event.direction,
            instrumentId: event.instrumentId,
            timeframe: event.timeframe,
            priceSide: event.priceSide,
            occurredAtTs: event.occurredAtTs,
            discoveredAtTs: event.discoveredAtTs,
            confirmationBarTs: event.confirmationBarTs,
            confirmationBarCloseTs: event.confirmationBarCloseTs,
            sourceBarFingerprint: event.sourceBarFingerprint,
            sourceRevisionId: event.sourceRevisionId,
            sourceRevisionHash: event.sourceRevisionHash,
            sourcePollFetchedAt: event.sourcePollFetchedAt,
            sourceTickTimestamp: event.sourceTickTimestamp,
            reason: event.reason,
            evidence: JSON.parse(event.evidenceJson) as unknown[],
            origin: event.origin,
            recordedAt: event.recordedAt,
          })),
      };
    });

    const cursorKeys = new Set(results.map((item) => item.instrumentId + ":" + item.priceSide));
    const missing = MONITORED.flatMap((instrumentId) =>
      SIDES.filter((priceSide) => !cursorKeys.has(instrumentId + ":" + priceSide))
        .map((priceSide) => ({
          instrumentId,
          priceSide,
          timeframe: "m1",
          status: "NOT_STARTED",
          detectorId: "structure-break-retest",
          detectorVersion: "1.0.0",
          events: [],
        }))
    );

    return NextResponse.json({
      feedMode: "EXPERIMENTAL_POLLING",
      ordersEnabled: false,
      detector: {
        id: "structure-break-retest",
        version: "1.0.0",
        mode: "CLOSED_M1_BAR",
        liveOrigin: "LIVE_MONITOR",
        bootstrapOrigin: "LIVE_BOOTSTRAP",
      },
      cursors: [...results, ...missing],
      fetchedAt: now,
      note: "LIVE_MONITOR events were processed after a persisted watermark from newly closed M1 bars. LIVE_BOOTSTRAP events reconstruct recent context when a cursor is first started or explicitly reseeded; they are not alerts received live at that historical time. GAP_UNRECONCILED pauses the cursor until a deliberate recovery/reseed. No broker orders or fills are created.",
    });
  } catch (error) {
    return serverError(error);
  }
}
