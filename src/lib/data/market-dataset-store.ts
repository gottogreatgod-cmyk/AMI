import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  DATASET_IMPORTER_VERSION,
  DUKASCOPY_TIMEFRAME_MS,
  parseDukascopyCsv,
  serializeNormalizedBars,
  sha256Hex,
  type CsvImportOptions,
  type DukascopyTimeframe,
  type ImportedBar,
  type MarketDatasetManifest,
} from "./market-dataset";
import { getMarketInstrumentMetadata } from "./market-instrument-contract";

export const MARKET_DATA_ROOT = resolve(process.cwd(), "data/market-data");
export const MARKET_DATA_INSTRUMENT_IDS = ["XAUUSD-DUKA", "NAS100-DUKA"] as const;

const VALID_TIMEFRAMES: readonly DukascopyTimeframe[] = [
  "m1", "m5", "m15", "m30", "h1", "h4", "d1",
];

export type DatasetStoreErrorCode =
  | "INVALID_DATASET_ID"
  | "DATASET_NOT_FOUND"
  | "MANIFEST_INVALID"
  | "INSTRUMENT_MISMATCH"
  | "DATASET_REJECTED"
  | "REVIEW_REQUIRES_OPT_IN"
  | "RAW_HASH_MISMATCH"
  | "NORMALIZED_HASH_MISMATCH"
  | "ROW_COUNT_MISMATCH"
  | "BAR_INVALID"
  | "COVERAGE_MISMATCH"
  | "QUALITY_MISMATCH";

export class DatasetStoreError extends Error {
  readonly code: DatasetStoreErrorCode;

  constructor(code: DatasetStoreErrorCode, message: string) {
    super(message);
    this.name = "DatasetStoreError";
    this.code = code;
  }
}

export interface DatasetCatalogEntry {
  datasetId: string;
  instrumentId: string;
  displayName: string;
  dataClass: string;
  timeframe: DukascopyTimeframe;
  priceSide: "bid" | "ask";
  qualityStatus: "PASS" | "REVIEW" | "REJECTED";
  rows: number;
  fromTs: number | null;
  toTs: number | null;
  importedAt: string;
  directory: string;
}

export interface DatasetCatalogResult {
  datasets: DatasetCatalogEntry[];
  skipped: Array<{ directory: string; reason: string }>;
}

export interface LoadDatasetOptions {
  /** Root for tests or an alternate local dataset volume. */
  rootDir?: string;
  /** REVIEW data must be explicitly opted into for exploratory use. */
  allowReview?: boolean;
}

export interface LoadedMarketDataset {
  manifest: MarketDatasetManifest;
  bars: ImportedBar[];
  directory: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeDatasetId(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]{15,179}$/.test(value);
}

function parseManifest(raw: string, directory: string): MarketDatasetManifest {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new DatasetStoreError("MANIFEST_INVALID", "Manifest JSON is malformed: " + directory);
  }
  if (!isRecord(value) || value.schemaVersion !== 1) {
    throw new DatasetStoreError("MANIFEST_INVALID", "Unsupported manifest schema: " + directory);
  }

  const instrument = value.instrument;
  const interval = value.interval;
  const pricing = value.pricing;
  const range = value.requestedRange;
  const actual = value.actualCoverage;
  const provenance = value.provenance;
  const volume = value.volume;
  const quality = value.quality;

  if (
    !isRecord(instrument) ||
    typeof instrument.id !== "string" ||
    typeof instrument.displayName !== "string" ||
    typeof instrument.metadataVersion !== "number" ||
    !Number.isInteger(instrument.metadataVersion) ||
    typeof instrument.dataClass !== "string" ||
    instrument.provider !== "Dukascopy" ||
    typeof instrument.providerInstrument !== "string" ||
    !isRecord(interval) ||
    typeof interval.timeframe !== "string" ||
    !VALID_TIMEFRAMES.includes(interval.timeframe as DukascopyTimeframe) ||
    !isRecord(pricing) ||
    (pricing.datasetPriceSide !== "bid" && pricing.datasetPriceSide !== "ask") ||
    !isRecord(range) ||
    typeof range.from !== "string" ||
    typeof range.toExclusive !== "string" ||
    !isRecord(actual) ||
    typeof actual.rows !== "number" ||
    (actual.fromTs !== null && typeof actual.fromTs !== "number") ||
    (actual.toTs !== null && typeof actual.toTs !== "number") ||
    !isRecord(volume) ||
    typeof volume.present !== "boolean" ||
    (volume.units !== null && !["millions", "thousands", "units"].includes(String(volume.units))) ||
    (volume.semantics !== "PROVIDER_REPORTED" && volume.semantics !== "UNAVAILABLE") ||
    !isRecord(provenance) ||
    typeof provenance.rawSha256 !== "string" ||
    typeof provenance.normalizedSha256 !== "string" ||
    typeof provenance.formingCutoffTs !== "number" ||
    typeof provenance.importedAt !== "string" ||
    !isRecord(quality) ||
    !["PASS", "REVIEW", "REJECTED"].includes(String(quality.qualityStatus)) ||
    typeof value.datasetId !== "string"
  ) {
    throw new DatasetStoreError("MANIFEST_INVALID", "Manifest is missing required fields: " + directory);
  }

  return value as unknown as MarketDatasetManifest;
}

