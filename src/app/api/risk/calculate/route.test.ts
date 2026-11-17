/// <reference types="bun-types" />

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest, NextResponse } from "next/server";

let authenticated = true;

mock.module("@/lib/api", () => ({
  requireSession: async () => authenticated
    ? { ok: true, session: {} as never, userId: "risk-api-test-user" }
    : {
        ok: false,
        res: NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 }),
      },
}));

const { POST } = await import("./route");

function makeRequest(body: string | Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/risk/calculate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    instrumentId: "XAUUSD-DUKA",
    accountCurrency: "USD",
    accountEquity: 10_000,
    riskPercent: 0.5,
    availableMargin: 2_000,
    maxLeverage: 5,
    direction: "long",
    quotes: {
      entry: { bid: 2049.9, ask: 2050 },
      stop: { bid: 2040, ask: 2040.1 },
      target: { bid: 2070, ask: 2070.1 },
    },
    ...overrides,
  };
}

describe("POST /api/risk/calculate", () => {
  beforeEach(() => {
    authenticated = true;
  });

  test("rejects unauthenticated requests before parsing or calculating", async () => {
    authenticated = false;
    const response = await POST(makeRequest("{"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "UNAUTHENTICATED" });
  });

  test("rejects malformed JSON", async () => {
    const response = await POST(makeRequest("{"));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "INVALID_JSON" });
  });

  test("requires an uppercase three-letter account currency", async () => {
    const missing = { ...validBody() };
    delete (missing as Record<string, unknown>).accountCurrency;
    const lowerCase = validBody({ accountCurrency: "usd" });

    const missingResponse = await POST(makeRequest(missing));
    const lowerResponse = await POST(makeRequest(lowerCase));

    expect(missingResponse.status).toBe(400);
    expect(lowerResponse.status).toBe(400);
    expect(await lowerResponse.json()).toMatchObject({ error: "INVALID_RISK_INPUT" });
  });

  test("rejects client-supplied contract multipliers and margin facts", async () => {
    const response = await POST(makeRequest(validBody({
      notionalMultiplier: 100,
      pointValue: 10,
      initialMarginRate: 0.1,
    })));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "INVALID_RISK_INPUT" });
  });

  test("returns explicit calculation-only NO_TRADE for unverified XAU/USD economics", async () => {
    const response = await POST(makeRequest(validBody()));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.operation).toBe("CALCULATION_ONLY");
    expect(body.liveOrdersEnabled).toBe(false);
    expect(body.instrument).toMatchObject({
      id: "XAUUSD-DUKA",
      quoteCurrency: "USD",
      pnlCurrency: "USD",
      accountCurrency: "USD",
    });
    expect(body.result.status).toBe("NO_TRADE");
    expect(body.result.reasons).toContain("CONTRACT_ECONOMICS_UNVERIFIED");
    expect(body.result.reasons).toContain("EXECUTION_COSTS_UNVERIFIED");
    expect(body.result.reasons).toContain("INITIAL_MARGIN_REQUIREMENT_UNVERIFIED");
  });

  test("NQZ6 returns NO_TRADE until dated-contract costs and margin are verified", async () => {
    const response = await POST(makeRequest(validBody({
      instrumentId: "NQZ6",
      quotes: {
        entry: { bid: 27342.25, ask: 27342.5 },
        stop: { bid: 27330.0, ask: 27330.25 },
        target: { bid: 27370.0, ask: 27370.25 },
      },
    })));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.instrument).toMatchObject({
      id: "NQZ6",
      dataClass: "EXCHANGE_FUTURES",
      pnlCurrency: "USD",
      quoteCurrency: "USD",
    });
    expect(body.result.status).toBe("NO_TRADE");
    expect(body.result.reasons).toContain("EXECUTION_COSTS_UNVERIFIED");
    expect(body.result.reasons).toContain("INITIAL_MARGIN_REQUIREMENT_UNVERIFIED");
    expect(body.result.reasons).not.toContain("CONTRACT_ECONOMICS_UNVERIFIED");
  });

  test("returns 404 for unknown canonical instruments without using a fallback", async () => {
    const response = await POST(makeRequest(validBody({ instrumentId: "NAS100" })));
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: "UNKNOWN_INSTRUMENT" });
  });

  test("crossed executable quotes are rejected by the calculator", async () => {
    const response = await POST(makeRequest(validBody({
      quotes: {
        entry: { bid: 2050.1, ask: 2050 },
        stop: { bid: 2040, ask: 2040.1 },
        target: { bid: 2070, ask: 2070.1 },
      },
    })));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.result.status).toBe("NO_TRADE");
    expect(body.result.reasons).toContain("EXECUTION_QUOTES_CROSSED");
  });
});
