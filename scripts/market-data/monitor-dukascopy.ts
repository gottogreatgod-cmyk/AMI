#!/usr/bin/env bun

import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { getMarketInstrumentMetadata } from "../../src/lib/data/market-instrument-contract";
import { DUKASCOPY_TIMEFRAMES } from "../../src/lib/data/market-dataset";

const SUPPORTED = ["XAUUSD-DUKA", "NAS100-DUKA"] as const;
type SupportedInstrument = (typeof SUPPORTED)[number];

function usage(): string {
  return [
    "AMI experimental Dukascopy polling monitor",
    "",
    "Required:",
    "  --instrument XAUUSD-DUKA|NAS100-DUKA",
    "",
    "Optional:",
    "  --timeframe m1|m5|m15|m30|h1|h4|d1 (default: m1)",
    "  --poll-seconds 60 (minimum: 30)",
    "  --once                 run one polling cycle and exit",
    "",
    "Examples:",
    "  bun run market-data:monitor -- --instrument XAUUSD-DUKA",
    "  bun run market-data:monitor -- --instrument NAS100-DUKA --timeframe m5 --poll-seconds 60",
    "",
    "The monitor installs dukascopy-node@1.51.1 in an isolated local runtime workspace.",
    "It writes snapshots under data/market-data/.monitor/ and does not enable trading.",
    "This is experimental polling, not a persistent WebSocket or an exchange-grade stream.",
  ].join("\n");
}

function readOption(args: string[], name: string, fallback?: string): string | undefined {
  const index = args.findIndex((value) => value === "--" + name || value.startsWith("--" + name + "="));
  if (index < 0) return fallback;
  const current = args[index];
  if (current.includes("=")) return current.slice(current.indexOf("=") + 1);
  return args[index + 1];
}

async function runCommand(command: string[], cwd: string, env?: Record<string, string>): Promise<void> {
  const child = Bun.spawn(command, {
    cwd,
    env: { ...process.env, ...env },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await child.exited;
  if (code !== 0) throw new Error("Command failed with exit code " + code + ": " + command.join(" "));
}

async function main() {
  const args = Bun.argv.slice(2);
  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    process.stdout.write(usage() + "\n");
    return;
  }

  const instrumentId = readOption(args, "instrument") as SupportedInstrument | undefined;
  if (!instrumentId || !SUPPORTED.includes(instrumentId)) {
    throw new Error("--instrument must be XAUUSD-DUKA or NAS100-DUKA.");
  }
  const timeframe = readOption(args, "timeframe", "m1")!;
  if (!(DUKASCOPY_TIMEFRAMES as readonly string[]).includes(timeframe)) {
    throw new Error("Unsupported monitor timeframe: " + timeframe);
  }
  const pollSeconds = Number(readOption(args, "poll-seconds", "60"));
  if (!Number.isInteger(pollSeconds) || pollSeconds < 30 || pollSeconds > 3600) {
    throw new Error("--poll-seconds must be an integer from 30 to 3600.");
  }

  const metadata = getMarketInstrumentMetadata(instrumentId);
  if (!metadata || metadata.provider !== "Dukascopy" || !metadata.providerInstrument) {
    throw new Error("No Dukascopy provider mapping for " + instrumentId);
  }

  const root = resolve(process.cwd());
  const monitorRoot = resolve(root, "data/market-data/.monitor");
  const runtimeDir = resolve(root, "data/market-data/.runtime/dukascopy-realtime");
  const packagePath = resolve(runtimeDir, "package.json");
  const packageJson = {
    name: "ami-dukascopy-realtime-runtime",
    version: "1.0.0",
    private: true,
    type: "module",
    dependencies: { "dukascopy-node": "1.51.1" },
  };

  await mkdir(runtimeDir, { recursive: true });
  await mkdir(monitorRoot, { recursive: true });
  const packageFile = Bun.file(packagePath);
  let installRequired = !(await packageFile.exists());
  if (!installRequired) {
    try {
      const existing = JSON.parse(await packageFile.text()) as {
        dependencies?: Record<string, string>;
      };
      installRequired = existing.dependencies?.["dukascopy-node"] !== "1.51.1";
    } catch {
      installRequired = true;
    }
  }
  if (installRequired) {
    await Bun.write(packagePath, JSON.stringify(packageJson, null, 2) + "\n");
  }

  const installedPackage = Bun.file(resolve(runtimeDir, "node_modules/dukascopy-node/package.json"));
  if (installRequired || !(await installedPackage.exists())) {
    process.stdout.write("Installing isolated dukascopy-node@1.51.1 runtime…\n");
    const lockExists = await Bun.file(resolve(runtimeDir, "bun.lock")).exists() ||
      await Bun.file(resolve(runtimeDir, "bun.lockb")).exists();
    const useFrozenLock = !installRequired && lockExists;
    await runCommand(
      useFrozenLock ? [process.execPath, "install", "--frozen-lockfile"] : [process.execPath, "install"],
      runtimeDir
    );
  }
  const installedMeta = JSON.parse(await installedPackage.text()) as { version?: string };
  if (installedMeta.version !== "1.51.1") {
    throw new Error("Isolated Dukascopy runtime version mismatch; expected 1.51.1, received " + installedMeta.version);
  }

  const workerSource = Bun.file(resolve(root, "scripts/market-data/dukascopy-realtime-worker.mjs"));
  if (!(await workerSource.exists())) throw new Error("Realtime worker source file not found.");
  const workerPath = resolve(runtimeDir, "monitor.mjs");
  await Bun.write(workerPath, await workerSource.text());

  const outputPath = resolve(monitorRoot, instrumentId.toLowerCase() + ".latest.json");
  const helperPath = resolve(root, "src/lib/data/realtime-monitor.ts");
  const env = {
    AMI_MONITOR_INSTRUMENT_ID: instrumentId,
    AMI_MONITOR_PROVIDER_INSTRUMENT: metadata.providerInstrument,
    AMI_MONITOR_TIMEFRAME: timeframe,
    AMI_MONITOR_POLL_SECONDS: String(pollSeconds),
    AMI_MONITOR_OUTPUT: outputPath,
    AMI_MONITOR_HELPER: helperPath,
  };

  process.stdout.write(
    "Starting experimental Dukascopy polling for " +
    instrumentId + " (" + metadata.providerInstrument + ", " + timeframe +
    ") every " + pollSeconds + "s. Ctrl+C stops the monitor.\n"
  );
  const workerArgs = [process.execPath, "run", workerPath];
  await runCommand(
    workerArgs,
    runtimeDir,
    args.includes("--once") ? { ...env, AMI_MONITOR_ONCE: "1" } : env
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write("AMI Dukascopy monitor failed: " + message + "\n\n" + usage() + "\n");
  process.exitCode = 1;
});
