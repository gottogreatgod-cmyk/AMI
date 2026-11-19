/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

let authenticated = true;
let sessionUserId = "";

mock.module("@/lib/api", () => ({
  requireSession: async () => authenticated && sessionUserId
    ? { ok: true, session: {} as never, userId: sessionUserId }
    : {
        ok: false,
        res: NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 }),
      },
}));

const { GET, POST } = await import("./route");
const ownedUsers: string[] = [];

async function createTestUser(label: string): Promise<string> {
  const user = await db.user.create({
    data: {
      email: label + "-" + crypto.randomUUID() + "@ami-opportunity-api.invalid",
      passwordHash: "not-a-real-password-hash",
      name: "AMI opportunity API test",
      isDemo: true,
    },
  });
  ownedUsers.push(user.id);
  return user.id;
}

function makeCandidate(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    idempotencyKey: "manual-opportunity-" + crypto.randomUUID(),
    symbol: "XAUUSD-DUKA",
    timeframe: "15m",
    strategyKey: "manual",
    direction: "long",
    triggerPrice: 2050,
    invalidationPrice: 2040,
    nearDistance: 2,
    expiresAtTs: now + 60 * 60_000,
    evidence: {
      code: "MANUAL_RESEARCH",
      description: "Manually recorded research setup for the API integration test.",
    },
    ...overrides,
  };
}

function postRequest(body: string | Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/opportunities", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function getRequest(query = ""): NextRequest {
  return new NextRequest("http://localhost/api/opportunities" + query);
}

beforeEach(async () => {
  authenticated = true;
  sessionUserId = await createTestUser("owner");
});

afterEach(async () => {
  const ids = ownedUsers.splice(0);
  if (ids.length > 0) {
    await db.user.deleteMany({ where: { id: { in: ids } } });
  }
});

describe("/api/opportunities", () => {
  test("requires authentication for both list and create", async () => {
    authenticated = false;
    const list = await GET(getRequest());
    const create = await POST(postRequest("{"));

    expect(list.status).toBe(401);
    expect(create.status).toBe(401);
    expect(await create.json()).toMatchObject({ error: "UNAUTHENTICATED" });
  });

  test("rejects malformed JSON and unknown fields, including client-supplied lifecycle timestamps", async () => {
    const malformed = await POST(postRequest("{"));
    const spoofed = await POST(postRequest({
      ...makeCandidate(),
      createdAtTs: Date.now() - 1000,
      status: "TRIGGERED",
      lastProcessedBarCloseTs: Date.now(),
    }));

    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: "INVALID_JSON" });
    expect(spoofed.status).toBe(400);
    expect(await spoofed.json()).toMatchObject({ error: "INVALID_OPPORTUNITY_CANDIDATE" });
  });

  test("rejects client-supplied evidence source and observed timestamp", async () => {
    const response = await POST(postRequest({
      ...makeCandidate(),
      evidence: {
        source: "strategy",
        code: "AUTOMATED_SIGNAL",
        description: "Client cannot assert trusted strategy evidence.",
        observedAtTs: Date.now(),
      },
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "INVALID_OPPORTUNITY_CANDIDATE" });
  });

  test("creates a manual WATCH candidate with server-owned timestamps and no execution side effects", async () => {
    const before = Date.now();
    const response = await POST(postRequest(makeCandidate()));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.outcome).toBe("CREATED");
    expect(body.opportunity.status).toBe("WATCH");
    expect(body.opportunity.events[0].type).toBe("CREATED");
    expect(body.opportunity.candidate.evidence[0].source).toBe("manual");
    expect(body.opportunity.candidate.createdAtTs).toBeGreaterThanOrEqual(before);
    expect(body.opportunity.candidate.evidence[0].observedAtTs).toBeGreaterThanOrEqual(before);
    expect(body.execution).toMatchObject({
      enabled: false,
      orderSubmitted: false,
    });
  });

  test("same idempotency key and same immutable candidate returns EXISTING without duplicate events", async () => {
    const candidate = makeCandidate();
    const first = await POST(postRequest(candidate));
    const firstBody = await first.json();
    const retry = await POST(postRequest(candidate));
    const retryBody = await retry.json();

    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retryBody.outcome).toBe("EXISTING");
    expect(retryBody.opportunity.id).toBe(firstBody.opportunity.id);
    expect(retryBody.opportunity.events).toHaveLength(1);

    const count = await db.opportunityEvent.count({
      where: { opportunityId: firstBody.opportunity.id },
    });
    expect(count).toBe(1);
  });

  test("same idempotency key with changed setup terms returns a conflict", async () => {
    const candidate = makeCandidate();
    const first = await POST(postRequest(candidate));
    const firstBody = await first.json();
    const conflict = await POST(postRequest({
      ...candidate,
      triggerPrice: 2060,
    }));

    expect(first.status).toBe(201);
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      error: "IDEMPOTENCY_KEY_CONFLICT",
      opportunityId: firstBody.opportunity.id,
    });
  });

  test("does not allow a user to reference another user's strategy", async () => {
    const candidate = makeCandidate({ strategyKey: "someone-elses-strategy" });
    const response = await POST(postRequest(candidate));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "STRATEGY_NOT_FOUND_FOR_USER" });
  });

  test("lists only the authenticated user's opportunities and validates status filters", async () => {
    const created = await POST(postRequest(makeCandidate()));
    expect(created.status).toBe(201);

    const ownerList = await GET(getRequest("?status=WATCH&limit=10"));
    const ownerBody = await ownerList.json();
    expect(ownerList.status).toBe(200);
    expect(ownerBody.count).toBe(1);
    expect(ownerBody.opportunities[0].snapshot.status).toBe("WATCH");

    sessionUserId = await createTestUser("other");
    const otherList = await GET(getRequest());
    const otherBody = await otherList.json();
    expect(otherList.status).toBe(200);
    expect(otherBody.count).toBe(0);

    const invalidStatus = await GET(getRequest("?status=FILLED"));
    expect(invalidStatus.status).toBe(400);
    expect(await invalidStatus.json()).toMatchObject({ error: "INVALID_OPPORTUNITY_STATUS" });
  });

  test("rejects expiry outside the next thirty days", async () => {
    const response = await POST(postRequest(makeCandidate({
      expiresAtTs: Date.now() + 31 * 24 * 60 * 60_000,
    })));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "CANDIDATE_EXPIRY_INVALID" });
  });
});
