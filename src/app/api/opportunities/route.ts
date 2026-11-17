import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/api";
import { getInstrument } from "@/lib/data/instruments";
import { getMarketInstrumentMetadata } from "@/lib/data/market-instrument-contract";
import { DatasetStoreError, loadMarketDataset } from "@/lib/data/market-dataset-store";
import { assessMarketDatasetUse } from "@/lib/data/market-dataset-policy";
import { TIMEFRAMES } from "@/lib/engine/types";
import {
  createPersistentOpportunity,
  listPersistentOpportunities,
} from "@/lib/engine/opportunity-store";
import { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

const evidenceSchema = z.object({
  source: z.enum(["strategy", "structure", "displacement-zone", "analyst", "manual"]),
  code: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  observedAtTs: z.number().finite().positive(),
}).strict();

const candidateSchema = z.object({
  id: z.string().min(1).max(160).regex(/^[a-zA-Z0-9._:-]+$/),
  symbol: z.string().min(1).max(80),
  timeframe: z.string().min(1).max(12),
  strategyKey: z.string().min(1).max(100),
  direction: z.enum(["long", "short"]),
  triggerPrice: z.number().finite().positive(),
  invalidationPrice: z.number().finite().positive(),
  nearDistance: z.number().finite().positive(),
  createdAtTs: z.number().finite().positive(),
  expiresAtTs: z.number().finite().positive(),
  datasetId: z.string().min(16).max(180).optional(),
  evidence: z.array(evidenceSchema).min(1).max(30),
}).strict();

const statusValues = [
  "WATCH",
  "NEAR_TRIGGER",
  "TRIGGERED",
  "INVALIDATED",
  "EXPIRED",
  "SUPPRESSED",
] as const;

export async function GET(req: NextRequest) {
  const guard = await requireSession();
  if (!guard.ok) return guard.res;

  const rawLimit = Number(req.nextUrl.searchParams.get("limit") ?? 50);
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(Math.floor(rawLimit), 200))
    : 50;
  const requestedStatus = req.nextUrl.searchParams.get("status");
  if (requestedStatus && !statusValues.includes(requestedStatus as typeof statusValues[number])) {
    return NextResponse.json({ error: "INVALID_OPPORTUNITY_STATUS" }, { status: 400 });
  }

  try {
    const opportunities = await listPersistentOpportunities(guard.userId, {
      limit,
      status: requestedStatus as typeof statusValues[number] | undefined,
    });
    return NextResponse.json({
      opportunities,
      count: opportunities.length,
      limit,
    });
  } catch (error) {
    return NextResponse.json({
      error: "OPPORTUNITY_LIST_FAILED",
      message: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}

/**
 * Initial API slice creates explicitly manual, timestamped WATCH candidates.
 * Automatic strategy/zone sourcing is intentionally not exposed until trusted
 * server-side freshness and HTF gate adapters are connected.
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

  const candidate = parsed.data;
  if (!TIMEFRAMES.includes(candidate.timeframe as typeof TIMEFRAMES[number])) {
    return NextResponse.json({ error: "UNSUPPORTED_TIMEFRAME" }, { status: 400 });
  }
  if (!getInstrument(candidate.symbol) && !getMarketInstrumentMetadata(candidate.symbol)) {
    return NextResponse.json({ error: "UNKNOWN_INSTRUMENT" }, { status: 400 });
  }
  if (!candidate.evidence.some((item) => item.source === "manual")) {
    return NextResponse.json({
      error: "MANUAL_EVIDENCE_REQUIRED",
      message: "This endpoint currently accepts manual WATCH candidates only; automatic evidence sources are not yet connected.",
    }, { status: 400 });
  }

  const now = Date.now();
  if (
    candidate.createdAtTs > now + 60_000 ||
    candidate.createdAtTs < now - 24 * 60 * 60_000 ||
    candidate.expiresAtTs <= now ||
    candidate.expiresAtTs - candidate.createdAtTs > 30 * 24 * 60 * 60_000
  ) {
    return NextResponse.json({
      error: "CANDIDATE_TIME_WINDOW_INVALID",
      message: "Manual candidates must be recently created and expire within 30 days of creation.",
    }, { status: 400 });
  }

  if (candidate.datasetId) {
    try {
      const dataset = await loadMarketDataset(candidate.datasetId);
      if (dataset.manifest.instrument.id !== candidate.symbol) {
        return NextResponse.json({ error: "DATASET_INSTRUMENT_MISMATCH" }, { status: 400 });
      }
      const policy = assessMarketDatasetUse(dataset.manifest);
      if (!policy.signalResearch.allowed) {
        return NextResponse.json({
          error: "DATASET_NOT_ELIGIBLE_FOR_SIGNAL_RESEARCH",
          reasons: policy.signalResearch.reasons,
        }, { status: 422 });
      }
    } catch (error) {
      const status = error instanceof DatasetStoreError
        ? error.code === "DATASET_NOT_FOUND" ? 404
          : error.code === "REVIEW_REQUIRES_OPT_IN" ? 409
          : 422
        : 500;
      return NextResponse.json({
        error: error instanceof DatasetStoreError ? error.code : "DATASET_VERIFICATION_FAILED",
        message: error instanceof Error ? error.message : String(error),
      }, { status });
    }
  }

  try {
    const result = await createPersistentOpportunity(guard.userId, {
      ...candidate,
      timeframe: candidate.timeframe,
    });
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "OPPORTUNITY_DEDUPE_CONFLICT" }, { status: 409 });
    }
    return NextResponse.json({
      error: "OPPORTUNITY_CREATE_FAILED",
      message: error instanceof Error ? error.message : String(error),
    }, { status: 400 });
  }
}
