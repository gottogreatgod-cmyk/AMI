import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  createOpportunitySnapshot,
  evaluateOpportunity,
  type OpportunityCandidate,
  type OpportunityObservation,
  type OpportunitySnapshot,
  type OpportunityStatus,
} from "./opportunity-lifecycle";

export class OpportunityStoreError extends Error {
  readonly code: "NOT_FOUND" | "CONCURRENCY_CONFLICT" | "INVALID_STORED_STATE";

  constructor(
    code: OpportunityStoreError["code"],
    message: string
  ) {
    super(message);
    this.name = "OpportunityStoreError";
    this.code = code;
  }
}

type OpportunityRow = Prisma.OpportunityGetPayload<{
  include: { events: { orderBy: { sequence: "asc" } } };
}>;

export interface PersistedOpportunityResult {
  created: boolean;
  opportunityId: string;
  snapshot: OpportunitySnapshot;
  version: number;
}

function parseCandidate(value: string): OpportunityCandidate {
  try {
    const parsed = JSON.parse(value) as OpportunityCandidate;
    // Reuse the lifecycle's canonical validation rather than trusting JSON
    // persisted in the database without checking its core fields.
    createOpportunitySnapshot(parsed);
    return parsed;
  } catch {
    throw new OpportunityStoreError(
      "INVALID_STORED_STATE",
      "Stored opportunity candidate JSON is malformed or invalid."
    );
  }
}

function toSnapshot(row: OpportunityRow): OpportunitySnapshot {
  const candidate = parseCandidate(row.candidateJson);
  let suppressionReasons: string[];
  try {
    const parsed = JSON.parse(row.suppressionReasonsJson) as unknown;
    suppressionReasons = Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
      ? parsed
      : [];
  } catch {
    suppressionReasons = [];
  }

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
    events: row.events.map((event) => ({
      type: event.type as OpportunitySnapshot["events"][number]["type"],
      fromStatus: event.fromStatus as OpportunitySnapshot["events"][number]["fromStatus"],
      toStatus: event.toStatus as OpportunityStatus,
      atTs: event.atTs,
      barCloseTs: event.barCloseTs,
      reason: event.reason,
    })),
  };
}

async function findStoredOpportunity(
  userId: string,
  id: string,
  client: typeof db | Prisma.TransactionClient = db
): Promise<OpportunityRow | null> {
  return client.opportunity.findFirst({
    where: { id, userId },
    include: { events: { orderBy: { sequence: "asc" } } },
  });
}

export async function createPersistentOpportunity(
  userId: string,
  candidate: OpportunityCandidate
): Promise<PersistedOpportunityResult> {
  if (!userId.trim()) throw new Error("A signed-in user ID is required.");
  const initial = createOpportunitySnapshot(candidate);

  try {
    const created = await db.$transaction(async (tx) => {
      const row = await tx.opportunity.create({
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
          lastProcessedBarCloseTs: null,
          triggeredAtTs: null,
          invalidatedAtTs: null,
          expiredAtTs: null,
          suppressionReasonsJson: JSON.stringify([]),
          version: 1,
        },
      });

      await tx.opportunityEvent.create({
        data: {
          opportunityId: row.id,
          sequence: 0,
          type: initial.events[0].type,
          fromStatus: null,
          toStatus: initial.events[0].toStatus,
          atTs: initial.events[0].atTs,
          barCloseTs: null,
          reason: initial.events[0].reason,
        },
      });

      const stored = await findStoredOpportunity(userId, row.id, tx);
      if (!stored) {
        throw new OpportunityStoreError("INVALID_STORED_STATE", "Created opportunity could not be reloaded.");
      }
      return { id: row.id, version: row.version, snapshot: toSnapshot(stored) };
    });

    return {
      created: true,
      opportunityId: created.id,
      version: created.version,
      snapshot: created.snapshot,
    };
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const existing = await db.opportunity.findFirst({
        where: { userId, dedupeKey: candidate.id },
        include: { events: { orderBy: { sequence: "asc" } } },
      });
      if (existing) {
        return {
          created: false,
          opportunityId: existing.id,
          version: existing.version,
          snapshot: toSnapshot(existing),
        };
      }
    }
    throw error;
  }
}

export async function getPersistentOpportunity(
  userId: string,
  id: string
): Promise<PersistedOpportunityResult | null> {
  const row = await findStoredOpportunity(userId, id);
  if (!row) return null;
  return {
    created: false,
    opportunityId: row.id,
    version: row.version,
    snapshot: toSnapshot(row),
  };
}

export async function listPersistentOpportunities(
  userId: string,
  options: {
    status?: OpportunityStatus;
    limit?: number;
  } = {}
): Promise<PersistedOpportunityResult[]> {
  const limit = Math.max(1, Math.min(Math.floor(options.limit ?? 50), 200));
  const rows = await db.opportunity.findMany({
    where: {
      userId,
      ...(options.status ? { status: options.status } : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: limit,
    include: { events: { orderBy: { sequence: "asc" } } },
  });
  return rows.map((row) => ({
    created: false,
    version: row.version,
    snapshot: toSnapshot(row),
  }));
}

/**
 * Persist a pure lifecycle transition and its append-only event rows atomically.
 * Compare-and-swap on version prevents concurrent workers from overwriting
 * newer state. Each new event receives a unique per-opportunity sequence.
 */
export async function applyPersistentOpportunityObservation(
  userId: string,
  id: string,
  observation: OpportunityObservation
): Promise<PersistedOpportunityResult> {
  return db.$transaction(async (tx) => {
    const row = await findStoredOpportunity(userId, id, tx);
    if (!row) {
      throw new OpportunityStoreError("NOT_FOUND", "Opportunity does not exist for this user.");
    }

    const current = toSnapshot(row);
    const next = evaluateOpportunity(current, observation);
    const newEvents = next.events.slice(current.events.length);

    if (newEvents.length === 0) {
      return {
        created: false,
        version: row.version,
        snapshot: current,
      };
    }

    const updated = await tx.opportunity.updateMany({
      where: {
        id,
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

    if (updated.count !== 1) {
      throw new OpportunityStoreError(
        "CONCURRENCY_CONFLICT",
        "Opportunity changed while this observation was being committed; reload before retrying."
      );
    }

    for (const [index, event] of newEvents.entries()) {
      await tx.opportunityEvent.create({
        data: {
          opportunityId: id,
          sequence: current.events.length + index,
          type: event.type,
          fromStatus: event.fromStatus,
          toStatus: event.toStatus,
          atTs: event.atTs,
          barCloseTs: event.barCloseTs,
          reason: event.reason,
        },
      });
    }

    const stored = await findStoredOpportunity(userId, id, tx);
    if (!stored) {
      throw new OpportunityStoreError("INVALID_STORED_STATE", "Updated opportunity could not be reloaded.");
    }
    return {
      created: false,
      opportunityId: stored.id,
      version: stored.version,
      snapshot: toSnapshot(stored),
    };
  });
}
