#!/usr/bin/env bun

import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildDukascopyDownloadArgs,
  getDukascopyProviderInstrument,
  type DukascopyDownloadCommandOptions,
} from "../../src/lib/data/dukascopy-downloader";
import {
  DUKASCOPY_TIMEFRAMES,
  type DukascopyPriceSide,
  type DukascopyTimeframe,
  type DukascopyVolumeUnits,
} from "../../src/lib/data/market-dataset";

const BOOLEAN_FLAGS = new Set(["include-flats", "no-cache"]);

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const parsed: Record<string, string | boolean> = {};
  for (let index = 0; index < argv.length; index++) {
    const current = argv[index];
    if (!current.startsWith("--")) continue;
    const [key, inlineValue] = current.slice(2).split("=", 2);
    if (BOOLEAN_FLAGS.has(key)) {
      parsed[key] = inlineValue === undefined ? true : inlineValue !== "false";
      continue;
    }
    const value = inlineValue ?? argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error("Missing value for --" + key);
    parsed[key] = value;
    if (inlineValue === undefined) index++;
  }
  return parsed;
}

function required(args: Record<string, string | boolean>, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("Required option --" + key + " is missing.");
  }
  return value;
}

function numberOption(
  args: Record<string, string | boolean>,
  key: string,
  fallback: number
): number {
  const raw = args[key];
  if (raw === undefined) return fallback;
  if (typeof raw !== "string") throw new Error("--" + key + " requires a number.");
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error("--" + key + " must be numeric.");
  return value;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(value + "T00:00:00.000Z");
  return !Number.isNaN(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function usage(): string {
  return [
    "AMI free-first Dukascopy market-data downloader",
    "",
    "Required:",
    "  --instrument XAUUSD-DUKA|NAS100-DUKA",
    "  --timeframe m1|m5|m15|m30|h1|h4|d1",
    "  --from YYYY-MM-DD",
    "  --to YYYY-MM-DD       exclusive UTC end date",
    "",
    "Optional:",
    "  --price-side bid|ask|both (default: both)",
    "  --volume-units millions|thousands|units (default: units)",
    "  --output-dir data/market-data/downloads",
    "  --cache-dir .dukascopy-cache",
    "  --batch-size 5 (1..10)",
    "  --batch-pause-ms 1500 (minimum 500)",
    "  --request-interval-ms 250",
    "  --retries 3",
    "  --rate-limit-retries 5",
    "  --include-flats",
    "  --no-cache",
    "",
    "Downloads are sequential by quote side and are imported immediately.",
    "No live order routing or workstation feed activation occurs.",
  ].join("\n");
}

async function runCommand(command: string[]): Promise<void> {
  const processHandle = Bun.spawn(command, {
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await processHandle.exited;
  if (exitCode !== 0) {
    throw new Error("Command failed with exit code " + exitCode + ": " + command.slice(0, 4).join(" "));
  }
}

async function main(): Promise<void> {
  const rawArgs = Bun.argv.slice(2);
  if (rawArgs.includes("--help") || rawArgs.includes("-h")) {
    process.stdout.write(usage() + "\n");
    return;
  }

  const args = parseArgs(rawArgs);
  const instrumentId = required(args, "instrument") as "XAUUSD-DUKA" | "NAS100-DUKA";
  if (instrumentId !== "XAUUSD-DUKA" && instrumentId !== "NAS100-DUKA") {
    throw new Error("instrument must be XAUUSD-DUKA or NAS100-DUKA.");
  }

  const timeframe = required(args, "timeframe") as DukascopyTimeframe;
  if (!DUKASCOPY_TIMEFRAMES.includes(timeframe)) {
    throw new Error("Unsupported timeframe: " + timeframe);
  }

  const from = required(args, "from");
  const to = required(args, "to");
  if (!validDate(from) || !validDate(to) || Date.parse(to) <= Date.parse(from)) {
    throw new Error("from/to must be valid ascending YYYY-MM-DD UTC dates (to is exclusive).");
  }

  const sideValue = (args["price-side"] ?? "both") as string | boolean;
  const sides: DukascopyPriceSide[] =
    sideValue === "both" ? ["bid", "ask"] :
    sideValue === "bid" || sideValue === "ask" ? [sideValue] :
    (() => { throw new Error("price-side must be bid, ask or both."); })();

  const volumeUnits = (args["volume-units"] ?? "units") as DukascopyVolumeUnits | boolean;
  if (typeof volumeUnits !== "string" || !["millions", "thousands", "units"].includes(volumeUnits)) {
    throw new Error("volume-units must be millions, thousands or units.");
  }

  const providerInstrument = getDukascopyProviderInstrument(instrumentId);
  const outputDirectory = resolve(
    typeof args["output-dir"] === "string"
      ? args["output-dir"]
      : "data/market-data/downloads/" + instrumentId.toLowerCase() + "/" + timeframe + "/" + from + "_" + to
  );
  const cacheDirectory = resolve(
    typeof args["cache-dir"] === "string" ? args["cache-dir"] : ".dukascopy-cache"
  );
  await mkdir(outputDirectory, { recursive: true });
  if (args["no-cache"] !== true) await mkdir(cacheDirectory, { recursive: true });

  const settings: Omit<DukascopyDownloadCommandOptions, "priceSide" | "fileName"> = {
    instrumentId,
    timeframe,
    from,
    to,
    volumeUnits,
    outputDirectory,
    cacheDirectory,
    useCache: args["no-cache"] !== true,
    includeFlats: args["include-flats"] === true,
    batchSize: numberOption(args, "batch-size", 5),
    batchPauseMs: numberOption(args, "batch-pause-ms", 1500),
    requestIntervalMs: numberOption(args, "request-interval-ms", 250),
    retries: numberOption(args, "retries", 3),
    rateLimitRetries: numberOption(args, "rate-limit-retries", 5),
  };

  for (const side of sides) {
    const fileName = [
      providerInstrument,
      timeframe,
      side,
      from,
      to,
    ].join("-");
    const downloadArgs = buildDukascopyDownloadArgs({
      ...settings,
      priceSide: side,
      fileName,
    });
    process.stdout.write(
      "Downloading " + instrumentId + " " + timeframe + " " + side + " via " + providerInstrument + "\n"
    );
    await runCommand([process.execPath, "x", ...downloadArgs]);

    const csvPath = resolve(outputDirectory, fileName + ".csv");
    if (!(await Bun.file(csvPath).exists())) {
      throw new Error("Downloader exited successfully but expected CSV was not found: " + csvPath);
    }

    process.stdout.write("Importing normalized dataset for " + side + "\n");
    await runCommand([
      process.execPath,
      "run",
      "market-data:import",
      "--",
      "--instrument", instrumentId,
      "--timeframe", timeframe,
      "--price-side", side,
      "--from", from,
      "--to", to,
      "--volume-units", volumeUnits,
      "--input", csvPath,
    ]);
  }

  process.stdout.write(
    "Download and import complete. Source files, normalized datasets and manifests are under " +
      resolve("data/market-data") + "\n"
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write("AMI Dukascopy download failed: " + message + "\n\n" + usage() + "\n");
  process.exitCode = 1;
});
