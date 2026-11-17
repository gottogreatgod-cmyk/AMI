/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import {
  createMarketDatasetManifest,
  parseDukascopyCsv,
  serializeNormalizedBars,
  type CsvImportOptions,
} from "./market-dataset";
import { assessMarketDatasetUse } from "./market-dataset-policy";

const timestamp = Date.parse("2024-01-01T00:00:00.000Z");
const options: CsvImportOptions = {
  instrumentId: "XAUUSD-DUKA",
  timeframe: "h1",
  priceSide: "bid",
  from: "2024-01-01",
  to: "2024-01-02",
  asOfTs: Date.parse("2024-01-03T00:00:00.000Z"),
  volumeUnits: "units",
};
const csv = [
  "timestamp,open,high,low,close,volume",
  timestamp + ",2050,2052,2049,2051,100",
].join("\n");

async function manifestFor(
  qualityStatus: "PASS" | "REVIEW" | "REJECTED",
  instrumentId: CsvImportOptions["instrumentId"] = "XAUUSD-DUKA"
) {
  const selectedOptions = { ...options, instrumentId };
  const parsed = parseDukascopyCsv(csv, selectedOptions);
  parsed.diagnostics.qualityStatus = qualityStatus;
  const normalizedCsv = serializeNormalizedBars(parsed.bars);
  return createMarketDatasetManifest({
    options: selectedOptions,
    parsed,
    sourceFileName: "sample.csv",
    rawCsv: csv,
    normalizedCsv,
    importedAt: "2024-01-03T00:00:00.000Z",
  });
}

describe("market dataset operation policy", () => {
  test("PASS single-side XAUUSD is chart and signal research eligible, not backtest eligible", async () => {
    const manifest = await manifestFor("PASS");
    const policy = assessMarketDatasetUse(manifest);

    expect(policy.chart.allowed).toBe(true);
    expect(policy.signalResearch.allowed).toBe(true);
    expect(policy.strategyBacktest.allowed).toBe(false);
    expect(policy.strategyBacktest.reasons.some((reason) => reason.includes("bid/ask-paired"))).toBe(true);
    expect(policy.strategyBacktest.reasons.some((reason) => reason.includes("costs are not verified"))).toBe(true);
    expect(policy.paperExecution.allowed).toBe(false);
    expect(policy.liveOrderRouting.allowed).toBe(false);
  });

  test("REVIEW requires opt-in for charts and signal research but never unlocks execution", async () => {
    const manifest = await manifestFor("REVIEW");
    const blocked = assessMarketDatasetUse(manifest);
    const exploratory = assessMarketDatasetUse(manifest, { allowReview: true });

    expect(blocked.chart.allowed).toBe(false);
    expect(blocked.signalResearch.allowed).toBe(false);
    expect(exploratory.chart.allowed).toBe(true);
    expect(exploratory.signalResearch.allowed).toBe(true);
    expect(exploratory.strategyBacktest.allowed).toBe(false);
    expect(exploratory.paperExecution.allowed).toBe(false);
  });

  test("REJECTED data stays blocked even with explicit REVIEW opt-in", async () => {
    const policy = assessMarketDatasetUse(await manifestFor("REJECTED"), { allowReview: true });
    expect(policy.chart.allowed).toBe(false);
    expect(policy.signalResearch.allowed).toBe(false);
    expect(policy.strategyBacktest.allowed).toBe(false);
  });

  test("Nasdaq-style CFD remains non-executable until its own economics are verified", async () => {
    const policy = assessMarketDatasetUse(await manifestFor("PASS", "NAS100-DUKA"));
    expect(policy.chart.allowed).toBe(true);
    expect(policy.strategyBacktest.allowed).toBe(false);
    expect(policy.strategyBacktest.reasons.some((reason) => reason.includes("contract economics"))).toBe(true);
  });
});
