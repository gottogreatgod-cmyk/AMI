/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import {
  buildDukascopyDownloadArgs,
  DUKASCOPY_NODE_PACKAGE,
  getDukascopyProviderInstrument,
} from "./dukascopy-downloader";

const baseOptions = {
  instrumentId: "XAUUSD-DUKA" as const,
  timeframe: "m15" as const,
  priceSide: "bid" as const,
  from: "2024-01-01",
  to: "2024-02-01",
  volumeUnits: "units" as const,
  outputDirectory: "data/market-data/downloads",
  fileName: "xauusd-m15-bid-2024-01-01-2024-02-01",
  cacheDirectory: ".dukascopy-cache",
  useCache: true,
  includeFlats: false,
  batchSize: 5,
  batchPauseMs: 1500,
  requestIntervalMs: 250,
  rateLimitRetries: 5,
  retries: 3,
};

describe("Dukascopy download command contract", () => {
  test("pins the downloader and maps XAU/USD to the provider instrument", () => {
    expect(DUKASCOPY_NODE_PACKAGE).toBe("dukascopy-node@1.51.1");
    expect(getDukascopyProviderInstrument("XAUUSD-DUKA")).toBe("xauusd");
    expect(getDukascopyProviderInstrument("NAS100-DUKA")).toBe("usatechidxusd");
  });

  test("builds an explicit bid CSV request with UTC, volume, cache and rate controls", () => {
    const args = buildDukascopyDownloadArgs(baseOptions);
    expect(args).toContain("xauusd");
    expect(args).toContain("-utc");
    expect(args).toContain("0");
    expect(args).toContain("-f");
    expect(args).toContain("csv");
    expect(args).toContain("-v");
    expect(args).toContain("-vu");
    expect(args).toContain("units");
    expect(args).toContain("--cache");
    expect(args).not.toContain("--retry-on-empty");
    expect(args).not.toContain("-fl");
  });

  test("optionally includes flat candles and can disable the cache", () => {
    const args = buildDukascopyDownloadArgs({
      ...baseOptions,
      includeFlats: true,
      useCache: false,
    });
    expect(args).toContain("-fl");
    expect(args).not.toContain("--cache");
  });

  test("rejects malformed dates, unsafe filenames and aggressive limits", () => {
    expect(() => buildDukascopyDownloadArgs({ ...baseOptions, to: "2024-01-01" })).toThrow();
    expect(() => buildDukascopyDownloadArgs({ ...baseOptions, from: "2024-02-31" })).toThrow();
    expect(() => buildDukascopyDownloadArgs({ ...baseOptions, fileName: "../unsafe" })).toThrow();
    expect(() => buildDukascopyDownloadArgs({ ...baseOptions, batchSize: 99 })).toThrow();
    expect(() => buildDukascopyDownloadArgs({ ...baseOptions, batchPauseMs: 10 })).toThrow();
  });
});
