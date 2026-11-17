/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import {
  applyClosedBarObservation,
  createOrGetOpportunity,
  getUserOpportunity,
  listUserOpportunities,
} from "./store";
import type {
  OpportunityCandidate,
  OpportunityGates,
} from "@/lib/engine/opportunity-lifecycle";
import type { Bar } from "@/lib/engine/types";

const MINUTE = 60_000;
const CREATED_AT = Date.UTC(2026, 10, 17, 12, 0, 0);
const gates: OpportunityGates = {
  marketFresh: true,
  datasetAllowed: true,
  signalAllowed: true,
  htfAllowed: true,
};

const ownedUsers: string[] = [];

async function createTestUser(label: string): Promise<string> {
  const user = await db.user.create({
    data: {
      email: label + "-" + crypto.randomUUID() + "@ami-opportunity-test.invalid",
      name: "AMI opportunity store test",
      passwordHash: "not-a-real-password-hash",
      isDemo: true,
    },
  });
  ownedUsers.push(user.id);
  return user.id;
}

function makeCandidate(
  overrides: Partial<OpportunityCandidate> = {}
): OpportunityCandidate {
  return {
    id: "store-test-setup-001",
    symbol: "XAUUSD-DUKA",
    timeframe: "15m",
    strategyKey: "manual",
    direction: "long",
    triggerPrice: 2050,
    invalidationPrice: 2040,
    nearDistance: 2,
    createdAtTs: CREATED_AT,
    expiresAtTs: CREATED_AT + 60 * MINUTE,
    evidence: [{
      source: "manual",
      code: "STORE_TEST",
      description: "Deterministic store integration fixture.",
      observedAtTs: CREATED_AT,
    }],
    ...overrides,
  };
}

function closedBar(
  minuteIndex: number,
  values: Partial<Pick<Bar, "o" | "h" | "l" | "c">>
): Bar {
  const openTime = CREATED_AT + minuteIndex * MINUTE;
  const close = values.c ?? 2045;
  return {
    t: openTime,
    ct: openTime + MINUTE - 1,
    o: values.o ?? close - 0.2,
    h: values.h ?? close + 0.5,
    l: values.l ?? close - 0.5,
    c: close,
    v: 10,
  };
}

afterEach(async () => {
  if (ownedUsers.length > 0) {
    await db.user.deleteMany({ where: { id: { in: [...ownedUsers] } } });
    ownedUsers.length = 0;
  }
});

