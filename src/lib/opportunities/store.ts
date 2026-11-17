import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  createOpportunitySnapshot,
  evaluateOpportunity,
  type OpportunityCandidate,
  type OpportunityEvent,
  type OpportunityObservation,
  type OpportunitySnapshot,
  type OpportunityStatus,
} from "@/lib/engine/opportunity-lifecycle";

type OpportunityWithEvents = Prisma.OpportunityGetPayload<{
  include: { events: { orderBy: { sequence: "asc" } } };
}>;

export interface StoredOpportunity {
  id: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  snapshot: OpportunitySnapshot;
}

export interface CreateOpportunityResult extends StoredOpportunity {
  outcome: "CREATED" | "EXISTING" | "CONFLICT";
}

export interface ApplyOpportunityObservationResult extends StoredOpportunity {
  outcome: "UPDATED" | "UNCHANGED";
}

function candidateIdentity(candidate: OpportunityCandidate): string {
  // createdAtTs and evidence.observedAtTs are intentionally excluded so a
  // retried HTTP request with the same idempotency key remains idempotent.
  // All price, expiry, dataset and textual evidence fields stay immutable.
  return JSON.stringify({
    id: candidate.id,
    symbol: candidate.symbol,
    timeframe: candidate.timeframe,
    strategyKey: candidate.strategyKey,
    direction: candidate.direction,
    triggerPrice: candidate.triggerPrice,
    invalidationPrice: candidate.invalidationPrice,
    nearDistance: candidate.nearDistance,
    expiresAtTs: candidate.expiresAtTs,
    datasetId: candidate.datasetId ?? null,
    evidence: candidate.evidence.map((item) => ({
      source: item.source,
      code: item.code,
      description: item.description,
    })),
  });
}

function eventFromRow(row: OpportunityWithEvents["events"][number]): OpportunityEvent {
  return {
    type: row.type as OpportunityEvent["type"],
    fromStatus: row.fromStatus as OpportunityEvent["fromStatus"],
    toStatus: row.toStatus as OpportunityEvent["toStatus"],
    atTs: row.atTs,
    barCloseTs: row.barCloseTs,
    reason: row.reason,
  };
}

function toSnapshot(row: OpportunityWithEvents): OpportunitySnapshot {
  const candidate = JSON.parse(row.candidateJson) as OpportunityCandidate;
  const suppressionReasons = JSON.parse(row.suppressionReasonsJson) as string[];

  return {
    candidate,
    status: row.status as OpportunityStatus,
    resumeStatus: row.resumeStatus as OpportunitySnapshot["resumeStatus"],
    createdAtTs: row.createdAtTs,
    updatedAtTs: row.updatedAtTs,
    lastProcessedBarCloseTs: row.lastProcessedBarCloseTs,
    triggeredAtTs: row.triggeredAtTs,
    invalidatedAtTs: row.invalidatedAtTs,
    expiredAtTs: row.expiredAtTs,
    suppressionReasons,
    events: row.events.map(eventFromRow),
  };
}

function toStored(row: OpportunityWithEvents): StoredOpportunity {
  return {
    id: row.id,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    snapshot: toSnapshot(row),
  };
}

function eventCreateData(
  opportunityId: string,
  sequence: number,
  event: OpportunityEvent
) {
  return {
    opportunityId,
    sequence,
    type: event.type,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    atTs: event.atTs,
    barCloseTs: event.barCloseTs,
    reason: event.reason,
  };
}

async function findByIdempotencyKey(userId: string, dedupeKey: string) {
  return db.opportunity.findFirst({
    where: { userId, dedupeKey },
    include: { events: { orderBy: { sequence: "asc" } } },
  });
}