function parseNormalizedCsv(
  csv: string,
  manifest: MarketDatasetManifest
): ImportedBar[] {
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim() !== "");
  const header = "timestamp,open,high,low,close,volume,close_timestamp";
  if (lines[0] !== header) {
    throw new DatasetStoreError("BAR_INVALID", "Normalized CSV has an unexpected header.");
  }

  const timeframe = manifest.interval.timeframe;
  const intervalMs = DUKASCOPY_TIMEFRAME_MS[timeframe];
  const fromTs = Date.parse(manifest.requestedRange.from + "T00:00:00.000Z");
  const toTs = Date.parse(manifest.requestedRange.toExclusive + "T00:00:00.000Z");
  const cutoffTs = manifest.provenance.formingCutoffTs;
  if (!Number.isFinite(fromTs) || !Number.isFinite(toTs) || toTs <= fromTs || !Number.isFinite(cutoffTs)) {
    throw new DatasetStoreError("MANIFEST_INVALID", "Manifest date range or candle cutoff is invalid.");
  }

  const bars: ImportedBar[] = [];
  let previousTimestamp = -1;
  for (let index = 1; index < lines.length; index++) {
    const fields = lines[index].split(",");
    if (fields.length !== 7) {
      throw new DatasetStoreError("BAR_INVALID", "Normalized row " + (index + 1) + " has the wrong column count.");
    }
    const values = fields.map((field) => field.trim() === "" ? NaN : Number(field));
    const [t, o, h, l, c, v, ct] = values;
    if (!values.every(Number.isFinite) || !Number.isInteger(t) || !Number.isInteger(ct)) {
      throw new DatasetStoreError("BAR_INVALID", "Normalized row " + (index + 1) + " contains non-finite values.");
    }
    if (t <= previousTimestamp) {
      throw new DatasetStoreError("BAR_INVALID", "Normalized timestamps must be strictly increasing and unique.");
    }
    if (t < fromTs || t >= toTs || ct !== t + intervalMs - 1 || ct > cutoffTs) {
      throw new DatasetStoreError("BAR_INVALID", "Normalized row " + (index + 1) + " violates UTC range or candle-close rules.");
    }
    if (o <= 0 || h <= 0 || l <= 0 || c <= 0 || v < 0 || h < Math.max(o, c, l) || l > Math.min(o, c, h)) {
      throw new DatasetStoreError("BAR_INVALID", "Normalized row " + (index + 1) + " violates OHLC/volume integrity.");
    }

    bars.push({ t, o, h, l, c, v, ct });
    previousTimestamp = t;
  }
  return bars;
}

