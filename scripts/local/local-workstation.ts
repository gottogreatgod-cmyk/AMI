#!/usr/bin/env bun

import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

type HostState = "STARTING" | "RUNNING" | "STOPPING" | "STOPPED" | "ERROR";

interface HostSnapshot {
  schemaVersion: 1;
  state: HostState;
  pid: number;
  startedAt: number;
  heartbeatAt: number;
  url: "http://127.0.0.1:3000";
  database: "SQLITE_LOCAL";
  marketData: "EXPERIMENTAL_DUKASCOPY_POLLING";
  ordersEnabled: false;
  appPid: number | null;
  supervisorPid: number | null;
  lastError: string | null;
}

const ROOT = resolve(process.cwd());
const MONITOR_ROOT = resolve(ROOT, "data/market-data/.monitor");
const PID_PATH = join(MONITOR_ROOT, "local-workstation.pid");
const STATE_PATH = join(MONITOR_ROOT, "local-workstation.latest.json");

let state: HostState = "STARTING";
let startedAt = Date.now();
let app: ReturnType<typeof Bun.spawn> | null = null;
let supervisor: ReturnType<typeof Bun.spawn> | null = null;
let stopPromise: Promise<void> | null = null;
let stopping = false;
let heartbeat: ReturnType<typeof setInterval> | null = null;
let lastError: string | null = null;
let writeQueue: Promise<void> = Promise.resolve();

const sleep = (ms: number) => new Promise<void>((resolvePromise) => setTimeout(resolvePromise, ms));

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function writeSnapshot(): Promise<void> {
  const operation = writeQueue.then(async () => {
    const snapshot: HostSnapshot = {
      schemaVersion: 1,
      state,
      pid: process.pid,
      startedAt,
      heartbeatAt: Date.now(),
      url: "http://127.0.0.1:3000",
      database: "SQLITE_LOCAL",
      marketData: "EXPERIMENTAL_DUKASCOPY_POLLING",
      ordersEnabled: false,
      appPid: app?.pid ?? null,
      supervisorPid: supervisor?.pid ?? null,
      lastError,
    };
    const temp = STATE_PATH + "." + randomUUID() + ".tmp";
    await Bun.write(temp, JSON.stringify(snapshot, null, 2) + "\n");
    await rename(temp, STATE_PATH);
  });
  writeQueue = operation.catch(() => undefined);
  return operation;
}

