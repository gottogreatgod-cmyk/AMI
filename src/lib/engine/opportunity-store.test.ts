/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import {
  applyPersistentOpportunityObservation,
  createPersistentOpportunity,
  getPersistentOpportunity,
  listPersistentOpportunities,
} from "./opportunity-store";
import type { OpportunityCandidate, OpportunityGates } from "./opportunity-lifecycle";

const STEP = 60_000;
const users: string[] = [];

async function createTestUser(): Promise<string> {
  const suffix = crypto.randomUUID();
  const user = await db.user.create({
    data: {
      email: "opportunity-test-" + suffix + "@ami.invalid",
      passwordHash: "test-only",
      name: "Opportunity integration test",
    },
  });
  users.push(user.id);
  return user.id;
}

function makeCandidate(id = "setup-test-001"): OpportunityCandidate {
  const createdAtTs = 10 * STEP;
  return {
    id,
    symbol: "XAUUSD-DUKA",
    timeframe: "15m",
    strategyKey: "manual-test",
    direction: "long",
    triggerPrice: 2050,
    invalidationPrice: 2040,
    nearDistance: 2,
    createdAtTs,
    expiresAtTs: createdAtTs + 60 * STEP,
    evidence: [{
      source: "manual",
      code: "INTEGRATION_TEST",
      description: "Synthetic candidate for database persistence integration tests.",
      observedAtTs: createdAtTs,
    }],
  };
}

const readyGates: OpportunityGates = {
  marketFresh: true,
  datasetAllowed: true,
  signalAllowed: true,
  htfAllowed: true,
};

function closedBar(index: number, close: number, high = close + 0.5, low = close - 0.5) {
  const t = (index + 1) * STEP;
  return {
    t,
    ct: t + STEP - 1,
    o: close,
    h: high,
    l: low,
    c: close,
    v: 1,
  };
}

