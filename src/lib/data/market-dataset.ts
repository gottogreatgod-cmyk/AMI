import {
  getMarketInstrumentMetadata,
  type CanonicalInstrumentMetadata,
} from "./market-instrument-contract";

export const DUKASCOPY_TIMEFRAMES = ["m1", "m5", "m15", "m30", "h1", "h4", "d1"] as const;
export type DukascopyTimeframe = (typeof DUKASCOPY_TIMEFRAMES)[number];
export type DukascopyPriceSide = "bid" | "ask";
export type DukascopyVolumeUnits = "millions" | "thousands" | "units";

export const DUKASCOPY_TIMEFRAME_MS: Record<DukascopyTimeframe, number> = {
  m1: 60_000,
  m5: 5 * 60_000,
  m15: 15 * 60_000,
  m30: 30 * 60_000,
  h1: 60 * 60_000,
  h4: 4 * 60 * 60_000,
  d1: 24 * 60 * 60_000,
};

export interface ImportedBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  ct: number;
}

export interface CsvImportOptions {
  instrumentId: "NAS100-DUKA" | "XAUUSD-DUKA";
  timeframe: DukascopyTimeframe;
  priceSide: DukascopyPriceSide;
  from: string;
  to: string;
  asOfTs: number;
  volumeUnits: DukascopyVolumeUnits;
}

export interface DatasetDiagnostics {
  inputRows: number;
  acceptedRows: number;
  invalidRows: number;
  duplicateRows: number;
  formingRowsRemoved: number;
  unclassifiedGaps: number;
  invalidExamples: Array<{ line: number; reason: string }>;
  qualityStatus: "PASS" | "REVIEW" | "REJECTED";
  notes: string[];
}

export interface ParsedCsvDataset {
  bars: ImportedBar[];
  diagnostics: DatasetDiagnostics;
  volumeAvailable: boolean;
}

export interface MarketDatasetManifest {
  schemaVersion: 1;
  datasetId: string;
  instrument: {
    id: string;
    displayName: string;
    dataClass: CanonicalInstrumentMetadata["dataClass"];
    provider: string;
    providerInstrument: string;
  };
  interval: {
    timeframe: DukascopyTimeframe;
    durationMs: number;
    timestampMeaning: "BAR_OPEN_TIME_UTC";
    closeTimestampMeaning: "BAR_CLOSE_TIME_UTC_INCLUSIVE";
  };
  pricing: {
    downloadedSide: DukascopyPriceSide;
    datasetPriceSide: DukascopyPriceSide;
    recommendedAnalysisMethod: "PAIRED_MID" | "LAST" | "TRADE";
    quoteCurrency: string;
  };
  volume: {
    present: boolean;
    units: DukascopyVolumeUnits | null;
    semantics: "PROVIDER_REPORTED" | "UNAVAILABLE";
    note: string;
  };
  requestedRange: {
    from: string;
    toExclusive: string;
  };
  actualCoverage: {
    fromTs: number | null;
    toTs: number | null;
    rows: number;
  };
  provenance: {
    provider: string;
    providerInstrument: string;
    sourceFileName: string;
    rawSha256: string;
    normalizedSha256: string;
    importer: "ami-dukascopy-csv-importer";
    importerVersion: 1;
    importedAt: string;
    formingCutoffTs: number;
    dataUseClassification: string;
    dataUseNote: string;
    sourceTimezone: "UTC";
  };
  quality: DatasetDiagnostics & {
    gapPolicy: "REPORT_ONLY_NO_SYNTHETIC_BARS";
    gapThresholdMs: number;
    calendar: string;
    calendarVerified: boolean;
  };
}

const EXPECTED_HEADERS = ["timestamp", "open", "high", "low", "close"] as const;

function isDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value + "T00:00:00.000Z"));
}