async function acquireLock(): Promise<void> {
  await mkdir(MONITOR_ROOT, { recursive: true });
  try {
    const oldPid = Number((await readFile(PID_PATH, "utf8")).trim());
    if (Number.isInteger(oldPid) && oldPid > 0 && processAlive(oldPid)) {
      throw new Error("AMI local workstation is already running (PID " + oldPid + ").");
    }
    await rm(PID_PATH, { force: true });
  } catch (error) {
    if (error instanceof Error &&
        error.message.startsWith("AMI local workstation is already running")) {
      throw error;
    }
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const lock = await open(PID_PATH, "wx");
  await lock.writeFile(String(process.pid) + "\n");
  await lock.close();
}

async function releaseLock(): Promise<void> {
  try {
    const oldPid = Number((await readFile(PID_PATH, "utf8")).trim());
    if (oldPid === process.pid) await rm(PID_PATH, { force: true });
  } catch {
    // Continue cleanup if a stale/partial lock has already disappeared.
  }
}

async function runSetupCommand(args: string[], label: string): Promise<void> {
  process.stdout.write("\n[AMI] " + label + "\n");
  const child = Bun.spawn(args, {
    cwd: ROOT,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const code = await child.exited;
  if (code !== 0) {
    throw new Error(label + " failed with exit code " + code + ".");
  }
}

async function stopChild(
  child: ReturnType<typeof Bun.spawn> | null,
  label: string
): Promise<void> {
  if (!child) return;
  try {
    child.kill("SIGTERM");
    const exited = await Promise.race([
      child.exited.then(() => true),
      sleep(10_000).then(() => false),
    ]);
    if (!exited) {
      process.stdout.write("[AMI] " + label + " did not stop in 10 seconds; sending SIGKILL.\n");
      child.kill("SIGKILL");
      await child.exited;
    }
  } catch {
    // Child may have exited between the process check and signal.
  }
}

async function performStop(): Promise<void> {
  stopping = true;
  state = "STOPPING";
  if (heartbeat) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
  await writeSnapshot();
  await Promise.all([
    stopChild(app, "Next.js"),
    stopChild(supervisor, "market-data supervisor"),
  ]);
  app = null;
  supervisor = null;
  state = "STOPPED";
  await writeSnapshot();
  await releaseLock();
}

function stop(): Promise<void> {
  if (stopPromise) return stopPromise;
  stopPromise = performStop();
  return stopPromise;
}

async function start(): Promise<void> {
  const secret = process.env.NEXTAUTH_SECRET ?? "";
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (!dbUrl.startsWith("file:")) {
    throw new Error("DATABASE_URL must use a local SQLite file URL for this local workstation runner.");
  }
  if (secret.length < 32 || /replace-with|changeme|example/i.test(secret)) {
    throw new Error("Set a unique NEXTAUTH_SECRET (at least 32 characters) in .env before starting.");
  }

  const nextAuthUrl = process.env.NEXTAUTH_URL;
  if (nextAuthUrl && nextAuthUrl !== "http://127.0.0.1:3000") {
    throw new Error("For this localhost-only runner set NEXTAUTH_URL=http://127.0.0.1:3000.");
  }
  process.env.NEXTAUTH_URL = "http://127.0.0.1:3000";

  await acquireLock();
  startedAt = Date.now();
  state = "STARTING";
  process.on("SIGINT", () => { void stop(); });
  process.on("SIGTERM", () => { void stop(); });
  heartbeat = setInterval(() => { void writeSnapshot(); }, 2_000);
  await writeSnapshot();

  try {
    await runSetupCommand([process.execPath, "run", "db:generate"], "Generate Prisma client");
    await runSetupCommand([process.execPath, "run", "db:push:safe"], "Synchronize local SQLite schema");

    process.stdout.write("\n[AMI] Starting local market-data supervisor (experimental Dukascopy polling).\n");
    supervisor = Bun.spawn([
      process.execPath,
      "run",
      "scripts/market-data/local-supervisor.ts",
      "start",
    ], {
      cwd: ROOT,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });

    process.stdout.write("\n[AMI] Starting Next.js on http://127.0.0.1:3000 (localhost only).\n");
    app = Bun.spawn([
      process.execPath,
      "run",
      "next",
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3000",
    ], {
      cwd: ROOT,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    });

    state = "RUNNING";
    await writeSnapshot();
    process.stdout.write("\n[AMI] Local observation workstation is starting. Open http://127.0.0.1:3000.\n");
    process.stdout.write("[AMI] Press Ctrl+C to stop the app and both market-data pollers.\n");
    const result = await Promise.race([
      app.exited.then((code) => ({ service: "Next.js", code })),
      supervisor.exited.then((code) => ({ service: "market-data supervisor", code })),
    ]);
    if (!stopping) {
      lastError = result.service + " exited unexpectedly with code " + result.code + ".";
      state = "ERROR";
      process.stderr.write("[AMI] " + lastError + "\n");
    }
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    state = "ERROR";
    await writeSnapshot();
    throw error;
  } finally {
    await stop();
  }
}

async function printStatus(): Promise<void> {
  try {
    const host = JSON.parse(await readFile(STATE_PATH, "utf8")) as HostSnapshot;
    const age = Math.max(0, Date.now() - host.heartbeatAt);
    let supervisorStatus: unknown = null;
    try {
      supervisorStatus = JSON.parse(await readFile(
        join(MONITOR_ROOT, "local-supervisor.latest.json"),
        "utf8"
      ));
    } catch {
      supervisorStatus = { state: "NOT_STARTED" };
    }
    process.stdout.write(JSON.stringify({
      ...host,
      heartbeatAgeMs: age,
      responsive: age <= 10_000 && processAlive(host.pid),
      supervisor: supervisorStatus,
    }, null, 2) + "\n");
  } catch {
    process.stdout.write(JSON.stringify({ state: "NOT_STARTED", ordersEnabled: false }, null, 2) + "\n");
  }
}

async function requestStop(): Promise<void> {
  try {
    const pid = Number((await readFile(PID_PATH, "utf8")).trim());
    if (!Number.isInteger(pid) || pid <= 0 || !processAlive(pid)) {
      process.stdout.write("[AMI] Local workstation is not running.\n");
      return;
    }
    process.kill(pid, "SIGTERM");
    process.stdout.write("[AMI] Stop requested for local workstation PID " + pid + ".\n");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      process.stdout.write("[AMI] Local workstation is not running.\n");
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
    throw new Error("Usage: bun run local:station -- start|status|stop");
  }
  await start();
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write("[AMI] Local workstation startup failed: " + message + "\n");
    process.exitCode = 1;
  });
}
