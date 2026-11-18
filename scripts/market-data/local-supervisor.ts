#!/usr/bin/env bun

import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

export type SupervisorWorkerState =
  | "STARTING"
  | "RUNNING"
  | "RESTART_WAIT"
  | "ERROR"
  | "STOPPING"
  | "STOPPED";

export interface RestartPolicy {
  maxRestarts: number;
  windowMs: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RESTART_POLICY: RestartPolicy = {
  maxRestarts: 5,
  windowMs: 15 * 60_000,
  baseDelayMs: 5_000,
  maxDelayMs: 5 * 60_000,
};

export function getRestartDelayMs(
  restartCount: number,
  policy: RestartPolicy = DEFAULT_RESTART_POLICY
): number {
  const exponent = Math.max(0, Math.min(20, Math.floor(restartCount) - 1));
  return Math.min(policy.maxDelayMs, policy.baseDelayMs * (2 ** exponent));
}

export function isRestartAllowed(
  restartTimestamps: number[],
  now: number,
  policy: RestartPolicy = DEFAULT_RESTART_POLICY
): boolean {
  const recent = restartTimestamps.filter((timestamp) =>
    Number.isFinite(timestamp) && timestamp > now - policy.windowMs && timestamp <= now
  );
  return recent.length < policy.maxRestarts;
}

type InstrumentTarget = {
  kind: "MARKET_POLL" | "LIVE_OPPORTUNITY";
  instrumentId: "XAUUSD-DUKA" | "NAS100-DUKA";
  timeframe: "m1";
  pollSeconds: number;
  priceSide?: "bid" | "ask";
};

type WorkerRuntime = {
  target: InstrumentTarget;
  state: SupervisorWorkerState;
  pid: number | null;
  startedAt: number | null;
  lastExitAt: number | null;
  lastExitCode: number | null;
  restartCount: number;
  restartTimestamps: number[];
  nextStartAt: number | null;
  lastError: string | null;
  child: ReturnType<typeof Bun.spawn> | null;
};

type SupervisorSnapshot = {
  schemaVersion: 1;
  state: "RUNNING" | "STOPPING" | "STOPPED";
  pid: number;
  startedAt: number;
  heartbeatAt: number;
  feedMode: "EXPERIMENTAL_POLLING";
  ordersEnabled: false;
  workers: Array<Omit<WorkerRuntime, "child" | "restartTimestamps"> & {
    recentRestartCount: number;
  }>;
};

const ROOT = resolve(process.cwd());
const MONITOR_SCRIPT = resolve(ROOT, "scripts/market-data/monitor-dukascopy.ts");
const LIVE_OPPORTUNITY_SCRIPT = resolve(ROOT, "scripts/market-data/live-opportunity-worker.ts");
const MONITOR_ROOT = resolve(ROOT, "data/market-data/.monitor");
const PID_PATH = join(MONITOR_ROOT, "local-supervisor.pid");
const STATE_PATH = join(MONITOR_ROOT, "local-supervisor.latest.json");
const TARGETS: InstrumentTarget[] = [
  { kind: "MARKET_POLL", instrumentId: "XAUUSD-DUKA", timeframe: "m1", pollSeconds: 60 },
  { kind: "MARKET_POLL", instrumentId: "NAS100-DUKA", timeframe: "m1", pollSeconds: 60 },
  { kind: "LIVE_OPPORTUNITY", instrumentId: "XAUUSD-DUKA", timeframe: "m1", priceSide: "bid", pollSeconds: 5 },
  { kind: "LIVE_OPPORTUNITY", instrumentId: "XAUUSD-DUKA", timeframe: "m1", priceSide: "ask", pollSeconds: 5 },
  { kind: "LIVE_OPPORTUNITY", instrumentId: "NAS100-DUKA", timeframe: "m1", priceSide: "bid", pollSeconds: 5 },
  { kind: "LIVE_OPPORTUNITY", instrumentId: "NAS100-DUKA", timeframe: "m1", priceSide: "ask", pollSeconds: 5 },
];

let stopping = false;
let supervisorStartedAt = Date.now();
let supervisorState: SupervisorSnapshot["state"] = "RUNNING";
let snapshotWriteQueue: Promise<void> = Promise.resolve();
let shutdownPromise: Promise<void> | null = null;

const workers: WorkerRuntime[] = TARGETS.map((target) => ({
  target,
  state: "STARTING",
  pid: null,
  startedAt: null,
  lastExitAt: null,
  lastExitCode: null,
  restartCount: 0,
  restartTimestamps: [],
  nextStartAt: null,
  lastError: null,
  child: null,
}));

const sleep = (ms: number) => new Promise<void>((resolvePromise) => setTimeout(resolvePromise, ms));

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "EPERM";
  }
}

