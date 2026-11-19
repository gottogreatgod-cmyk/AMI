import { NextResponse, type NextRequest } from "next/server";
import { requireSession, badRequest } from "@/lib/api";
import { DatasetStoreError, loadMarketDataset } from "@/lib/data/market-dataset-store";
import {
  AGGREGATED_TIMEFRAME_MS,
  aggregateM1Bars,
  type AggregatedTimeframe,
} from "@/lib/data/timeframe-aggregation";

export const dynamic = "force-dynamic";

const TARGETS = Object.keys(AGGREGATED_TIMEFRAME_MS) as AggregatedTimeframe[];

function datasetError(error: unknown) {
  if (error instanceof DatasetStoreError) {
    const status =
      error.code === "DATASET_NOT_FOUND" ? 404 :
      error.code === "REVIEW_REQUIRES_OPT_IN" ? 409 :
      error.code === "INVALID_DATASET_ID" ? 400 :
      422;
    return NextResponse.json(
      { error: error.code, message: error.message },
      { status }
    );
  }
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json({ error: "DATASET_AGGREGATION_FAILED", message }, { status: 500 });
}

/**
 * Derive a higher UTC timeframe from one exact, hash-verified M1 revision.
 * Incomplete buckets are omitted and reported; no synthetic candles are created.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ datasetId: string }> }
) {
  const guard = await requireSession();
  if (!guard.ok) return guard.res;

  const { datasetId } = await ctx.params;
  const search = req.nextUrl.searchParams;
  const requestedTimeframe = search.get("timeframe") ?? "m5";
  if (!TARGETS.includes(requestedTimeframe as AggregatedTimeframe)) {
    return badRequest("timeframe must be one of: " + TARGETS.join(", ") + ".");
  }

  const rawLimit = Number(search.get("limit") ?? 1000);
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(Math.floor(rawLimit), 5000))
    : 1000;
  const rawBefore = search.get("beforeTs");
  const beforeTs = rawBefore === null ? null : Number(rawBefore);
  if (beforeTs !== null && (!Number.isFinite(beforeTs) || beforeTs <= 0)) {
    return badRequest("beforeTs must be a positive UTC epoch-millisecond timestamp.");
  }

  try {
    const loaded = await loadMarketDataset(datasetId);
    if (loaded.manifest.interval.timeframe !== "m1") {
      return NextResponse.json({
        error: "M1_SOURCE_REQUIRED",
        message: "Derived timeframe aggregation requires an exact M1 source revision.",
      }, { status: 422 });
    }

    const volumeSemantics = loaded.manifest.volume.semantics === "PROVIDER_REPORTED"
      ? "PROVIDER_REPORTED"
      : "UNAVAILABLE";
    const result = aggregateM1Bars({
      bars: loaded.bars,
      timeframe: requestedTimeframe as AggregatedTimeframe,
      volumeSemantics,
    });
    const eligible = beforeTs === null
      ? result.bars
      : result.bars.filter((bar) => bar.t < beforeTs);
    const bars = eligible.slice(Math.max(0, eligible.length - limit));

    return NextResponse.json({
      dataset: {
        datasetId: loaded.manifest.datasetId,
        instrument: loaded.manifest.instrument,
        sourceTimeframe: loaded.manifest.interval.timeframe,
        timeframe: result.timeframe,
        intervalMs: AGGREGATED_TIMEFRAME_MS[result.timeframe],
        priceSide: loaded.manifest.pricing.datasetPriceSide,
        sourceRevisionHash: loaded.manifest.provenance.normalizedSha256,
        volumeSemantics: result.outputVolumeSemantics,
        sourceVolumeSemantics: result.volumeSemantics,
        qualityStatus: loaded.manifest.quality.qualityStatus,
      },
      bars,
      aggregation: {
        sourceBars: result.sourceBars,
        completeBuckets: result.completeBuckets,
        incompleteBuckets: result.incompleteBuckets,
        omittedIncompleteBucketCount: result.incompleteBuckets.length,
      },
      page: {
        limit,
        returned: bars.length,
        beforeTs,
        nextBeforeTs: bars[0]?.t ?? null,
        fromTs: bars[0]?.t ?? null,
        toTs: bars[bars.length - 1]?.ct ?? null,
        hasMore: eligible.length > bars.length,
      },
      verifiedAt: Date.now(),
      note: "All source bars were loaded from one hash-verified M1 revision. UTC-aligned incomplete buckets are omitted. Volume is summed only when the source manifest declares provider-reported volume; otherwise output volume is marked unavailable and encoded as zero for the legacy numeric Bar contract.",
    });
  } catch (error) {
    return datasetError(error);
  }
}
