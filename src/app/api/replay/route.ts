import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/api";
import {
  loadMarketDataset,
  DatasetStoreError,
} from "@/lib/data/market-dataset-store";
import { assessMarketDatasetUse } from "@/lib/data/market-dataset-policy";
import { sha256Hex } from "@/lib/data/market-dataset";
import { createStructureBreakRetestMachine } from "@/lib/engine/replay/detectors/structure-break-retest-detector";
import {
  REPLAY_ENGINE_VERSION,
  runHistoricalReplay,
  type ReplayResult,
} from "@/lib/engine/replay/replay-engine";
import {
  getPersistentReplay,
  listPersistentReplays,
  persistHistoricalReplay,
  ReplayStoreError,
} from "@/lib/engine/replay/replay-store";

export const dynamic = "force-dynamic";

const replayBodySchema = z.object({
  datasetId: z.string().min(16).max(180),
  /** UTC epoch milliseconds. Interval membership is based on candle open time. */
  fromTs: z.number().finite().positive(),
  toTs: z.number().finite().positive(),
  warmupBars: z.number().int().min(0).max(20_000).default(200),
  allowReview: z.boolean().default(false),
  detector: z.object({
    leftBars: z.number().int().min(1).max(20).default(3),
    rightBars: z.number().int().min(1).max(20).default(3),
    maxBarsAfterBreak: z.number().int().min(1).max(500).default(12),
    maxBarsAfterRetest: z.number().int().min(1).max(500).default(8),
  }).strict().default({}),
}).strict();

function toPublicReplay(replay: Awaited<ReturnType<typeof getPersistentReplay>>) {
  if (!replay) return null;
  return {
    id: replay.id,
    runKey: replay.runKey,
    instrumentId: replay.instrumentId,
    timeframe: replay.timeframe,
    source: {
      provider: replay.provider,
      sourceId: replay.sourceId,
      dataClass: replay.dataClass,
      revisionId: replay.revisionId,
      revisionHash: replay.revisionHash,
    },
    detectorId: replay.detectorId,
    detectorVersion: replay.detectorVersion,
    paramsHash: replay.paramsHash,
    engineVersion: replay.engineVersion,
    interval: {
      fromTs: replay.intervalFromTs,
      toTs: replay.intervalToTs,
    },
    warmupBarsRequested: replay.warmupBarsRequested,
    warmupBarsUsed: replay.warmupBarsUsed,
    inputBars: replay.inputBars,
    evaluatedBars: replay.evaluatedBars,
    origin: replay.origin,
    createdAt: replay.createdAt,
    events: replay.events.map((event) => ({
      id: event.eventIdentity,
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
      evidence: JSON.parse(event.evidenceJson) as unknown[],
      origin: event.origin,
    })),
  };
}

