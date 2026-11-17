/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createMarketDatasetManifest,
  parseDukascopyCsv,
  serializeNormalizedBars,
  type CsvImportOptions,
} from "./market-dataset";
import {
  DatasetStoreError,
  listMarketDatasets,
  loadMarketDataset,
} from "./market-dataset-store";

const HOUR = 60 * 60_000;
const options: CsvImportOptions = {
  instrumentId: "XAUUSD-DUKA",
  timeframe: "h1",
  priceSide: "bid",
  from: "2024-01-01",
  to: "2024-01-03",
  asOfTs: Date.parse("2024-01-04T00:00:00.000Z"),
  volumeUnits: "units",
};
const timestamp0 = Date.parse("2024-01-01T00:00:00.000Z");
const sourceCsv = [
  "timestamp,open,high,low,close,volume",
  timestamp0 + ",2050,2052,2049,2051,100",
  (timestamp0 + HOUR) + ",2051,2053,2050,2052,125",
].join("\n");

const tempRoots: string[] = [];
afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createFixture(args: {
  quality?: "PASS" | "REVIEW" | "REJECTED";
  source?: string;
  normalized?: string;
  datasetIdSuffix?: string;
} = {}) {
  const root = await mkdtemp(join(tmpdir(), "ami-dataset-store-"));
  tempRoots.push(root);
  let rawSource = args.source ?? sourceCsv;
  if (!args.source && args.quality === "REVIEW") {
    rawSource += "\\n" + (timestamp0 + HOUR) + ",2051,2053,2050,2052,125";
  }
  if (!args.source && args.quality === "REJECTED") {
    rawSource += "\\n" + (timestamp0 + 2 * HOUR) + ",2050,2040,2049,2051,10";
  }
  const parsed = parseDukascopyCsv(rawSource, options);
  const normalized = args.normalized ?? serializeNormalizedBars(parsed.bars);
  const manifest = await createMarketDatasetManifest({
    options,
    parsed,
    sourceFileName: "xauusd-h1-bid.csv",
    rawCsv: rawSource,
    normalizedCsv: normalized,
    importedAt: "2024-01-04T00:00:00.000Z",
  });
  const datasetId = manifest.datasetId + (args.datasetIdSuffix ?? "");
  manifest.datasetId = datasetId;
  const directory = join(root, "xauusd-duka", "h1", datasetId);
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, "source.csv"), rawSource);
  await writeFile(join(directory, "normalized.csv"), normalized);
  await writeFile(join(directory, "manifest.json"), JSON.stringify(manifest, null, 2));
  return { root, directory, manifest, normalized };
}

