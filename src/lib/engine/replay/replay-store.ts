import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { ReplayEvent, ReplayResult } from "./replay-engine";

export class ReplayStoreError extends Error {
  readonly code: "NOT_FOUND" | "RUN_ID_CONFLICT" | "INVALID_REPLAY";

  constructor(code: ReplayStoreError["code"], message: string) {
    super(message);
    this.name = "ReplayStoreError";
    this.code = code;
  }
}

type ReplayRunRow = Prisma.ReplayRunGetPayload<{
  include: { events: { orderBy: { discoveredAtTs: "asc" } } };
}>;

export interface PersistedReplayResult {
  created: boolean;
  conflict: boolean;
  replay: ReplayRunRow;
}

function validateResult(result: ReplayResult): void {
  if (
    !result.runId.trim() ||
    !result.instrumentId.trim() ||
    !result.timeframe.trim() ||
    !result.source.revisionId.trim() ||
    !result.source.revisionHash.trim() ||
    result.origin !== "HISTORICAL_REPLAY" ||
    result.events.some((event) =>
      event.origin !== "HISTORICAL_REPLAY" ||
      event.discoveredAtTs < event.occurredAtTs ||
      event.confirmationBarCloseTs !== event.discoveredAtTs ||
      event.setupId.trim() === "" ||
      event.id.trim() === ""
    )
  ) {
    throw new ReplayStoreError("INVALID_REPLAY", "Replay result failed immutable provenance or event-time validation.");
  }
}

function eventMatchesStored(event: ReplayEvent, stored: ReplayRunRow["events"][number]): boolean {
  return event.id === stored.eventIdentity &&
    event.setupId === stored.setupId &&
    event.eventKey === stored.eventKey &&
    event.type === stored.type &&
    event.instrumentId === stored.instrumentId &&
    event.timeframe === stored.timeframe &&
    event.occurredAtTs === stored.occurredAtTs &&
    event.discoveredAtTs === stored.discoveredAtTs &&
    event.confirmationBarTs === stored.confirmationBarTs &&
    event.confirmationBarCloseTs === stored.confirmationBarCloseTs &&
    event.withinRequestedRange === stored.withinRequestedRange &&
    event.reason === stored.reason &&
    JSON.stringify(event.evidence) === stored.evidenceJson;
}

function resultMatchesStored(result: ReplayResult, stored: ReplayRunRow): boolean {
  return stored.instrumentId === result.instrumentId &&
    stored.timeframe === result.timeframe &&
    stored.provider === result.source.provider &&
    stored.sourceId === result.source.sourceId &&
    stored.dataClass === result.source.dataClass &&
    stored.revisionId === result.source.revisionId &&
    stored.revisionHash === result.source.revisionHash &&
    stored.detectorId === result.detectorId &&
    stored.detectorVersion === result.detectorVersion &&
    stored.paramsHash === result.paramsHash &&
    stored.engineVersion === result.engineVersion &&
    stored.intervalFromTs === result.interval.fromTs &&
    stored.intervalToTs === result.interval.toTs &&
    stored.warmupBarsRequested === result.warmupBarsRequested &&
    stored.warmupBarsUsed === result.warmupBarsUsed &&
    stored.inputBars === result.inputBars &&
    stored.evaluatedBars === result.evaluatedBars &&
    stored.origin === result.origin &&
    stored.events.length === result.events.length &&
    result.events.every((event, index) =>
      eventMatchesStored(event, stored.events[index])
    );
}

async function findByRunKey(
  userId: string,
  runKey: string
): Promise<ReplayRunRow | null> {
  return db.replayRun.findUnique({
    where: { userId_runKey: { userId, runKey } },
    include: { events: { orderBy: { discoveredAtTs: "asc" } } },
  });
}

/**
 * Store a completed replay and all immutable event rows in one transaction.
 * Same user + same run key is idempotent only when the complete result matches.
 */
export async function persistHistoricalReplay(
  userId: string,
  result: ReplayResult
): Promise<PersistedReplayResult> {
  if (!userId.trim()) throw new Error("A signed-in user ID is required.");
  validateResult(result);

  const existing = await findByRunKey(userId, result.runId);
  if (existing) {
    return {
      created: false,
      conflict: !resultMatchesStored(result, existing),
      replay: existing,
    };
  }

  try {
    const replay = await db.replayRun.create({
      data: {
        userId,
        runKey: result.runId,
        instrumentId: result.instrumentId,
        timeframe: result.timeframe,
        provider: result.source.provider,
        sourceId: result.source.sourceId,
        dataClass: result.source.dataClass,
        revisionId: result.source.revisionId,
        revisionHash: result.source.revisionHash,
        detectorId: result.detectorId,
        detectorVersion: result.detectorVersion,
        paramsHash: result.paramsHash,
        engineVersion: result.engineVersion,
        intervalFromTs: result.interval.fromTs,
        intervalToTs: result.interval.toTs,
        warmupBarsRequested: result.warmupBarsRequested,
        warmupBarsUsed: result.warmupBarsUsed,
        inputBars: result.inputBars,
        evaluatedBars: result.evaluatedBars,
        origin: result.origin,
        events: {
          create: result.events.map((event) => ({
            eventIdentity: event.id,
            setupId: event.setupId,
            eventKey: event.eventKey,
            type: event.type,
            instrumentId: event.instrumentId,
            timeframe: event.timeframe,
            occurredAtTs: event.occurredAtTs,
            discoveredAtTs: event.discoveredAtTs,
            confirmationBarTs: event.confirmationBarTs,
            confirmationBarCloseTs: event.confirmationBarCloseTs,
            withinRequestedRange: event.withinRequestedRange,
            reason: event.reason,
            evidenceJson: JSON.stringify(event.evidence),
            origin: event.origin,
          })),
        },
      },
      include: { events: { orderBy: { discoveredAtTs: "asc" } } },
    });

    return { created: true, conflict: false, replay };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const concurrent = await findByRunKey(userId, result.runId);
      if (concurrent) {
        return {
          created: false,
          conflict: !resultMatchesStored(result, concurrent),
          replay: concurrent,
        };
      }
    }
    throw error;
  }
}

export async function getPersistentReplay(
  userId: string,
  replayId: string
): Promise<ReplayRunRow | null> {
  return db.replayRun.findFirst({
    where: {
      userId,
      OR: [{ id: replayId }, { runKey: replayId }],
    },
    include: { events: { orderBy: { discoveredAtTs: "asc" } } },
  });
}

export async function listPersistentReplays(
  userId: string,
  options: { instrumentId?: string; limit?: number } = {}
): Promise<ReplayRunRow[]> {
  const limit = Math.max(1, Math.min(Math.floor(options.limit ?? 20), 100));
  return db.replayRun.findMany({
    where: {
      userId,
      ...(options.instrumentId ? { instrumentId: options.instrumentId } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    take: limit,
    include: { events: { orderBy: { discoveredAtTs: "asc" } } },
  });
}
