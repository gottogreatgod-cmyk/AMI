import { NextResponse, type NextRequest } from "next/server";
import { requireSession, badRequest } from "@/lib/api";
import { DatasetStoreError, loadMarketDataset } from "@/lib/data/market-dataset-store";
import { assessMarketDatasetUse } from "@/lib/data/market-dataset-policy";

export const dynamic = "force-dynamic";

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
  return NextResponse.json({ error: "DATASET_LOAD_FAILED", message }, { status: 500 });
}

/**
 * Return a page from one explicitly named, fully hash-verified local dataset.
 * The entire source + normalized file is verified before any bars are returned.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ datasetId: string }> }
) {
  const guard = await requireSession();
  if (!guard.ok) return guard.res;

  const { datasetId } = await ctx.params;
  const search = req.nextUrl.searchParams;
  const rawLimit = Number(search.get("limit") ?? 1000);
  const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(Math.floor(rawLimit), 2000)) : 1000;
  const rawBefore = search.get("beforeTs");
  const beforeTs = rawBefore === null ? null : Number(rawBefore);
  if (beforeTs !== null && (!Number.isFinite(beforeTs) || beforeTs <= 0)) {
    return badRequest("beforeTs must be a positive UTC epoch-millisecond timestamp.");
  }

  try {
    const loaded = await loadMarketDataset(datasetId);
    const eligibleBars = beforeTs === null
      ? loaded.bars
      : loaded.bars.filter((bar) => bar.t < beforeTs);
    const bars = eligibleBars.slice(Math.max(0, eligibleBars.length - limit));
    const first = bars[0];
    const last = bars[bars.length - 1];

    return NextResponse.json({
      dataset: {
        datasetId: loaded.manifest.datasetId,
        instrument: loaded.manifest.instrument,
        timeframe: loaded.manifest.interval.timeframe,
        intervalMs: loaded.manifest.interval.durationMs,
        priceSide: loaded.manifest.pricing.datasetPriceSide,
        recommendedAnalysisMethod: loaded.manifest.pricing.recommendedAnalysisMethod,
        volume: loaded.manifest.volume,
        quality: loaded.manifest.quality,
        requestedRange: loaded.manifest.requestedRange,
        actualCoverage: loaded.manifest.actualCoverage,
        operationPolicy: assessMarketDatasetUse(loaded.manifest),
        provenance: {
          provider: loaded.manifest.provenance.provider,
          providerInstrument: loaded.manifest.provenance.providerInstrument,
          rawSha256: loaded.manifest.provenance.rawSha256,
          normalizedSha256: loaded.manifest.provenance.normalizedSha256,
          importer: loaded.manifest.provenance.importer,
          importerVersion: loaded.manifest.provenance.importerVersion,
          importedAt: loaded.manifest.provenance.importedAt,
          formingCutoffTs: loaded.manifest.provenance.formingCutoffTs,
        },
      },
      bars,
      page: {
        limit,
        returned: bars.length,
        beforeTs,
        nextBeforeTs: first ? first.t : null,
        fromTs: first?.t ?? null,
        toTs: last?.ct ?? null,
        hasMore: eligibleBars.length > bars.length,
      },
      verifiedAt: Date.now(),
    });
  } catch (error) {
    return datasetError(error);
  }
}