export async function createOrGetOpportunity(
  userId: string,
  candidate: OpportunityCandidate
): Promise<CreateOpportunityResult> {
  const initial = createOpportunitySnapshot(candidate);
  const fingerprint = candidateIdentity(initial.candidate);
  const existing = await findByIdempotencyKey(userId, candidate.id);

  if (existing) {
    const storedCandidate = JSON.parse(existing.candidateJson) as OpportunityCandidate;
    return {
      ...toStored(existing),
      outcome: candidateIdentity(storedCandidate) === fingerprint ? "EXISTING" : "CONFLICT",
    };
  }

  try {
    const created = await db.opportunity.create({
      data: {
        userId,
        dedupeKey: candidate.id,
        symbol: candidate.symbol,
        timeframe: candidate.timeframe,
        strategyKey: candidate.strategyKey,
        direction: candidate.direction,
        status: initial.status,
        resumeStatus: initial.resumeStatus,
        candidateJson: JSON.stringify(initial.candidate),
        createdAtTs: initial.createdAtTs,
        updatedAtTs: initial.updatedAtTs,
        lastProcessedBarCloseTs: initial.lastProcessedBarCloseTs,
        triggeredAtTs: initial.triggeredAtTs,
        invalidatedAtTs: initial.invalidatedAtTs,
        expiredAtTs: initial.expiredAtTs,
        suppressionReasonsJson: JSON.stringify(initial.suppressionReasons),
        events: {
          create: initial.events.map((event, index) =>
            eventCreateData("", index, event)
          ).map(({ opportunityId: _unused, ...event }) => event),
        },
      },
      include: { events: { orderBy: { sequence: "asc" } } },
    });

    return { ...toStored(created), outcome: "CREATED" };
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      throw error;
    }

    // A concurrent identical request may have won the unique user/dedupeKey
    // constraint. Re-read and compare immutable candidate identity.
    const raced = await findByIdempotencyKey(userId, candidate.id);
    if (!raced) throw error;
    const storedCandidate = JSON.parse(raced.candidateJson) as OpportunityCandidate;
    return {
      ...toStored(raced),
      outcome: candidateIdentity(storedCandidate) === fingerprint ? "EXISTING" : "CONFLICT",
    };
  }
}

export async function getUserOpportunity(
  userId: string,
  opportunityId: string
): Promise<StoredOpportunity | null> {
  const row = await db.opportunity.findFirst({
    where: { id: opportunityId, userId },
    include: { events: { orderBy: { sequence: "asc" } } },
  });
  return row ? toStored(row) : null;
}

export async function listUserOpportunities(args: {
  userId: string;
  limit?: number;
  status?: OpportunityStatus;
}): Promise<StoredOpportunity[]> {
  const limit = Math.min(Math.max(Math.floor(args.limit ?? 40), 1), 200);
  const rows = await db.opportunity.findMany({
    where: {
      userId: args.userId,
      ...(args.status ? { status: args.status } : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: limit,
    include: { events: { orderBy: { sequence: "asc" } } },
  });
  return rows.map(toStored);
}

/**
 * Apply one closed-bar observation and persist the snapshot plus new events
 * in a single transaction. Optimistic versioning prevents a slower worker
 * from overwriting a newer transition; duplicate bars are idempotent.
 */
export async function applyClosedBarObservation(
  userId: string,
  opportunityId: string,
  observation: OpportunityObservation
): Promise<ApplyOpportunityObservationResult | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await db.opportunity.findFirst({
      where: { id: opportunityId, userId },
      include: { events: { orderBy: { sequence: "asc" } } },
    });
    if (!row) return null;

    const current = toStored(row);
    const next = evaluateOpportunity(current.snapshot, observation);
    if (next === current.snapshot) {
      return { ...current, outcome: "UNCHANGED" };
    }

    const addedEvents = next.events.slice(current.snapshot.events.length);
    const committed = await db.$transaction(async (tx) => {
      const update = await tx.opportunity.updateMany({
        where: {
          id: opportunityId,
          userId,
          version: row.version,
        },
        data: {
          status: next.status,
          resumeStatus: next.resumeStatus,
          updatedAtTs: next.updatedAtTs,
          lastProcessedBarCloseTs: next.lastProcessedBarCloseTs,
          triggeredAtTs: next.triggeredAtTs,
          invalidatedAtTs: next.invalidatedAtTs,
          expiredAtTs: next.expiredAtTs,
          suppressionReasonsJson: JSON.stringify(next.suppressionReasons),
          version: { increment: 1 },
        },
      });
      if (update.count !== 1) return false;

      if (addedEvents.length > 0) {
        await tx.opportunityEvent.createMany({
          data: addedEvents.map((event, index) =>
            eventCreateData(opportunityId, current.snapshot.events.length + index, event)
          ),
        });
      }
      return true;
    });

    if (committed) {
      const updated = await getUserOpportunity(userId, opportunityId);
      if (!updated) return null;
      return { ...updated, outcome: "UPDATED" };
    }
    // Another request committed a newer version. Re-read and re-evaluate;
    // the same closed bar then becomes a no-op instead of a duplicate event.
  }

  throw new Error("Opportunity snapshot changed concurrently; retry the observation.");
}