function parseNumeric(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Parse Dukascopy's documented CSV candle format. Duplicate timestamps are
 * resolved deterministically (last source row wins); missing candles are
 * reported only and are never synthesized.
 */
export function parseDukascopyCsv(csv: string, options: CsvImportOptions): ParsedCsvDataset {
  if (!isDateOnly(options.from) || !isDateOnly(options.to)) {
    throw new Error("from and to must be valid YYYY-MM-DD UTC dates.");
  }
  const fromTs = Date.parse(options.from + "T00:00:00.000Z");
  const toTs = Date.parse(options.to + "T00:00:00.000Z");
  if (toTs <= fromTs) throw new Error("to must be later than from (exclusive).");
  if (!Number.isFinite(options.asOfTs)) throw new Error("asOfTs must be a finite timestamp.");

  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/);
  const nonEmpty = lines
    .map((line, index) => ({ line: line.trim(), lineNumber: index + 1 }))
    .filter((item) => item.line.length > 0);
  if (nonEmpty.length === 0) throw new Error("CSV is empty.");

  const firstFields = nonEmpty[0].line.split(",").map((field) => field.trim().toLowerCase());
  const hasHeader = firstFields[0] === "timestamp";
  let volumeAvailable = false;
  let startIndex = 0;

  if (hasHeader) {
    const header = firstFields.join(",");
    const fiveColumns = EXPECTED_HEADERS.join(",");
    const sixColumns = [...EXPECTED_HEADERS, "volume"].join(",");
    if (header !== fiveColumns && header !== sixColumns) {
      throw new Error("Unexpected CSV header. Expected timestamp,open,high,low,close[,volume].");
    }
    volumeAvailable = header === sixColumns;
    startIndex = 1;
  } else {
    if (firstFields.length !== 5 && firstFields.length !== 6) {
      throw new Error("CSV without a header must contain five or six numeric columns.");
    }
    volumeAvailable = firstFields.length === 6;
  }

  const input = nonEmpty.slice(startIndex);
  const intervalMs = DUKASCOPY_TIMEFRAME_MS[options.timeframe];
  const byTimestamp = new Map<number, ImportedBar>();
  const diagnostics: DatasetDiagnostics = {
    inputRows: input.length,
    acceptedRows: 0,
    invalidRows: 0,
    duplicateRows: 0,
    formingRowsRemoved: 0,
    unclassifiedGaps: 0,
    invalidExamples: [],
    qualityStatus: "PASS",
    notes: [
      "Gap counts are unclassified until an instrument-specific session calendar is applied.",
      "No synthetic bars are created for missing intervals.",
      "Provider-reported volume is retained as supplied; it is not assumed to be consolidated exchange volume.",
    ],
  };

  const addInvalid = (lineNumber: number, reason: string) => {
    diagnostics.invalidRows++;
    if (diagnostics.invalidExamples.length < 20) {
      diagnostics.invalidExamples.push({ line: lineNumber, reason });
    }
  };

  for (const row of input) {
    const fields = row.line.split(",").map((field) => field.trim());
    if (fields.length !== (volumeAvailable ? 6 : 5)) {
      addInvalid(row.lineNumber, "wrong_column_count");
      continue;
    }

    const [timestampField, openField, highField, lowField, closeField, volumeField] = fields;
    const timestamp = parseNumeric(timestampField);
    const open = parseNumeric(openField);
    const high = parseNumeric(highField);
    const low = parseNumeric(lowField);
    const close = parseNumeric(closeField);
    const volume = volumeAvailable ? parseNumeric(volumeField ?? "") : 0;

    if (
      timestamp === null ||
      !Number.isInteger(timestamp) ||
      timestamp < 0 ||
      open === null ||
      high === null ||
      low === null ||
      close === null ||
      volume === null
    ) {
      addInvalid(row.lineNumber, "non_finite_or_missing_numeric_value");
      continue;
    }
    if (timestamp < fromTs || timestamp >= toTs) {
      addInvalid(row.lineNumber, "timestamp_outside_requested_utc_range");
      continue;
    }
    if (open <= 0 || high <= 0 || low <= 0 || close <= 0) {
      addInvalid(row.lineNumber, "non_positive_ohlc_price");
      continue;
    }
    if (high < Math.max(open, close, low) || low > Math.min(open, close, high)) {
      addInvalid(row.lineNumber, "ohlc_integrity_violation");
      continue;
    }
    if (volume < 0) {
      addInvalid(row.lineNumber, "negative_volume");
      continue;
    }

    const closeTimestamp = timestamp + intervalMs - 1;
    if (closeTimestamp > options.asOfTs) {
      diagnostics.formingRowsRemoved++;
      continue;
    }

    if (byTimestamp.has(timestamp)) diagnostics.duplicateRows++;
    byTimestamp.set(timestamp, {
      t: timestamp,
      o: open,
      h: high,
      l: low,
      c: close,
      v: volume,
      ct: closeTimestamp,
    });
  }

  const bars = [...byTimestamp.values()].sort((a, b) => a.t - b.t);
  diagnostics.acceptedRows = bars.length;
  for (let index = 1; index < bars.length; index++) {
    if (bars[index].t - bars[index - 1].t > intervalMs * 2) {
      diagnostics.unclassifiedGaps++;
    }
  }

  if (bars.length === 0 || diagnostics.invalidRows > 0) {
    diagnostics.qualityStatus = "REJECTED";
  } else if (diagnostics.duplicateRows > 0 || diagnostics.unclassifiedGaps > 0) {
    diagnostics.qualityStatus = "REVIEW";
  }
  if (diagnostics.formingRowsRemoved > 0) {
    diagnostics.notes.push("Forming candles after asOfTs were removed.");
  }
  if (diagnostics.duplicateRows > 0) {
    diagnostics.notes.push("Duplicate timestamps were counted; the final source row for each timestamp was retained.");
  }

  return { bars, diagnostics, volumeAvailable };
}