afterEach(async () => {
  const ids = users.splice(0);
  if (ids.length > 0) {
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
});

describe("persistent opportunity store", () => {
  test("creates one opportunity and deduplicates retries per user without duplicating CREATED events", async () => {
    const userId = await createTestUser();
    const candidate = makeCandidate();

    const first = await createPersistentOpportunity(userId, candidate);
    const retry = await createPersistentOpportunity(userId, candidate);

    expect(first.created).toBe(true);
    expect(first.version).toBe(1);
    expect(first.snapshot.status).toBe("WATCH");
    expect(first.snapshot.events).toHaveLength(1);
    expect(retry.created).toBe(false);
    expect(retry.snapshot.candidate.id).toBe(candidate.id);
    expect(retry.snapshot.events).toHaveLength(1);

    const rows = await db.opportunity.findMany({
      where: { userId, dedupeKey: candidate.id },
    });
    const events = await db.opportunityEvent.findMany({
      where: { opportunityId: first.opportunityId },
    });
    expect(rows).toHaveLength(1);
    expect(events).toHaveLength(1);
  });

  test("persists lifecycle transitions as separate append-only sequence rows", async () => {
    const userId = await createTestUser();
    const created = await createPersistentOpportunity(userId, makeCandidate("setup-transition"));

    const suppressed = await applyPersistentOpportunityObservation(userId, created.opportunityId, {
      bar: closedBar(10, 2049, 2049.5, 2048.5),
      gates: { ...readyGates, marketFresh: false },
      suppressionReasons: ["MONITOR_STALE"],
    });
    expect(suppressed.snapshot.status).toBe("SUPPRESSED");
    expect(suppressed.snapshot.events.map((event) => event.type)).toEqual([
      "CREATED",
      "SUPPRESSED",
    ]);

    const resumed = await applyPersistentOpportunityObservation(userId, created.opportunityId, {
      bar: closedBar(11, 2049, 2049.5, 2048.5),
      gates: readyGates,
    });
    expect(resumed.snapshot.status).toBe("NEAR_TRIGGER");
    expect(resumed.snapshot.events.map((event) => event.type)).toEqual([
      "CREATED",
      "SUPPRESSED",
      "RESUMED",
      "NEAR_TRIGGER",
    ]);

    const eventRows = await db.opportunityEvent.findMany({
      where: { opportunityId: created.opportunityId },
      orderBy: { sequence: "asc" },
    });
    expect(eventRows.map((event) => event.sequence)).toEqual([0, 1, 2, 3]);
    expect(eventRows.map((event) => event.type)).toEqual([
      "CREATED",
      "SUPPRESSED",
      "RESUMED",
      "NEAR_TRIGGER",
    ]);
    expect(resumed.version).toBe(3);
  });

  test("duplicate and out-of-order closed bars do not create extra event rows or version changes", async () => {
    const userId = await createTestUser();
    const created = await createPersistentOpportunity(userId, makeCandidate("setup-idempotent"));
    const first = await applyPersistentOpportunityObservation(userId, created.opportunityId, {
      bar: closedBar(10, 2049, 2049.5, 2048.5),
      gates: readyGates,
    });

    const duplicate = await applyPersistentOpportunityObservation(userId, created.opportunityId, {
      bar: closedBar(10, 2051, 2052, 2048),
      gates: readyGates,
    });
    const older = await applyPersistentOpportunityObservation(userId, created.opportunityId, {
      bar: closedBar(9, 2051, 2052, 2048),
      gates: readyGates,
    });

    expect(first.snapshot.status).toBe("NEAR_TRIGGER");
    expect(duplicate.version).toBe(first.version);
    expect(older.version).toBe(first.version);
    expect(duplicate.snapshot.events).toHaveLength(2);
    expect(older.snapshot.events).toHaveLength(2);

    const eventCount = await db.opportunityEvent.count({
      where: { opportunityId: created.opportunityId },
    });
    expect(eventCount).toBe(2);
  });

  test("terminal opportunities persist one trigger event and stay terminal", async () => {
    const userId = await createTestUser();
    const created = await createPersistentOpportunity(userId, makeCandidate("setup-terminal"));
    const triggered = await applyPersistentOpportunityObservation(userId, created.opportunityId, {
      bar: closedBar(10, 2051, 2052, 2049),
      gates: readyGates,
    });
    const after = await applyPersistentOpportunityObservation(userId, created.opportunityId, {
      bar: closedBar(11, 2030, 2055, 2020),
      gates: readyGates,
    });

    expect(triggered.snapshot.status).toBe("TRIGGERED");
    expect(after.snapshot.status).toBe("TRIGGERED");
    expect(after.snapshot.events.filter((event) => event.type === "TRIGGERED")).toHaveLength(1);
    expect(after.version).toBe(triggered.version);
  });

  test("user-scoped reads do not disclose another user's opportunity", async () => {
    const ownerId = await createTestUser();
    const otherUserId = await createTestUser();
    const created = await createPersistentOpportunity(ownerId, makeCandidate("setup-private"));

    expect(await getPersistentOpportunity(otherUserId, created.opportunityId)).toBeNull();
    expect(await listPersistentOpportunities(otherUserId)).toHaveLength(0);
    expect(await listPersistentOpportunities(ownerId)).toHaveLength(1);
  });

  test("the same deterministic dedupe key is isolated between users", async () => {
    const firstUser = await createTestUser();
    const secondUser = await createTestUser();
    const candidate = makeCandidate("same-id-different-owner");

    const first = await createPersistentOpportunity(firstUser, candidate);
    const second = await createPersistentOpportunity(secondUser, candidate);

    expect(first.created).toBe(true);
    expect(second.created).toBe(true);
    expect(first.snapshot.candidate.id).toBe(second.snapshot.candidate.id);
    expect(first.opportunityId).not.toBe(second.opportunityId);
    expect(await listPersistentOpportunities(firstUser)).toHaveLength(1);
    expect(await listPersistentOpportunities(secondUser)).toHaveLength(1);
  });
});