async function writeSnapshot(): Promise<void> {
  const operation = snapshotWriteQueue.then(async () => {
    const snapshot: SupervisorSnapshot = {
      schemaVersion: 1,
      state: supervisorState,
      pid: process.pid,
      startedAt: supervisorStartedAt,
      heartbeatAt: Date.now(),
      feedMode: "EXPERIMENTAL_POLLING",
      ordersEnabled: false,
      workers: workers.map(({ child: _child, restartTimestamps, ...worker }) => ({
        ...worker,
        recentRestartCount: restartTimestamps.filter((timestamp) =>
          timestamp > Date.now() - DEFAULT_RESTART_POLICY.windowMs
        ).length,
      })),
    };
    const tempPath = STATE_PATH + "." + process.pid + ".tmp";
    await Bun.write(tempPath, JSON.stringify(snapshot, null, 2) + "\n");
    await rename(tempPath, STATE_PATH);
  });
  snapshotWriteQueue = operation.catch(() => undefined);
  return operation;
}

function recordExit(worker: WorkerRuntime, code: number): void {
  worker.child = null;
  worker.pid = null;
  worker.lastExitAt = Date.now();
  worker.lastExitCode = code;
  if (stopping) {
    worker.state = "STOPPED";
    return;
  }

  const now = Date.now();
  worker.restartTimestamps = worker.restartTimestamps.filter((timestamp) =>
    timestamp > now - DEFAULT_RESTART_POLICY.windowMs
  );

  if (!isRestartAllowed(worker.restartTimestamps, now)) {
    worker.state = "ERROR";
    worker.nextStartAt = null;
    worker.lastError = "Restart budget exhausted; manual restart is required.";
    return;
  }

  worker.restartTimestamps.push(now);
  worker.restartCount += 1;
  worker.nextStartAt = now + getRestartDelayMs(worker.restartCount);
  worker.state = "RESTART_WAIT";
}

async function startWorker(worker: WorkerRuntime): Promise<void> {
  if (stopping) return;
  worker.state = "STARTING";
  worker.lastError = null;
  worker.nextStartAt = null;
  await writeSnapshot();

  try {
    const workerArgs = worker.target.kind === "MARKET_POLL"
      ? [process.execPath, "run", MONITOR_SCRIPT, "--instrument", worker.target.instrumentId, "--timeframe", worker.target.timeframe, "--poll-seconds", String(worker.target.pollSeconds)]
      : [process.execPath, "run", LIVE_OPPORTUNITY_SCRIPT, "--instrument", worker.target.instrumentId, "--price-side", worker.target.priceSide!, "--poll-seconds", String(worker.target.pollSeconds)];
    const child = Bun.spawn(workerArgs, {
      cwd: ROOT,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });
    worker.child = child;
    worker.pid = child.pid;
    worker.startedAt = Date.now();
    worker.state = "RUNNING";
    void child.exited.then((code) => {
      recordExit(worker, code);
    }).catch((error: unknown) => {
      worker.lastError = error instanceof Error ? error.message : String(error);
      recordExit(worker, 1);
    });
  } catch (error) {
    worker.lastError = error instanceof Error ? error.message : String(error);
    recordExit(worker, 1);
  }

  await writeSnapshot();
}