export function serializeNormalizedBars(bars: ImportedBar[]): string {
  const lines = ["timestamp,open,high,low,close,volume,close_timestamp"];
  for (const bar of bars) {
    lines.push([bar.t, bar.o, bar.h, bar.l, bar.c, bar.v, bar.ct].join(","));
  }
  return lines.join("\n") + "\n";
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function createMarketDatasetManifest(args: {
  options: CsvImportOptions;
  parsed: ParsedCsvDataset;
  sourceFileName: string;
  rawCsv: string;
  normalizedCsv: string;
  importedAt?: string;
}): Promise<MarketDatasetManifest> {
  const metadata = getMarketInstrumentMetadata(args.options.instrumentId);
  if (!metadata || metadata.provider !== "Dukascopy" || !metadata.providerInstrument) {
    throw new Error("Dataset manifest requires a registered Dukascopy instrument.");
  }

  const rawSha256 = await sha256Hex(args.rawCsv);
  const normalizedSha256 = await sha256Hex(args.normalizedCsv);
  const bars = args.parsed.bars;
  const datasetId = [
    args.options.instrumentId.toLowerCase(),
    args.options.timeframe,
    args.options.from,
    args.options.to,
    args.options.priceSide,
    rawSha256.slice(0, 8),
    normalizedSha256.slice(0, 12),
  ].join("-");

  return {
    schemaVersion: 1,
    datasetId,
    instrument: {
      id: metadata.id,
      displayName: metadata.displayName,
      dataClass: metadata.dataClass,
      provider: metadata.provider,
      providerInstrument: metadata.providerInstrument,
    },
    interval: {
      timeframe: args.options.timeframe,
      durationMs: DUKASCOPY_TIMEFRAME_MS[args.options.timeframe],
      timestampMeaning: "BAR_OPEN_TIME_UTC",
      closeTimestampMeaning: "BAR_CLOSE_TIME_UTC_INCLUSIVE",
    },
    pricing: {
      downloadedSide: args.options.priceSide,
      datasetPriceSide: args.options.priceSide,
      recommendedAnalysisMethod: metadata.analysisPriceSide === "MID" ? "PAIRED_MID" : metadata.analysisPriceSide,
      quoteCurrency: metadata.quoteCurrency,
    },
    volume: {
      present: args.parsed.volumeAvailable,
      units: args.parsed.volumeAvailable ? args.options.volumeUnits : null,
      semantics: args.parsed.volumeAvailable ? "PROVIDER_REPORTED" : "UNAVAILABLE",
      note: args.parsed.volumeAvailable
        ? "Volume is retained in the requested Dukascopy volumeUnits. Do not reinterpret it as consolidated exchange volume."
        : "The source export omitted volume; normalized volume is zero and must be treated as unavailable.",
    },
    requestedRange: {
      from: args.options.from,
      toExclusive: args.options.to,
    },
    actualCoverage: {
      fromTs: bars[0]?.t ?? null,
      toTs: bars[bars.length - 1]?.ct ?? null,
      rows: bars.length,
    },
    provenance: {
      provider: metadata.provider,
      providerInstrument: metadata.providerInstrument,
      sourceFileName: args.sourceFileName,
      rawSha256,
      normalizedSha256,
      importer: "ami-dukascopy-csv-importer",
      importerVersion: 1,
      importedAt: args.importedAt ?? new Date().toISOString(),
      formingCutoffTs: args.options.asOfTs,
      dataUseClassification: metadata.dataUse.classification,
      dataUseNote: metadata.dataUse.note,
      sourceTimezone: "UTC",
    },
    quality: {
      ...args.parsed.diagnostics,
      gapPolicy: "REPORT_ONLY_NO_SYNTHETIC_BARS",
      gapThresholdMs: DUKASCOPY_TIMEFRAME_MS[args.options.timeframe] * 2,
      calendar: metadata.session.calendar,
      calendarVerified: metadata.session.hoursVerified,
    },
  };
}
