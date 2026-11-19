import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/api";
import { getInstrument } from "@/lib/data/instruments";
import { getMarketInstrumentMetadata } from "@/lib/data/market-instrument-contract";
import { DatasetStoreError, loadMarketDataset } from "@/lib/data/market-dataset-store";
import { assessMarketDatasetUse } from "@/lib/data/market-dataset-policy";
import { TIMEFRAMES } from "@/lib/engine/types";
import type { OpportunityCandidate, OpportunityStatus } from "@/lib/engine/opportunity-lifecycle";
import {
  createPersistentOpportunity,
  listPersistentOpportunities,
} from "@/lib/engine/opportunity-store";

export const dynamic = "force-dynamic";

const statusValues = [
  "WATCH",
  "NEAR_TRIGGER",
  "TRIGGERED",
  "INVALIDATED",
  "EXPIRED",
  "SUPPRESSED",
] as const;

const candidateSchema = z.object({
  /** Stable per-user idempotency key. */
  idempotencyKey: z.string()
    .min(8)
    .max(160)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/),
  symbol: z.string().min(1).max(80),
  timeframe: z.enum(TIMEFRAMES),
  strategyKey: z.string().min(1).max(100).default("manual"),
  direction: z.enum(["long", "short"]),
  triggerPrice: z.number().finite().positive(),
  invalidationPrice: z.number().finite().positive(),
  nearDistance: z.number().finite().positive(),
  /** Absolute expiry in UTC epoch milliseconds; creation/evidence times are server-generated. */
  expiresAtTs: z.number().finite().positive(),
  datasetId: z.string().min(16).max(180).optional(),
  evidence: z.object({
    code: z.string().min(1).max(100),
    description: z.string().min(1).max(500),
  }).strict(),
}).strict();

function datasetTimeframe(value: string): string | null {
  const mapping: Record<string, string> = {
    m1: "1m",
    m15: "15m",
    h1: "1h",
    h4: "4h",
    d1: "1d",
  };
  return mapping[value] ?? null;
}

function isKnownInstrument(symbol: string): boolean {
  return Boolean(getInstrument(symbol) || getMarketInstrumentMetadata(symbol));
}

/**
 * List only the signed-in user's opportunities and append-only event histories.
 * This route never fetches bars or calculates a lifecycle transition.
 */
export async function GET(req: NextRequest) {
  const guard = await requireSession();
  if (!guard.ok) return guard.res;

  const requestedStatus = req.nextUrl.searchParams.get("status");
  if (
    requestedStatus &&
    !statusValues.includes(requestedStatus as (typeof statusValues)[number])
  ) {
    return NextResponse.json({
      error: "INVALID_OPPORTUNITY_STATUS",
      allowed: statusValues,
    }, { status: 400 });
  }

  const rawLimit = Number(req.nextUrl.searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.floor(rawLimit), 1), 200)
    : 50;

  try {
    const opportunities = await listPersistentOpportunities(guard.userId, {
      limit,
      status: requestedStatus as OpportunityStatus | undefined,
    });
    return NextResponse.json({
      opportunities,
      count: opportunities.length,
      limit,
    });
  } catch {
    return NextResponse.json({ error: "OPPORTUNITY_LIST_FAILED" }, { status: 500 });
  }
}

/**
 * Create a manually evidenced WATCH candidate.
 *
 * Market bars, freshness gates, lifecycle status, sizing, orders and fills
 * are intentionally not accepted from the client. A trusted server-side
 * worker must apply subsequent closed-bar observations.
 */
export async function POST(req: NextRequest) {
  const guard = await requireSession();
  if (!guard.ok) return guard.res;

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = candidateSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({
      error: "INVALID_OPPORTUNITY_CANDIDATE",
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path,
        code: issue.code,
        message: issue.message,
      })),
    }, { status: 400 });
  }

  const input = parsed.data;
  if (!isKnownInstrument(input.symbol)) {
    return NextResponse.json({ error: "UNKNOWN_INSTRUMENT" }, { status: 404 });
  }

  if (input.strategyKey !== "manual") {
    const strategy = await db.strategy.findFirst({
      where: { userId: guard.userId, key: input.strategyKey },
      select: { id: true },
    });
    if (!strategy) {
      return NextResponse.json({ error: "STRATEGY_NOT_FOUND_FOR_USER" }, { status: 404 });
    }
  }

  const now = Date.now();
  const maxExpiry = 30 * 24 * 60 * 60_000;
  if (input.expiresAtTs <= now || input.expiresAtTs > now + maxExpiry) {
    return NextResponse.json({
      error: "CANDIDATE_EXPIRY_INVALID",
      message: "Expiry must be in the future and no more than 30 days ahead.",
    }, { status: 400 });
  }

  if (input.datasetId) {
    try {
      const dataset = await loadMarketDataset(input.datasetId);
      if (dataset.manifest.instrument.id !== input.symbol) {
        return NextResponse.json({ error: "DATASET_INSTRUMENT_MISMATCH" }, { status: 400 });
      }
      const datasetTf = datasetTimeframe(dataset.manifest.interval.timeframe);
      if (!datasetTf || datasetTf !== input.timeframe) {
        return NextResponse.json({ error: "DATASET_TIMEFRAME_MISMATCH" }, { status: 400 });
      }
      const policy = assessMarketDatasetUse(dataset.manifest);
      if (!policy.signalResearch.allowed) {
        return NextResponse.json({
          error: "DATASET_NOT_ELIGIBLE_FOR_SIGNAL_RESEARCH",
          reasons: policy.signalResearch.reasons,
        }, { status: 422 });
      }
    } catch (error) {
      if (error instanceof DatasetStoreError) {
        return NextResponse.json({
          error: error.code,
          message: error.message,
        }, { status: error.code === "DATASET_NOT_FOUND" ? 404 : 422 });
      }
      return NextResponse.json({ error: "DATASET_VERIFICATION_FAILED" }, { status: 500 });
    }
  }

  const candidate: OpportunityCandidate = {
    id: input.idempotencyKey,
    symbol: input.symbol,
    timeframe: input.timeframe,
    strategyKey: input.strategyKey,
    direction: input.direction,
    triggerPrice: input.triggerPrice,
    invalidationPrice: input.invalidationPrice,
    nearDistance: input.nearDistance,
    createdAtTs: now,
    expiresAtTs: input.expiresAtTs,
    datasetId: input.datasetId,
    evidence: [{
      source: "manual",
      code: input.evidence.code,
      description: input.evidence.description,
      observedAtTs: now,
    }],
  };

  try {
    const result = await createPersistentOpportunity(guard.userId, candidate);
    if (result.conflict) {
      return NextResponse.json({
        error: "IDEMPOTENCY_KEY_CONFLICT",
        message: "This idempotency key already belongs to a different immutable setup.",
        opportunityId: result.opportunityId,
      }, { status: 409 });
    }

    return NextResponse.json({
      outcome: result.created ? "CREATED" : "EXISTING",
      opportunity: {
        id: result.opportunityId,
        version: result.version,
        ...result.snapshot,
      },
      execution: {
        enabled: false,
        orderSubmitted: false,
        note: "Opportunity lifecycle only; no order, fill, position or P&L is created.",
      },
    }, { status: result.created ? 201 : 200 });
  } catch {
    return NextResponse.json({ error: "OPPORTUNITY_CREATE_FAILED" }, { status: 500 });
  }
}