function assertManifestIdentity(
  manifest: MarketDatasetManifest,
  expectedDatasetId: string,
  expectedInstrumentId: string,
  expectedTimeframe: DukascopyTimeframe
): void {
  const metadata = getMarketInstrumentMetadata(expectedInstrumentId);
  if (
    !metadata ||
    manifest.datasetId !== expectedDatasetId ||
    manifest.instrument.id !== expectedInstrumentId ||
    manifest.instrument.metadataVersion !== metadata.metadataVersion ||
    manifest.instrument.dataClass !== metadata.dataClass ||
    manifest.instrument.provider !== metadata.provider ||
    manifest.instrument.providerInstrument !== metadata.providerInstrument ||
    manifest.interval.timeframe !== expectedTimeframe ||
    manifest.interval.durationMs !== DUKASCOPY_TIMEFRAME_MS[expectedTimeframe] ||
    manifest.interval.timestampMeaning !== "BAR_OPEN_TIME_UTC" ||
    manifest.interval.closeTimestampMeaning !== "BAR_CLOSE_TIME_UTC_INCLUSIVE" ||
    manifest.pricing.datasetPriceSide !== manifest.pricing.downloadedSide ||
    manifest.pricing.quoteCurrency !== metadata.quoteCurrency ||
    manifest.pricing.recommendedAnalysisMethod !== (metadata.analysisPriceSide === "MID" ? "PAIRED_MID" : metadata.analysisPriceSide) ||
    manifest.provenance.dataUseClassification !== metadata.dataUse.classification ||
    manifest.provenance.dataUseNote !== metadata.dataUse.note ||
    manifest.provenance.sourceTimezone !== "UTC" ||
    manifest.provenance.importer !== "ami-dukascopy-csv-importer" ||
    manifest.provenance.importerVersion !== DATASET_IMPORTER_VERSION ||
    manifest.quality.calendar !== metadata.session.calendar ||
    manifest.quality.calendarVerified !== metadata.session.hoursVerified ||
    manifest.quality.gapPolicy !== "REPORT_ONLY_NO_SYNTHETIC_BARS" ||
    manifest.quality.gapThresholdMs !== DUKASCOPY_TIMEFRAME_MS[expectedTimeframe] ||
    (manifest.pricing.downloadedSide !== "bid" && manifest.pricing.downloadedSide !== "ask")
  ) {
    throw new DatasetStoreError(
      "INSTRUMENT_MISMATCH",
      "Dataset manifest does not match the canonical instrument, provider, timeframe or quote-side identity."
    );
  }
}

function parseDatasetPath(datasetId: string): { instrumentId: typeof MARKET_DATA_INSTRUMENT_IDS[number]; timeframe: DukascopyTimeframe } | null {
  for (const instrumentId of MARKET_DATA_INSTRUMENT_IDS) {
    const prefix = instrumentId.toLowerCase() + "-";
    if (!datasetId.startsWith(prefix)) continue;
    for (const timeframe of VALID_TIMEFRAMES) {
      const token = "-" + timeframe + "-";
      if (datasetId.includes(token)) return { instrumentId, timeframe };
    }
  }
  return null;
}

/**
 * Catalog only local normalized revisions. The "downloads" directory contains
 * provider source exports and is deliberately never treated as a dataset.
 */
