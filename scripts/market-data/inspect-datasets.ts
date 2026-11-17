#!/usr/bin/env bun

import {
  listMarketDatasets,
  loadMarketDataset,
  type DatasetCatalogEntry,
} from "../../src/lib/data/market-dataset-store";

function usage(): string {
  return [
    "AMI local market-data catalogue",
    "",
    "Commands:",
    "  list",
    "  verify <dataset-id> [--allow-review]",
    "",
    "Examples:",
    "  bun run market-data:inspect -- list",
    "  bun run market-data:inspect -- verify xauusd-duka-h1-...-bid-...",
    "  bun run market-data:inspect -- verify <dataset-id> --allow-review",
    "",
    "The loader always checks the original and normalized CSV hashes, manifest",
    "identity, candle timestamps and OHLC integrity before returning bars.",
  ].join("\n");
}

function compact(entry: DatasetCatalogEntry) {
  return {
    datasetId: entry.datasetId,
    instrumentId: entry.instrumentId,
    displayName: entry.displayName,
    dataClass: entry.dataClass,
    timeframe: entry.timeframe,
    priceSide: entry.priceSide,
    qualityStatus: entry.qualityStatus,
    rows: entry.rows,
    fromTs: entry.fromTs,
    toTs: entry.toTs,
    importedAt: entry.importedAt,
  };
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);
  if (args.length === 0 || args.includes("--help") || args.includes("-h")) {
    process.stdout.write(usage() + "\n");
    return;
  }

  const command = args[0];
  if (command === "list") {
    const result = await listMarketDatasets();
    process.stdout.write(JSON.stringify({
      datasets: result.datasets.map(compact),
      skipped: result.skipped,
      count: result.datasets.length,
    }, null, 2) + "\n");
    return;
  }

  if (command === "verify") {
    const datasetId = args[1];
    if (!datasetId || datasetId.startsWith("--")) {
      throw new Error("verify requires one explicit dataset ID.");
    }
    const allowReview = args.includes("--allow-review");
    const loaded = await loadMarketDataset(datasetId, { allowReview });
    process.stdout.write(JSON.stringify({
      verified: true,
      dataset: compact({
        datasetId: loaded.manifest.datasetId,
        instrumentId: loaded.manifest.instrument.id,
        displayName: loaded.manifest.instrument.displayName,
        dataClass: loaded.manifest.instrument.dataClass,
        timeframe: loaded.manifest.interval.timeframe,
        priceSide: loaded.manifest.pricing.datasetPriceSide,
        qualityStatus: loaded.manifest.quality.qualityStatus,
        rows: loaded.bars.length,
        fromTs: loaded.bars[0]?.t ?? null,
        toTs: loaded.bars[loaded.bars.length - 1]?.ct ?? null,
        importedAt: loaded.manifest.provenance.importedAt,
        directory: loaded.directory,
      }),
      rawSha256: loaded.manifest.provenance.rawSha256,
      normalizedSha256: loaded.manifest.provenance.normalizedSha256,
      candleCutoffTs: loaded.manifest.provenance.formingCutoffTs,
    }, null, 2) + "\n");
    return;
  }

  throw new Error("Unknown command: " + command);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write("AMI dataset inspection failed: " + message + "\n\n" + usage() + "\n");
  process.exitCode = 1;
});