describe("durable user-scoped opportunity store", () => {
  test("creates a WATCH snapshot and sequence-zero CREATED event atomically", async () => {
    const userId = await createTestUser("created");
    const result = await createOrGetOpportunity(userId, makeCandidate());

    expect(result.outcome).toBe("CREATED");
    expect(result.snapshot.status).toBe("WATCH");
    expect(result.version).toBe(1);
    expect(result.snapshot.events).toHaveLength(1);
    expect(result.snapshot.events[0]).toMatchObject({
      type: "CREATED",
      fromStatus: null,
      toStatus: "WATCH",
    });

    const rows = await db.opportunityEvent.findMany({
      where: { opportunityId: result.id },
      orderBy: { sequence: "asc" },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].sequence).toBe(0);
    expect(rows[0].type).toBe("CREATED");
  });

  test("retries with the same idempotency key return the existing record without duplicate events", async () => {
    const userId = await createTestUser("idempotent");
    const first = await createOrGetOpportunity(userId, makeCandidate());
    const retry = await createOrGetOpportunity(userId, makeCandidate({
      createdAtTs: CREATED_AT + 500,
      evidence: [{
        source: "manual",
        code: "STORE_TEST",
        description: "Deterministic store integration fixture.",
        observedAtTs: CREATED_AT + 500,
      }],
    }));

    expect(first.outcome).toBe("CREATED");
    expect(retry.outcome).toBe("EXISTING");
    expect(retry.id).toBe(first.id);
    expect(retry.version).toBe(1);
    expect(retry.snapshot.events).toHaveLength(1);

    const eventCount = await db.opportunityEvent.count({
      where: { opportunityId: first.id },
    });
    expect(eventCount).toBe(1);
  });

  test("reusing an idempotency key with different setup parameters returns a conflict", async () => {
    const userId = await createTestUser("conflict");
    const first = await createOrGetOpportunity(userId, makeCandidate());
    const conflicting = await createOrGetOpportunity(userId, makeCandidate({
      triggerPrice: 2060,
    }));

    expect(first.outcome).toBe("CREATED");
    expect(conflicting.outcome).toBe("CONFLICT");
    expect(conflicting.id).toBe(first.id);
    expect(conflicting.snapshot.candidate.triggerPrice).toBe(2050);
  });

  test("the same idempotency key is isolated between different users", async () => {
    const firstUser = await createTestUser("user-a");
    const secondUser = await createTestUser("user-b");

    const first = await createOrGetOpportunity(firstUser, makeCandidate());
    const second = await createOrGetOpportunity(secondUser, makeCandidate());

    expect(first.outcome).toBe("CREATED");
    expect(second.outcome).toBe("CREATED");
    expect(second.id).not.toBe(first.id);

    expect(await getUserOpportunity(firstUser, second.id)).toBeNull();
    expect(await getUserOpportunity(secondUser, first.id)).toBeNull();
    expect(await listUserOpportunities({ userId: firstUser })).toHaveLength(1);
    expect(await listUserOpportunities({ userId: secondUser })).toHaveLength(1);
  });

  test("closed-bar transitions append ordered events and duplicate bars are idempotent", async () => {
    const userId = await createTestUser("transitions");
    const created = await createOrGetOpportunity(userId, makeCandidate());

    const nearBar = closedBar(1, {
      o: 2048.7,
      h: 2049.5,
      l: 2048.5,
      c: 2049,
    });
    const near = await applyClosedBarObservation(userId, created.id, {
      bar: nearBar,
      gates,
    });
    expect(near?.outcome).toBe("UPDATED");
    expect(near?.snapshot.status).toBe("NEAR_TRIGGER");
    expect(near?.version).toBe(2);

    const replay = await applyClosedBarObservation(userId, created.id, {
      bar: nearBar,
      gates,
    });
    expect(replay?.outcome).toBe("UNCHANGED");
    expect(replay?.version).toBe(2);
    expect(replay?.snapshot.events).toHaveLength(2);

    const trigger = await applyClosedBarObservation(userId, created.id, {
      bar: closedBar(2, {
        o: 2049,
        h: 2051,
        l: 2048.5,
        c: 2050.5,
      }),
      gates,
    });
    expect(trigger?.outcome).toBe("UPDATED");
    expect(trigger?.snapshot.status).toBe("TRIGGERED");
    expect(trigger?.version).toBe(3);
    expect(trigger?.snapshot.events.map((event) => event.type)).toEqual([
      "CREATED",
      "NEAR_TRIGGER",
      "TRIGGERED",
    ]);

    const rows = await db.opportunityEvent.findMany({
      where: { opportunityId: created.id },
      orderBy: { sequence: "asc" },
    });
    expect(rows.map((event) => event.sequence)).toEqual([0, 1, 2]);
    expect(rows.map((event) => event.type)).toEqual([
      "CREATED",
      "NEAR_TRIGGER",
      "TRIGGERED",
    ]);
  });

  test("a same-bar trigger and invalidation persists INVALIDATED, not TRIGGERED", async () => {
    const userId = await createTestUser("invalidation");
    const created = await createOrGetOpportunity(userId, makeCandidate());

    const result = await applyClosedBarObservation(userId, created.id, {
      bar: closedBar(1, {
        o: 2045,
        h: 2051,
        l: 2039,
        c: 2049,
      }),
      gates,
    });

    expect(result?.snapshot.status).toBe("INVALIDATED");
    expect(result?.snapshot.triggeredAtTs).toBeNull();
    expect(result?.snapshot.invalidatedAtTs).toBe(CREATED_AT + 2 * MINUTE - 1);
    expect(result?.snapshot.events.at(-1)?.type).toBe("INVALIDATED");
  });

  test("observation storage never leaks records across user boundaries", async () => {
    const owner = await createTestUser("owner");
    const other = await createTestUser("other");
    const created = await createOrGetOpportunity(owner, makeCandidate());

    const notVisible = await applyClosedBarObservation(other, created.id, {
      bar: closedBar(1, { c: 2049, h: 2049.5, l: 2048.5 }),
      gates,
    });

    expect(notVisible).toBeNull();
    expect(await getUserOpportunity(other, created.id)).toBeNull();
    const owned = await getUserOpportunity(owner, created.id);
    expect(owned?.snapshot.status).toBe("WATCH");
    expect(owned?.version).toBe(1);
  });
});