async function acquireLock(): Promise<void> {
  await mkdir(MONITOR_ROOT, { recursive: true });

  try {
    const existingPid = Number((await readFile(PID_PATH, "utf8")).trim());
    if (Number.isInteger(existingPid) && existingPid > 0 && isProcessAlive(existingPid)) {
      throw new Error("AMI market-data supervisor is already running (PID " + existingPid + ").");
    }
    await rm(PID_PATH, { force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT" &&
        !(error instanceof Error && error.message.startsWith("AMI market-data supervisor is already running"))) {
      throw error;
    }
    if (error instanceof Error && error.message.startsWith("AMI market-data supervisor is already running")) {
      throw error;
    }
  }

  const lock = await open(PID_PATH, "wx");
  await lock.writeFile(String(process.pid) + "\n");
  await lock.close();
}

async function releaseLock(): Promise<void> {
  try {
    const value = Number((await readFile(PID_PATH, "utf8")).trim());
    if (value === process.pid) await rm(PID_PATH, { force: true });
  } catch {
    // The lock may already have been removed during a partial shutdown.
  }
}

function shutdown(): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = performShutdown();
  return shutdownPromise;
}

async function performShutdown(): Promise<void> {
  if (stopping && supervisorState === "STOPPED") return;
  stopping = true;
  supervisorState = "STOPPING";
  for (const worker of workers) {
    if (worker.child) worker.state = "STOPPING";
  }
  await writeSnapshot();

  await Promise.all(workers.map(async (worker) => {
    const child = worker.child;
    if (!child) {
      worker.state = "STOPPED";
      return;
    }
    try {
      child.kill("SIGTERM");
      const exited = await Promise.race([
        child.exited.then(() => true),
        sleep(10_000).then(() => false),
      ]);
      if (!exited) {
        child.kill("SIGKILL");
        await child.exited;
      }
    } catch {
      // Continue shutting down the remaining worker even if one process vanished.
    }
    worker.child = null;
    worker.pid = null;
    worker.state = "STOPPED";
  }));

  supervisorState = "STOPPED";
  await writeSnapshot();
  await releaseLock();
}

async function runSupervisor(): Promise<void> {
  await acquireLock();
  supervisorStartedAt = Date.now();
  process.on("SIGINT", () => { void shutdown(); });
  process.on("SIGTERM", () => { void shutdown(); });

  process.stdout.write(
    "AMI local market-data supervisor starting two experimental Dukascopy M1 pollers. " +
    "No broker orders are enabled. Press Ctrl+C to stop.\n"
  );

  await Promise.all(workers.map((worker) => startWorker(worker)));

  while (!stopping) {
    const now = Date.now();
    for (const worker of workers) {
      if (worker.state === "RESTART_WAIT" && worker.nextStartAt !== null &&
          now >= worker.nextStartAt) {
        await startWorker(worker);
      }
    }
    await writeSnapshot();
    await sleep(2_000);
  }

  await shutdown();
}

async function printStatus(): Promise<void> {
  try {
    const raw = await readFile(STATE_PATH, "utf8");
    const snapshot = JSON.parse(raw) as SupervisorSnapshot;
    const ageMs = Math.max(0, Date.now() - snapshot.heartbeatAt);
    process.stdout.write(JSON.stringify({
      ...snapshot,
      heartbeatAgeMs: ageMs,
      responsive: ageMs <= 15_000,
    }, null, 2) + "\n");
  } catch {
    process.stdout.write(JSON.stringify({
      state: "NOT_STARTED",
      feedMode: "EXPERIMENTAL_POLLING",
      ordersEnabled: false,
    }, null, 2) + "\n");
  }
}

async function requestStop(): Promise<void> {
  try {
    const pid = Number((await readFile(PID_PATH, "utf8")).trim());
    if (!Number.isInteger(pid) || pid <= 0 || !isProcessAlive(pid)) {
      process.stdout.write("AMI market-data supervisor is not running.\n");
      return;
    }
    process.kill(pid, "SIGTERM");
    process.stdout.write("Stop requested for AMI market-data supervisor PID " + pid + ".\n");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      process.stdout.write("AMI market-data supervisor is not running.\n");
      return;
    }
    throw error;
  }
}

async function main(): Promise<void> {
  const action = Bun.argv[2] ?? "start";
  if (action === "status") return printStatus();
  if (action === "stop") return requestStop();
  if (action !== "start") {
    throw new Error("Usage: bun run market-data:supervisor -- start|stop|status");
  }
  await runSupervisor();
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write("AMI market-data supervisor error: " + message + "\n");
    process.exitCode = 1;
  });
}