describe("verified local market dataset store", () => {
  test("lists revisions but skips raw download folders and malformed manifests", async () => {
    const fixture = await createFixture();
    const rawDownloads = join(fixture.root, "downloads", "xauusd");
    const malformed = join(fixture.root, "xauusd-duka", "h1", "xauusd-duka-h1-2024-01-01-2024-01-03-ask-badbadbad");
    await mkdir(rawDownloads, { recursive: true });
    await mkdir(malformed, { recursive: true });
    await writeFile(join(malformed, "manifest.json"), "{broken");

    const result = await listMarketDatasets(fixture.root);
    expect(result.datasets).toHaveLength(1);
    expect(result.datasets[0].datasetId).toBe(fixture.manifest.datasetId);
    expect(result.skipped).toHaveLength(1);
  });

  test("loads a specific PASS revision and re-verifies both source hashes", async () => {
    const fixture = await createFixture();
    const loaded = await loadMarketDataset(fixture.manifest.datasetId, { rootDir: fixture.root });

    expect(loaded.bars).toHaveLength(2);
    expect(loaded.bars[0].ct).toBe(timestamp0 + HOUR - 1);
    expect(loaded.manifest.datasetId).toBe(fixture.manifest.datasetId);
  });

  test("rejects a REVIEW revision by default and permits explicit exploratory opt-in", async () => {
    const fixture = await createFixture({ quality: "REVIEW" });
    await expect(loadMarketDataset(fixture.manifest.datasetId, { rootDir: fixture.root }))
      .rejects.toMatchObject({ code: "REVIEW_REQUIRES_OPT_IN" });

    const loaded = await loadMarketDataset(fixture.manifest.datasetId, {
      rootDir: fixture.root,
      allowReview: true,
    });
    expect(loaded.manifest.quality.qualityStatus).toBe("REVIEW");
  });

  test("never loads a REJECTED revision even with review opt-in", async () => {
    const fixture = await createFixture({ quality: "REJECTED" });
    await expect(loadMarketDataset(fixture.manifest.datasetId, {
      rootDir: fixture.root,
      allowReview: true,
    })).rejects.toMatchObject({ code: "DATASET_REJECTED" });
  });

  test("detects changed raw source and normalized data", async () => {
    const rawFixture = await createFixture();
    await writeFile(join(rawFixture.directory, "source.csv"), sourceCsv + "\n");
    await expect(loadMarketDataset(rawFixture.manifest.datasetId, { rootDir: rawFixture.root }))
      .rejects.toMatchObject({ code: "RAW_HASH_MISMATCH" });

    const normalizedFixture = await createFixture();
    await writeFile(join(normalizedFixture.directory, "normalized.csv"), normalizedFixture.normalized + "\n");
    await expect(loadMarketDataset(normalizedFixture.manifest.datasetId, { rootDir: normalizedFixture.root }))
      .rejects.toMatchObject({ code: "NORMALIZED_HASH_MISMATCH" });
  });

  test("rejects corrupt normalized values even when its hash and dataset revision are updated", async () => {
    const fixture = await createFixture();
    const corrupt = fixture.normalized.replace("2052", "2040");
    const { sha256Hex } = await import("./market-dataset");
    fixture.manifest.provenance.normalizedSha256 = await sha256Hex(corrupt);
    const newDatasetId = [
      options.instrumentId.toLowerCase(),
      options.timeframe,
      options.from,
      options.to,
      options.priceSide,
      fixture.manifest.provenance.rawSha256.slice(0, 8),
      fixture.manifest.provenance.normalizedSha256.slice(0, 12),
    ].join("-");
    const newDirectory = join(fixture.root, "xauusd-duka", "h1", newDatasetId);
    await rename(fixture.directory, newDirectory);
    fixture.manifest.datasetId = newDatasetId;
    await writeFile(join(newDirectory, "normalized.csv"), corrupt);
    await writeFile(join(newDirectory, "manifest.json"), JSON.stringify(fixture.manifest, null, 2));

    await expect(loadMarketDataset(newDatasetId, { rootDir: fixture.root }))
      .rejects.toMatchObject({ code: "BAR_INVALID" });
  });

  test("rejects row-count and coverage tampering", async () => {
    const fixture = await createFixture();
    fixture.manifest.actualCoverage.rows += 1;
    await writeFile(join(fixture.directory, "manifest.json"), JSON.stringify(fixture.manifest, null, 2));
    await expect(loadMarketDataset(fixture.manifest.datasetId, { rootDir: fixture.root }))
      .rejects.toMatchObject({ code: "ROW_COUNT_MISMATCH" });
  });

  test("rejects unsafe IDs and does not permit path traversal", async () => {
    await expect(loadMarketDataset("../outside", { rootDir: tmpdir() }))
      .rejects.toBeInstanceOf(DatasetStoreError);
    await expect(loadMarketDataset("not-a-supported-market-id", { rootDir: tmpdir() }))
      .rejects.toMatchObject({ code: "DATASET_NOT_FOUND" });
  });

  test("rejects a manifest that relabels duplicate source bars as PASS", async () => {
    const fixture = await createFixture({ quality: "REVIEW" });
    fixture.manifest.quality.qualityStatus = "PASS";
    await writeFile(join(fixture.directory, "manifest.json"), JSON.stringify(fixture.manifest, null, 2));

    await expect(loadMarketDataset(fixture.manifest.datasetId, { rootDir: fixture.root }))
      .rejects.toMatchObject({ code: "QUALITY_MISMATCH" });
  });

  test("rejects manifest instrument class/provider substitution", async () => {
    const fixture = await createFixture();
    fixture.manifest.instrument.dataClass = "EXCHANGE_FUTURES";
    await writeFile(join(fixture.directory, "manifest.json"), JSON.stringify(fixture.manifest, null, 2));
    await expect(loadMarketDataset(fixture.manifest.datasetId, { rootDir: fixture.root }))
      .rejects.toMatchObject({ code: "INSTRUMENT_MISMATCH" });
  });
});
