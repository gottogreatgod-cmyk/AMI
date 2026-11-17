import { getMarketInstrumentMetadata } from "./market-instrument-contract";
import type {
  DukascopyPriceSide,
  DukascopyTimeframe,
  DukascopyVolumeUnits,
} from "./market-dataset";

export const DUKASCOPY_NODE_VERSION = "1.51.1";
export const DUKASCOPY_NODE_PACKAGE = "dukascopy-node@" + DUKASCOPY_NODE_VERSION;

export interface DukascopyDownloadCommandOptions {
  instrumentId: "NAS100-DUKA" | "XAUUSD-DUKA";
  timeframe: DukascopyTimeframe;
  priceSide: DukascopyPriceSide;
  from: string;
  to: string;
  volumeUnits: DukascopyVolumeUnits;
  outputDirectory: string;
  fileName: string;
  cacheDirectory: string;
  useCache: boolean;
  includeFlats: boolean;
  batchSize: number;
  batchPauseMs: number;
  requestIntervalMs: number;
  rateLimitRetries: number;
  retries: number;
}

export function getDukascopyProviderInstrument(
  instrumentId: DukascopyDownloadCommandOptions["instrumentId"]
): string {
  const metadata = getMarketInstrumentMetadata(instrumentId);
  if (!metadata || metadata.provider !== "Dukascopy" || !metadata.providerInstrument) {
    throw new Error("No Dukascopy instrument mapping exists for " + instrumentId);
  }
  if (metadata.dataClass !== "BROKER_CFD" && metadata.dataClass !== "OTC_SPOT_METAL") {
    throw new Error("Instrument class is not enabled for this Dukascopy importer.");
  }
  return metadata.providerInstrument;
}

/** Build explicit, reproducible CLI arguments. The downloader is invoked separately. */
export function buildDukascopyDownloadArgs(
  options: DukascopyDownloadCommandOptions
): string[] {
  const isDateOnly = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const timestamp = Date.parse(value + "T00:00:00.000Z");
    return !Number.isNaN(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
  };
  if (!isDateOnly(options.from) || !isDateOnly(options.to)) {
    throw new Error("Download range must use real YYYY-MM-DD UTC dates.");
  }
  const fromTs = Date.parse(options.from + "T00:00:00.000Z");
  const toTs = Date.parse(options.to + "T00:00:00.000Z");
  if (toTs <= fromTs) throw new Error("Invalid Dukascopy download date range.");
  if (!/^[a-zA-Z0-9_-]+$/.test(options.fileName)) {
    throw new Error("fileName may contain only letters, digits, hyphens and underscores.");
  }
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 10) {
    throw new Error("batchSize must be an integer from 1 to 10.");
  }
  if (!Number.isInteger(options.batchPauseMs) || options.batchPauseMs < 500) {
    throw new Error("batchPauseMs must be at least 500.");
  }
  if (!Number.isInteger(options.requestIntervalMs) || options.requestIntervalMs < 0) {
    throw new Error("requestIntervalMs must be a non-negative integer.");
  }
  if (!Number.isInteger(options.retries) || options.retries < 0 || options.retries > 10) {
    throw new Error("retries must be an integer from 0 to 10.");
  }
  if (
    !Number.isInteger(options.rateLimitRetries) ||
    options.rateLimitRetries < 0 ||
    options.rateLimitRetries > 10
  ) {
    throw new Error("rateLimitRetries must be an integer from 0 to 10.");
  }

  const providerInstrument = getDukascopyProviderInstrument(options.instrumentId);
  const args = [
    DUKASCOPY_NODE_PACKAGE,
    "-i", providerInstrument,
    "-from", options.from,
    "-to", options.to,
    "-t", options.timeframe,
    "-p", options.priceSide,
    "-utc", "0",
    "-f", "csv",
    "-v",
    "-vu", options.volumeUnits,
    "-dir", options.outputDirectory,
    "-fn", options.fileName,
    "-bs", String(options.batchSize),
    "-bp", String(options.batchPauseMs),
    "--request-interval", String(options.requestIntervalMs),
    "--rate-limit-retries", String(options.rateLimitRetries),
    "--retries", String(options.retries),
  ];

  if (options.includeFlats) args.push("-fl");
  if (options.useCache) args.push("--cache", "--cache-path", options.cacheDirectory);
  return args;
}