export async function GET(req: NextRequest) {
  const guard = await requireSession();
  if (!guard.ok) return guard.res;

  const replayId = req.nextUrl.searchParams.get("replayId");
  try {
    if (replayId) {
      const replay = await getPersistentReplay(guard.userId, replayId);
      if (!replay) return NextResponse.json({ error: "REPLAY_NOT_FOUND" }, { status: 404 });
      return NextResponse.json({ replay: toPublicReplay(replay) });
    }

    const rawLimit = Number(req.nextUrl.searchParams.get("limit") ?? 20);
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(Math.floor(rawLimit), 1), 100)
      : 20;
    const instrumentId = req.nextUrl.searchParams.get("instrumentId") ?? undefined;
    const replays = await listPersistentReplays(guard.userId, { limit, instrumentId });
    return NextResponse.json({
      replays: replays.map((replay) => toPublicReplay(replay)),
      count: replays.length,
      limit,
    });
  } catch {
    return NextResponse.json({ error: "REPLAY_READ_FAILED" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = await requireSession();
  if (!guard.ok) return guard.res;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = replayBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({
      error: "INVALID_REPLAY_REQUEST",
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path,
        code: issue.code,
        message: issue.message,
      })),
    }, { status: 400 });
  }

  const input = parsed.data;
  if (input.toTs < input.fromTs) {
    return NextResponse.json({
      error: "INVALID_REPLAY_INTERVAL",
      message: "toTs must be greater than or equal to fromTs.",
    }, { status: 400 });
  }

  try {
    const dataset = await loadMarketDataset(input.datasetId, {
      allowReview: input.allowReview,
    });
    const policy = assessMarketDatasetUse(dataset.manifest, {
      allowReview: input.allowReview,
    });
    if (!policy.signalResearch.allowed) {
      return NextResponse.json({
        error: "DATASET_NOT_ALLOWED_FOR_REPLAY",
        reasons: policy.signalResearch.reasons,
      }, { status: 422 });
    }

    const allBars = dataset.bars;
    const firstRequestedIndex = allBars.findIndex((bar) =>
      bar.t >= input.fromTs && bar.t <= input.toTs
    );
    if (firstRequestedIndex < 0) {
      return NextResponse.json({
        error: "NO_BARS_IN_REPLAY_INTERVAL",
        message: "The selected immutable dataset has no candle opens in the requested UTC interval.",
        availableFromTs: dataset.manifest.actualCoverage.fromTs,
        availableToTs: dataset.manifest.actualCoverage.toTs,
      }, { status: 422 });
    }
    const lastRequestedIndex = allBars.findLastIndex((bar) =>
      bar.t >= input.fromTs && bar.t <= input.toTs
    );
    const startIndex = firstRequestedIndex - input.warmupBars;
    if (startIndex < 0) {
      return NextResponse.json({
        error: "INSUFFICIENT_WARMUP",
        requestedWarmupBars: input.warmupBars,
        availableWarmupBars: firstRequestedIndex,
        message: "Import more history before the selected review window or reduce warmupBars.",
      }, { status: 422 });
    }

    const bars = allBars.slice(startIndex, lastRequestedIndex + 1);
    const detectorOptions = input.detector;
    const detector = createStructureBreakRetestMachine(detectorOptions);
    const paramsHash = await sha256Hex(JSON.stringify({
      detectorId: detector.detectorId,
      detectorVersion: detector.detectorVersion,
      options: detectorOptions,
    }));
    const result: ReplayResult = runHistoricalReplay({
      instrumentId: dataset.manifest.instrument.id,
      timeframe: dataset.manifest.interval.timeframe,
      source: {
        provider: dataset.manifest.provenance.provider,
        sourceId: dataset.manifest.provenance.providerInstrument +
          ":" + dataset.manifest.pricing.datasetPriceSide.toUpperCase(),
        dataClass: dataset.manifest.instrument.dataClass,
        revisionId: dataset.manifest.datasetId,
        revisionHash: dataset.manifest.provenance.normalizedSha256,
      },
      interval: { fromTs: input.fromTs, toTs: input.toTs },
      warmupBars: input.warmupBars,
      paramsHash,
      engineVersion: REPLAY_ENGINE_VERSION,
      bars,
      machine: detector,
    });

    const stored = await persistHistoricalReplay(guard.userId, result);
    const replay = toPublicReplay(stored.replay);
    if (stored.conflict) {
      return NextResponse.json({
        error: "REPLAY_DETERMINISM_CONFLICT",
        message: "This replay identity already exists with different output. The existing immutable result was preserved.",
        replay,
      }, { status: 409 });
    }

    return NextResponse.json({
      outcome: stored.created ? "CREATED" : "EXISTING",
      replay,
      datasetPolicy: policy,
      dataLimitations: [
        "This run uses one imported Dukascopy " +
          dataset.manifest.pricing.datasetPriceSide.toUpperCase() +
          " candle side, not a bid/ask-paired midpoint.",
        "Signal research only; this result does not model spread, fills, fees, slippage or broker execution.",
        "Instrument trading sessions are unverified; interval timestamps are UTC candle-open timestamps.",
        "Historical replay records when the detector could know a setup, not when a hindsight chart marker might appear.",
      ],
      execution: {
        enabled: false,
        ordersSubmitted: false,
        fillsCreated: false,
      },
    }, { status: stored.created ? 201 : 200 });
  } catch (error) {
    if (error instanceof DatasetStoreError) {
      const status = error.code === "DATASET_NOT_FOUND" ? 404 :
        error.code === "REVIEW_REQUIRES_OPT_IN" || error.code === "DATASET_REJECTED" ? 422 : 400;
      return NextResponse.json({
        error: error.code,
        message: error.message,
      }, { status });
    }
    if (error instanceof ReplayStoreError) {
      return NextResponse.json({
        error: error.code,
        message: error.message,
      }, { status: 422 });
    }
    return NextResponse.json({
      error: "HISTORICAL_REPLAY_FAILED",
      message: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}
