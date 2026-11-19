import { NextResponse, type NextRequest } from "next/server";
import { getBars } from "@/lib/data/providers";
import { DatasetStoreError, loadMarketDataset } from "@/lib/data/market-dataset-store";
import { assessMarketDatasetUse } from "@/lib/data/market-dataset-policy";
import type { DataQuality, Timeframe } from "@/lib/engine/types";
import { getInstrument } from "@/lib/data/instruments";
import { requireSession, badRequest, serverError } from "@/lib/api";
import { TIMEFRAMES } from "@/lib/engine/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = await requireSession();
  if (!guard.ok) return guard.res;
  try {
    const sp = req.nextUrl.searchParams;
    const symbol = sp.get("symbol") ?? "";
    const tf = (sp.get("tf") ?? "1h") as Timeframe;
    const rawLimit = Number(sp.get("limit") ?? 500);
    const limit = Number.isFinite(rawLimit) ? Math.max(1, Math.min(Math.floor(rawLimit), 2000)) : 500;
    const rawDays = Number(sp.get("days") ?? 30);
    const days = Number.isFinite(rawDays) ? Math.max(1, Math.min(Math.floor(rawDays), 400)) : 30;
    const datasetId = sp.get("datasetId");
    const rawFromTs = sp.get("fromTs");
    const rawToTs = sp.get("toTs");

    if (!TIMEFRAMES.includes(tf)) return badRequest(`unknown timeframe ${tf}`);

    if (datasetId) {
      const allowReview = sp.get("allowReview") === "true";
      const loaded = await loadMarketDataset(datasetId, { allowReview });
      if (loaded.manifest.instrument.id !== symbol) {
        return badRequest("datasetId does not belong to the requested symbol");
      }
      const datasetTimeframeMap: Record<string, Timeframe | undefined> = {
        m1: "1m",
        m15: "15m",
        h1: "1h",
        h4: "4h",
        d1: "1d",
      };
      const datasetTf = datasetTimeframeMap[loaded.manifest.interval.timeframe];
      if (!datasetTf || datasetTf !== tf) {
        return badRequest("datasetId timeframe does not match the requested chart timeframe");
      }

      let sourceBars = loaded.bars;
      if (rawFromTs !== null || rawToTs !== null) {
        const fromTs = rawFromTs === null ? Number.NaN : Number(rawFromTs);
        const toTs = rawToTs === null ? Number.NaN : Number(rawToTs);
        if (
          !Number.isFinite(fromTs) ||
          !Number.isFinite(toTs) ||
          fromTs <= 0 ||
          toTs < fromTs
        ) {
          return badRequest("fromTs and toTs must be supplied together as valid UTC epoch milliseconds with toTs >= fromTs");
        }
        sourceBars = sourceBars.filter((bar) => bar.t >= fromTs && bar.t <= toTs);
      }
      const sliced = sourceBars.length > limit ? sourceBars.slice(sourceBars.length - limit) : sourceBars;
      const first = sliced[0];
      const last = sliced[sliced.length - 1];
      const rangeFrom = Date.parse(loaded.manifest.requestedRange.from + "T00:00:00.000Z");
      const rangeTo = Date.parse(loaded.manifest.requestedRange.toExclusive + "T00:00:00.000Z");
      const coveredDays = first && last ? Math.max(0, (last.ct - first.t) / 86_400_000) : 0;
      const quality: DataQuality & { datasetId: string; priceSide: string; qualityStatus: string } = {
        provider: "dukascopy",
        providerSymbol: loaded.manifest.instrument.providerInstrument,
        bars: sliced.length,
        fromTs: first?.t ?? 0,
        toTs: last?.ct ?? 0,
        requestedDays: Math.max(0, (rangeTo - rangeFrom) / 86_400_000),
        coveredDays: Math.round(coveredDays),
        coverage: "PARTIAL",
        session: loaded.manifest.instrument.dataClass === "BROKER_CFD" ? "index" : "metals",
        resampledFrom: null,
        gapsDetected: loaded.manifest.quality.unclassifiedGaps,
        fetchedAt: Date.now(),
        note: "Verified local historical dataset; " + loaded.manifest.pricing.datasetPriceSide +
          " quotes only. Not a live feed. Gap count is for the full immutable revision and remains unclassified until session-calendar validation.",

        datasetId: loaded.manifest.datasetId,
        priceSide: loaded.manifest.pricing.datasetPriceSide,
        qualityStatus: loaded.manifest.quality.qualityStatus,
      };
      return NextResponse.json({
        symbol,
        tf,
        bars: sliced,
        quality,
        requestedRange: rawFromTs !== null || rawToTs !== null
          ? { fromTs: Number(rawFromTs), toTs: Number(rawToTs), timestampMeaning: "UTC_BAR_OPEN_TIME_INCLUSIVE" }
          : null,
        dataset: {
          datasetId: loaded.manifest.datasetId,
          dataClass: loaded.manifest.instrument.dataClass,
          recommendedAnalysisMethod: loaded.manifest.pricing.recommendedAnalysisMethod,
          rawSha256: loaded.manifest.provenance.rawSha256,
          normalizedSha256: loaded.manifest.provenance.normalizedSha256,
        },
        operationPolicy: assessMarketDatasetUse(loaded.manifest, { allowReview }),
      });
    }

    if (tf === "1m") {
      return NextResponse.json({
        error: "M1_REQUIRES_LOCAL_DATASET",
        message: "M1 charts are currently available only from an explicitly selected, hash-verified local dataset revision.",
      }, { status: 422 });
    }

    const inst = getInstrument(symbol);
    if (!inst) return badRequest(`unknown symbol ${symbol}`);

    const { bars, quality } = await getBars(symbol, tf, { days });
    const sliced = bars.length > limit ? bars.slice(bars.length - limit) : bars;
    return NextResponse.json({
      symbol,
      tf,
      bars: sliced,
      quality: { ...quality, bars: sliced.length },
    });
  } catch (e) {
    if (e instanceof DatasetStoreError) {
      const status = e.code === "DATASET_NOT_FOUND" ? 404 :
        e.code === "REVIEW_REQUIRES_OPT_IN" ? 409 :
        e.code === "INVALID_DATASET_ID" ? 400 : 422;
      return NextResponse.json({ error: e.code, message: e.message }, { status });
    }
    return serverError(e);
  }
}
