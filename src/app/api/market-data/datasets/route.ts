import { NextResponse } from "next/server";
import { requireSession, serverError } from "@/lib/api";
import { listMarketDatasets } from "@/lib/data/market-dataset-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireSession();
  if (!guard.ok) return guard.res;

  try {
    const catalog = await listMarketDatasets();
    return NextResponse.json({
      datasets: catalog.datasets.map((dataset) => ({
        datasetId: dataset.datasetId,
        instrumentId: dataset.instrumentId,
        displayName: dataset.displayName,
        dataClass: dataset.dataClass,
        timeframe: dataset.timeframe,
        priceSide: dataset.priceSide,
        qualityStatus: dataset.qualityStatus,
        rows: dataset.rows,
        fromTs: dataset.fromTs,
        toTs: dataset.toTs,
        importedAt: dataset.importedAt,
      })),
      skipped: catalog.skipped.map((item) => ({
        directoryName: item.directory.split(/[\\/]/).slice(-1)[0] ?? "unknown",
        reason: item.reason,
      })),
      fetchedAt: Date.now(),
      note: "Catalog entries are local revisions. Load a dataset by its exact ID to verify its file hashes and candle integrity before research use.",
    });
  } catch (error) {
    return serverError(error);
  }
}
