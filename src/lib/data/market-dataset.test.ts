/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import {
  createMarketDatasetManifest,
  parseDukascopyCsv,
  serializeNormalizedBars,
  sha256Hex,
  type CsvImportOptions,
} from "./market-dataset";

const HOUR = 60 * 60_000;
const defaultOptions: CsvImportOptions = {
  instrumentId: "XAUUSD-DUKA",
  timeframe: "h1",
  priceSide: "bid",
  from: "2024-01-01",
  to: "2024-01-03",
  asOfTs: Date.parse("2024-01-04T00:00:00.000Z"),
  volumeUnits: "units",
};

const validCsv = [
  "timestamp,open,high,low,close,volume",
  String(Date.parse("2024-01-01T00:00:00.000Z")) + ",2050,2052,2049,2051,100",
  String(Date.parse("2024-01-01T01:00:00.000Z")) + ",2051,2053,2050,2052,125",
  String(Date.parse("2024-01-01T02:00:00.000Z")) + ",2052,2054,2051,2053,130",
].join("\n");

describe("Dukascopy CSV normalization", () => {
  test("parses UTC millisecond candles and derives close timestamps", () => {
    const result = parseDukascopyCsv(validCsv, defaultOptions);
    expect(result.bars).toHaveLength(3);
    expect(result.bars[0].t).toBe(Date.parse("2024-01-01T00:00:00.000Z"));
    expect(result.bars[0].ct).toBe(Date.parse("2024-01-01T01:00:00.000Z") - 1);
    expect(result.bars[2].v).toBe(130);
    expect(result.volumeAvailable).toBe(true);
    expect(result.diagnostics.qualityStatus).toBe("PASS");
  });

  test("sorts timestamps and deterministically keeps the final duplicate row", () => {
    const timestamp0 = Date.parse("2024-01-01T00:00:00.000Z");
    const timestamp1 = timestamp0 + HOUR;
    const csv = [
      "timestamp,open,high,low,close,volume",
      timestamp1 + ",2051,2053,2050,2052,10",
      timestamp0 + ",2050,2052,2049,2051,11",
      timestamp1 + ",2051,2055,2050,2054,99",
    ].join("\n");
    const result = parseDukascopyCsv(csv, defaultOptions);

    expect(result.bars.map((bar) => bar.t)).toEqual([timestamp0, timestamp1]);
    expect(result.bars[1].c).toBe(2054);
    expect(result.bars[1].v).toBe(99);
    expect(result.diagnostics.duplicateRows).toBe(1);
    expect(result.diagnostics.qualityStatus).toBe("REVIEW");
  });

  test("rejects invalid OHLC and negative volume", () => {
    const timestamp = Date.parse("2024-01-01T00:00:00.000Z");
    const csv = [
      "timestamp,open,high,low,close,volume",
      timestamp + ",2050,2040,2049,2051,10",
      (timestamp + HOUR) + ",2050,2052,2049,2051,-1",
    ].join("\n");
    const result = parseDukascopyCsv(csv, defaultOptions);

    expect(result.bars).toHaveLength(0);
    expect(result.diagnostics.invalidRows).toBe(2);
    expect(result.diagnostics.qualityStatus).toBe("REJECTED");
    expect(result.diagnostics.invalidExamples.map((item) => item.reason)).toEqual([
      "ohlc_integrity_violation",
      "negative_volume",
    ]);
  });

  test("removes forming candles and records them", () => {
    const first = Date.parse("2024-01-01T00:00:00.000Z");
    const second = first + HOUR;
    const csv = [
      "timestamp,open,high,low,close,volume",
      first + ",2050,2052,2049,2051,10",
      second + ",2051,2053,2050,2052,12",
    ].join("\n");
    const result = parseDukascopyCsv(csv, {
      ...defaultOptions,
      asOfTs: second + 30 * 60_000,
    });

    expect(result.bars).toHaveLength(1);
    expect(result.diagnostics.formingRowsRemoved).toBe(1);
  });

  test("reports gaps without synthesizing missing bars", () => {
    const first = Date.parse("2024-01-01T00:00:00.000Z");
    const csv = [
      "timestamp,open,high,low,close,volume",
      first + ",2050,2052,2049,2051,10",
      (first + 4 * HOUR) + ",2051,2053,2050,2052,12",
    ].join("\n");
    const result = parseDukascopyCsv(csv, defaultOptions);

    expect(result.bars).toHaveLength(2);
    expect(result.diagnostics.unclassifiedGaps).toBe(1);
    expect(result.diagnostics.qualityStatus).toBe("REVIEW");
  });


  test("reports a single missing candle interval instead of hiding short gaps", () => {
    const first = Date.parse("2024-01-01T00:00:00.000Z");
    const csv = [
      "timestamp,open,high,low,close,volume",
      first + ",2050,2052,2049,2051,10",
      (first + 2 * HOUR) + ",2051,2053,2050,2052,12",
    ].join("\n");
    const result = parseDukascopyCsv(csv, defaultOptions);

    expect(result.bars).toHaveLength(2);
    expect(result.diagnostics.unclassifiedGaps).toBe(1);
    expect(result.diagnostics.qualityStatus).toBe("REVIEW");
  });

  test("marks volume unavailable when the source omits it", () => {
    const timestamp = Date.parse("2024-01-01T00:00:00.000Z");
    const csv = [
      "timestamp,open,high,low,close",
      timestamp + ",2050,2052,2049,2051",
    ].join("\n");
    const parsed = parseDukascopyCsv(csv, defaultOptions);

    expect(parsed.volumeAvailable).toBe(false);
    expect(parsed.bars[0].v).toBe(0);
    expect(serializeNormalizedBars(parsed.bars)).toContain(
      "timestamp,open,high,low,close,volume,close_timestamp"
    );
  });

  test("rejects malformed date ranges and malformed candle headers", () => {
    expect(() => parseDukascopyCsv(validCsv, { ...defaultOptions, from: "01/01/2024" })).toThrow();
    expect(() => parseDukascopyCsv(validCsv, { ...defaultOptions, to: "2023-12-31" })).toThrow();
    expect(() => parseDukascopyCsv(validCsv, { ...defaultOptions, from: "2024-02-31" })).toThrow();
    expect(() => parseDukascopyCsv("timestamp,bid,ask", defaultOptions)).toThrow();
  });
});

