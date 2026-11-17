#!/usr/bin/env bun

import { mkdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  createMarketDatasetManifest,
  DUKASCOPY_TIMEFRAMES,
  parseDukascopyCsv,
  serializeNormalizedBars,
  type CsvImportOptions,
  type DukascopyPriceSide,
  type DukascopyTimeframe,
  type DukascopyVolumeUnits,
} from "../../src/lib/data/market-dataset";

function parseArgs(argv: string[]): Record<string, string> {
  const parsed: Record<string, string> = {};
  for (let index = 0; index < argv.length; index++) {
    const current = argv[index];
    if (!current.startsWith("--")) continue;
    const [key, inlineValue] = current.slice(2).split("=", 2);
    const value = inlineValue ?? argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error("Missing value for --" + key);
    parsed[key] = value;
    if (inlineValue === undefined) index++;
  }
  return parsed;
}

function required(args: Record<string, string>, key: string): string {
  const value = args[key];
  if (!value) throw new Error("Required option --" + key + " is missing.");
  return value;
}

function usage(): string {
  return [
    "AMI Dukascopy CSV importer",
    "",
    "Required:",
    "  --instrument XAUUSD-DUKA|NAS100-DUKA",
    "  --timeframe m1|m5|m15|m30|h1|h4|d1",
    "  --price-side bid|ask",
    "  --from YYYY-MM-DD",
    "  --to YYYY-MM-DD      exclusive UTC end date",
    "  --input path/to/provider-export.csv",
    "",
    "Optional:",
    "  --output-dir data/market-data",
    "  --volume-units millions|thousands|units (default: units)",
    "  --as-of ISO-8601      override forming-candle cutoff",
    "",
    "This tool normalizes existing Dukascopy CSV downloads. It does not fetch data.",
  ].join("\n");
}

async function main(): Promise<void> {
  const rawArgs = Bun.argv.slice(2);
  if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
    process.stdout.write(usage() + "\n");
    return;
  }

  const args = parseArgs(rawArgs);
  const instrumentId = required(args, "instrument");
  if (instrumentId !== "XAUUSD-DUKA" && instrumentId !== "NAS100-DUKA") {
    throw new Error("instrument must be XAUUSD-DUKA or NAS100-DUKA.");
  }

  const timeframe = required(args, "timeframe") as DukascopyTimeframe;
  if (!DUKASCOPY_TIMEFRAMES.includes(timeframe)) {
    throw new Error("Unsupported timeframe: " + timeframe);
  }
  const priceSide = required(args, "price-side") as DukascopyPriceSide;
  if (priceSide !== "bid" && priceSide !== "ask") {
    throw new Error("price-side must be bid or ask.");
  }
  const volumeUnits = (args["volume-units"] ?? "units") as DukascopyVolumeUnits;
  if (!["millions", "thousands", "units"].includes(volumeUnits)) {
    throw new Error("volume-units must be millions, thousands or units.");
  }

  const options: CsvImportOptions = {
    instrumentId,
    timeframe,
    priceSide,
    from: required(args, "from"),
    to: required(args, "to"),
    asOfTs: args["as-of"] ? Date.parse(args["as-of"]) : Date.now(),
    volumeUnits,
  };
  if (!Number.isFinite(options.asOfTs)) throw new Error("--as-of must be a valid ISO-8601 timestamp.");

  const inputPath = resolve(required(args, "input"));
  const inputFile = Bun.file(inputPath);
  if (!(await inputFile.exists())) throw new Error("Input CSV not found: " + inputPath);
  const rawCsv = await inputFile.text();
  const parsed = parseDukascopyCsv(rawCsv, options);
  const normalizedCsv = serializeNormalizedBars(parsed.bars);
  const manifest = await createMarketDatasetManifest({
    options,
    parsed,
    sourceFileName: basename(inputPath),
    rawCsv,
    normalizedCsv,
  });

  const outputRoot = resolve(args["output-dir"] ?? "data/market-data");
  const outputDirectory = resolve(outputRoot, instrumentId.toLowerCase(), timeframe, manifest.datasetId);
  await mkdir(outputDirectory, { recursive: true });

  await Bun.write(resolve(outputDirectory, "source.csv"), rawCsv);
  await Bun.write(resolve(outputDirectory, "normalized.csv"), normalizedCsv);
  await Bun.write(resolve(outputDirectory, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

  const summary = {
    datasetId: manifest.datasetId,
    outputDirectory,
    bars: manifest.actualCoverage.rows,
    qualityStatus: manifest.quality.qualityStatus,
    invalidRows: manifest.quality.invalidRows,
    duplicateRows: manifest.quality.duplicateRows,
    unclassifiedGaps: manifest.quality.unclassifiedGaps,
    rawSha256: manifest.provenance.rawSha256,
    normalizedSha256: manifest.provenance.normalizedSha256,
  };
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");

  if (manifest.quality.qualityStatus === "REJECTED") process.exitCode = 1;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write("AMI dataset import failed: " + message + "\n\n" + usage() + "\n");
  process.exitCode = 1;
});