export async function listMarketDatasets(rootDir = MARKET_DATA_ROOT): Promise<DatasetCatalogResult> {
  const root = resolve(rootDir);
  const datasets: DatasetCatalogEntry[] = [];
  const skipped: DatasetCatalogResult["skipped"] = [];

  for (const instrumentId of MARKET_DATA_INSTRUMENT_IDS) {
    const instrumentDirectory = join(root, instrumentId.toLowerCase());
    let timeframeEntries;
    try {
      timeframeEntries = await readdir(instrumentDirectory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      skipped.push({ directory: instrumentDirectory, reason: error instanceof Error ? error.message : String(error) });
      continue;
    }

    for (const timeframeEntry of timeframeEntries) {
      if (!timeframeEntry.isDirectory() || !VALID_TIMEFRAMES.includes(timeframeEntry.name as DukascopyTimeframe)) continue;
      const timeframe = timeframeEntry.name as DukascopyTimeframe;
      const timeframeDirectory = join(instrumentDirectory, timeframe);
      const datasetEntries = await readdir(timeframeDirectory, { withFileTypes: true });

      for (const datasetEntry of datasetEntries) {
        if (!datasetEntry.isDirectory() || !isSafeDatasetId(datasetEntry.name)) continue;
        const directory = join(timeframeDirectory, datasetEntry.name);
        try {
          const manifestText = await readFile(join(directory, "manifest.json"), "utf8");
          const manifest = parseManifest(manifestText, directory);
          assertManifestIdentity(manifest, datasetEntry.name, instrumentId, timeframe);
          datasets.push({
            datasetId: manifest.datasetId,
            instrumentId,
            displayName: manifest.instrument.displayName,
            dataClass: manifest.instrument.dataClass,
            timeframe,
            priceSide: manifest.pricing.datasetPriceSide,
            qualityStatus: manifest.quality.qualityStatus,
            rows: manifest.actualCoverage.rows,
            fromTs: manifest.actualCoverage.fromTs,
            toTs: manifest.actualCoverage.toTs,
            importedAt: manifest.provenance.importedAt,
            directory,
          });
        } catch (error) {
          skipped.push({ directory, reason: error instanceof Error ? error.message : String(error) });
        }
      }
    }
  }

  datasets.sort((a, b) =>
    a.instrumentId.localeCompare(b.instrumentId) ||
    a.timeframe.localeCompare(b.timeframe) ||
    a.importedAt.localeCompare(b.importedAt) ||
    a.datasetId.localeCompare(b.datasetId)
  );
  return { datasets, skipped };
}

/**
 * Load only a specific dataset revision. There is deliberately no latest/first
 * dataset fallback: research must name the immutable dataset ID it consumes.
 */
export async function loadMarketDataset(
  datasetId: string,
  options: LoadDatasetOptions = {}
): Promise<LoadedMarketDataset> {
  if (!isSafeDatasetId(datasetId)) {
    throw new DatasetStoreError("INVALID_DATASET_ID", "Dataset ID contains invalid characters or length.");
  }
  const identity = parseDatasetPath(datasetId);
  if (!identity) throw new DatasetStoreError("DATASET_NOT_FOUND", "No supported instrument/timeframe is encoded in the dataset ID.");

  const root = resolve(options.rootDir ?? MARKET_DATA_ROOT);
  const directory = join(root, identity.instrumentId.toLowerCase(), identity.timeframe, datasetId);

  let manifestText: string;
  let sourceCsv: string;
  let normalizedCsv: string;
  try {
    [manifestText, sourceCsv, normalizedCsv] = await Promise.all([
      readFile(join(directory, "manifest.json"), "utf8"),
      readFile(join(directory, "source.csv"), "utf8"),
      readFile(join(directory, "normalized.csv"), "utf8"),
    ]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new DatasetStoreError("DATASET_NOT_FOUND", "Dataset revision not found: " + datasetId);
    }
    throw error;
  }

  const manifest = parseManifest(manifestText, directory);
  assertManifestIdentity(manifest, datasetId, identity.instrumentId, identity.timeframe);

  if (manifest.quality.qualityStatus === "REJECTED") {
    throw new DatasetStoreError("DATASET_REJECTED", "Rejected dataset revisions cannot be loaded for research.");
  }
  if (manifest.quality.qualityStatus === "REVIEW" && options.allowReview !== true) {
    throw new DatasetStoreError(
      "REVIEW_REQUIRES_OPT_IN",
      "Dataset quality is REVIEW. Set allowReview=true only for exploratory analysis."
    );
  }

  const rawHash = await sha256Hex(sourceCsv);
  if (rawHash !== manifest.provenance.rawSha256) {
    throw new DatasetStoreError("RAW_HASH_MISMATCH", "Original source CSV SHA-256 does not match the manifest.");
  }
  const normalizedHash = await sha256Hex(normalizedCsv);
  if (normalizedHash !== manifest.provenance.normalizedSha256) {
    throw new DatasetStoreError("NORMALIZED_HASH_MISMATCH", "Normalized CSV SHA-256 does not match the manifest.");
  }
  const expectedDatasetId = [
    identity.instrumentId.toLowerCase(),
    identity.timeframe,
    manifest.requestedRange.from,
    manifest.requestedRange.toExclusive,
    manifest.pricing.downloadedSide,
    "meta" + manifest.instrument.metadataVersion,
    "importer" + DATASET_IMPORTER_VERSION,
    manifest.volume.units ?? "no-volume",
    rawHash.slice(0, 8),
    normalizedHash.slice(0, 12),
  ].join("-");
  if (expectedDatasetId !== datasetId) {
    throw new DatasetStoreError("MANIFEST_INVALID", "Dataset ID does not match its source/normalized file hashes and import parameters.");
  }

  const bars = parseNormalizedCsv(normalizedCsv, manifest);
  if (bars.length === 0) {
    throw new DatasetStoreError("BAR_INVALID", "Empty datasets cannot be loaded for research.");
  }
  if (bars.length !== manifest.actualCoverage.rows || bars.length !== manifest.quality.acceptedRows) {
    throw new DatasetStoreError("ROW_COUNT_MISMATCH", "Normalized row count does not match manifest diagnostics.");
  }

  // Reparse the immutable source and re-create its normalized representation.
  // This makes the manifest quality label auditable instead of trusting a
  // mutable JSON field next to the files it describes.
  const sourceOptions: CsvImportOptions = {
    instrumentId: identity.instrumentId,
    timeframe: identity.timeframe,
    priceSide: manifest.pricing.downloadedSide,
    from: manifest.requestedRange.from,
    to: manifest.requestedRange.toExclusive,
    asOfTs: manifest.provenance.formingCutoffTs,
    volumeUnits: manifest.volume.units ?? "units",
  };
  const sourceParsed = (() => {
    try {
      return parseDukascopyCsv(sourceCsv, sourceOptions);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new DatasetStoreError(
        "QUALITY_MISMATCH",
        "Original source CSV cannot be replayed using this manifest: " + detail
      );
    }
  })();
  const recreatedNormalized = serializeNormalizedBars(sourceParsed.bars);
  if (recreatedNormalized !== normalizedCsv) {
    throw new DatasetStoreError(
      "QUALITY_MISMATCH",
      "Normalized bars do not reproduce from the source CSV and manifest import settings."
    );
  }

  const diagnosticFields = [
    "inputRows",
    "acceptedRows",
    "invalidRows",
    "duplicateRows",
    "formingRowsRemoved",
    "unclassifiedGaps",
    "qualityStatus",
  ] as const;
  for (const field of diagnosticFields) {
    if (sourceParsed.diagnostics[field] !== manifest.quality[field]) {
      throw new DatasetStoreError(
        "QUALITY_MISMATCH",
        "Manifest quality diagnostic does not match the original source: " + field
      );
    }
  }
  if (
    sourceParsed.volumeAvailable !== manifest.volume.present ||
    (sourceParsed.volumeAvailable && manifest.volume.semantics !== "PROVIDER_REPORTED") ||
    (!sourceParsed.volumeAvailable && manifest.volume.semantics !== "UNAVAILABLE") ||
    (sourceParsed.volumeAvailable &&
      !["millions", "thousands", "units"].includes(String(manifest.volume.units))) ||
    (!sourceParsed.volumeAvailable && manifest.volume.units !== null)
  ) {
    throw new DatasetStoreError("QUALITY_MISMATCH", "Manifest volume metadata does not match the source CSV.");
  }

  const first = bars[0];
  const last = bars[bars.length - 1];
  if (
    (first?.t ?? null) !== manifest.actualCoverage.fromTs ||
    (last?.ct ?? null) !== manifest.actualCoverage.toTs ||
    (bars.length === 0 && (manifest.actualCoverage.fromTs !== null || manifest.actualCoverage.toTs !== null))
  ) {
    throw new DatasetStoreError("COVERAGE_MISMATCH", "Actual coverage timestamps do not match the manifest.");
  }

  return { manifest, bars, directory };
}