describe("market dataset provenance", () => {
  test("SHA-256 and dataset IDs are stable for identical source data", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    const parsed = parseDukascopyCsv(validCsv, defaultOptions);
    const normalizedCsv = serializeNormalizedBars(parsed.bars);
    const args = {
      options: defaultOptions,
      parsed,
      sourceFileName: "xauusd-h1-bid.csv",
      rawCsv: validCsv,
      normalizedCsv,
      importedAt: "2024-01-03T00:00:00.000Z",
    };
    const first = await createMarketDatasetManifest(args);
    const second = await createMarketDatasetManifest(args);

    expect(first.datasetId).toBe(second.datasetId);
    expect(first.datasetId.split("-")).toContain("meta3");
    expect(first.provenance.rawSha256).toBe(second.provenance.rawSha256);
    expect(first.provenance.normalizedSha256).toBe(second.provenance.normalizedSha256);
    expect(first.instrument.dataClass).toBe("OTC_SPOT_METAL");
    expect(first.pricing.downloadedSide).toBe("bid");
    expect(first.pricing.datasetPriceSide).toBe("bid");
    expect(first.pricing.recommendedAnalysisMethod).toBe("PAIRED_MID");
    expect(first.volume.semantics).toBe("PROVIDER_REPORTED");
    expect(first.quality.gapPolicy).toBe("REPORT_ONLY_NO_SYNTHETIC_BARS");
  });

 
  test("different raw source bytes create a different immutable dataset revision", async () => {
    const parsed = parseDukascopyCsv(validCsv, defaultOptions);
    const normalizedCsv = serializeNormalizedBars(parsed.bars);
    const first = await createMarketDatasetManifest({
      options: defaultOptions,
      parsed,
      sourceFileName: "original.csv",
      rawCsv: validCsv,
      normalizedCsv,
      importedAt: "2024-01-03T00:00:00.000Z",
    });
    const rawWithCrlf = validCsv.replace(/\n/g, "\r\n");
    const second = await createMarketDatasetManifest({
      options: defaultOptions,
      parsed,
      sourceFileName: "line-endings-changed.csv",
      rawCsv: rawWithCrlf,
      normalizedCsv,
      importedAt: "2024-01-03T00:00:00.000Z",
    });

    expect(first.provenance.normalizedSha256).toBe(second.provenance.normalizedSha256);
    expect(first.provenance.rawSha256).not.toBe(second.provenance.rawSha256);
    expect(first.datasetId).not.toBe(second.datasetId);
  });

  test("volume-unit metadata creates a distinct immutable dataset identity", async () => {
    const parsed = parseDukascopyCsv(validCsv, defaultOptions);
    const normalizedCsv = serializeNormalizedBars(parsed.bars);
    const make = (volumeUnits: "units" | "millions") =>
      createMarketDatasetManifest({
        options: { ...defaultOptions, volumeUnits },
        parsed,
        sourceFileName: "xauusd-h1-bid.csv",
        rawCsv: validCsv,
        normalizedCsv,
        importedAt: "2024-01-03T00:00:00.000Z",
      });

    const units = await make("units");
    const millions = await make("millions");
    expect(units.provenance.rawSha256).toBe(millions.provenance.rawSha256);
    expect(units.provenance.normalizedSha256).toBe(millions.provenance.normalizedSha256);
    expect(units.datasetId).not.toBe(millions.datasetId);
  });

  test("preserves the Nasdaq-style CFD identity in its manifest", async () => {
    const nasdaqOptions = { ...defaultOptions, instrumentId: "NAS100-DUKA" as const };
    const parsed = parseDukascopyCsv(validCsv, nasdaqOptions);
    const manifest = await createMarketDatasetManifest({
      options: nasdaqOptions,
      parsed,
      sourceFileName: "usatechidxusd-h1-bid.csv",
      rawCsv: validCsv,
      normalizedCsv: serializeNormalizedBars(parsed.bars),
    });
    expect(manifest.instrument.dataClass).toBe("BROKER_CFD");
    expect(manifest.instrument.providerInstrument).toBe("usatechidxusd");
  });
});
