#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { db } from "../../src/lib/db";
import { listMarketDatasets, loadMarketDataset } from "../../src/lib/data/market-dataset-store";
import { assessMarketDatasetUse } from "../../src/lib/data/market-dataset-policy";
import {
  classifyMonitorHealth,
  type MonitorBar,
  type MonitorTimeframe,
} from "../../src/lib/data/realtime-monitor";
import {
  REPLAY_ENGINE_VERSION,
  type ReplayEventDraft,
} from "../../src/lib/engine/replay/replay-engine";
import {
  createStructureBreakRetestMachine,
  type StructureBreakRetestState,
} from "../../src/lib/engine/replay/detectors/structure-break-retest-detector";
import {
  fingerprintForwardBar,
  processForwardClosedBars,
  type ForwardBar,
  type ForwardCursor,
} from "../../src/lib/engine/live/live-opportunity-processor";

const INSTRUMENTS = {
  "XAUUSD-DUKA": { file: "xauusd-duka.latest.json", providerInstrument: "xauusd" },
  "NAS100-DUKA": { file: "nas100-duka.latest.json", providerInstrument: "usatechidxusd" },
} as const;
const TIMEFRAME: MonitorTimeframe = "m1";
const TIMEFRAME_MS = 60_000;
const DETECTOR_OPTIONS = {
  leftBars: 3,
  rightBars: 3,
  maxBarsAfterBreak: 12,
  maxBarsAfterRetest: 8,
};
const DETECTOR = createStructureBreakRetestMachine(DETECTOR_OPTIONS);
const DETECTOR_PARAMS_HASH = createHash("sha256")
  .update(JSON.stringify({
    detectorId: DETECTOR.detectorId,
    detectorVersion: DETECTOR.detectorVersion,
    options: DETECTOR_OPTIONS,
  }))
  .digest("hex");
const ENGINE_VERSION = REPLAY_ENGINE_VERSION;
const RECOVERY_RETRY_INTERVAL_MS = 60_000;
let lastRecoveryAttemptAt = 0;

type InstrumentId = keyof typeof INSTRUMENTS;
type PriceSide = "bid" | "ask";

interface MonitorEnvelope {
  schemaVersion?: number;
  instrumentId?: string;
  poller?: Record<string, unknown>;
  snapshot?: Record<string, unknown> | null;
}

interface ParsedArgs {
  action: "run" | "status";
  instrumentId: InstrumentId;
  priceSide: PriceSide;
  pollSeconds: number;
  once: boolean;
  reseed: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.filter((argument) => argument !== "--");
  const values = new Map<string, string | boolean>();
  for (let index = 0; index < args.length; index++) {
    const item = args[index];
    if (!item.startsWith("--")) continue;
    const [key, inline] = item.slice(2).split("=", 2);
    if (key === "once" || key === "reseed") {
      values.set(key, inline === undefined ? true : inline !== "false");
      continue;
    }
    const value = inline ?? args[index + 1];
    if (!value || value.startsWith("--")) throw new Error("Missing value for --" + key);
    values.set(key, value);
    if (inline === undefined) index++;
  }

  const actionValue = values.get("action");
  const action = actionValue === "status" ? "status" : "run";
  const instrumentValue = values.get("instrument");
  if (typeof instrumentValue !== "string" ||
      !(instrumentValue in INSTRUMENTS)) {
    throw new Error("--instrument must be XAUUSD-DUKA or NAS100-DUKA.");
  }
  const sideValue = values.get("price-side");
  if (sideValue !== "bid" && sideValue !== "ask") {
    throw new Error("--price-side must be bid or ask.");
  }
  const pollRaw = values.get("poll-seconds");
  const pollSeconds = pollRaw === undefined ? 5 : Number(pollRaw);
  if (!Number.isInteger(pollSeconds) || pollSeconds < 2 || pollSeconds > 60) {
    throw new Error("--poll-seconds must be an integer from 2 to 60.");
  }

  return {
    action,
    instrumentId: instrumentValue as InstrumentId,
    priceSide: sideValue,
    pollSeconds,
    once: values.get("once") === true,
    reseed: values.get("reseed") === true,
  };
}

function hash(parts: readonly (string | number)[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

function finite(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function asForwardBar(value: MonitorBar): ForwardBar {
  return {
    t: value.t,
    ct: value.ct,
    o: value.o,
    h: value.h,
    l: value.l,
    c: value.c,
    // The detector does not use volume. A null provider volume is represented
    // as zero only in this internal OHLC contract, never reported as real volume.
    v: value.v ?? 0,
    forming: value.forming,
  };
}

function assertValidSnapshot(
  envelope: MonitorEnvelope,
  snapshot: Record<string, unknown>,
  instrumentId: InstrumentId
): void {
  const source = snapshot.source as Record<string, unknown> | undefined;
  if (
    envelope.schemaVersion !== 1 ||
    envelope.instrumentId !== instrumentId ||
    !envelope.poller ||
    source?.provider !== "Dukascopy" ||
    source.providerInstrument !== INSTRUMENTS[instrumentId].providerInstrument ||
    source.instrumentId !== instrumentId ||
    source.timeframe !== TIMEFRAME ||
    source.feedMode !== "EXPERIMENTAL_POLLING" ||
    source.ordersEnabled !== false
  ) {
    throw new Error("Monitor snapshot identity or safety contract is invalid.");
  }
}

function buildCursorKey(instrumentId: InstrumentId, priceSide: PriceSide): string {
  return hash([
    instrumentId,
    INSTRUMENTS[instrumentId].providerInstrument,
    TIMEFRAME,
    priceSide,
    DETECTOR.detectorId,
    DETECTOR.detectorVersion,
    DETECTOR_PARAMS_HASH,
    ENGINE_VERSION,
  ]);
}

function directionFromSetupKey(setupKey: string): "long" | "short" | null {
  if (setupKey.startsWith("long:")) return "long";
  if (setupKey.startsWith("short:")) return "short";
  return null;
}

function buildEventRows(input: {
  cursorKey: string;
  instrumentId: InstrumentId;
  priceSide: PriceSide;
  events: Array<{
    setupKey: string;
    eventKey: string;
    type: string;
    occurredAtTs?: number;
    reason: string;
    evidence?: ReplayEventDraft["evidence"];
    bar: ForwardBar;
    sourceBarFingerprint: string;
    origin: "LIVE_BOOTSTRAP" | "LIVE_MONITOR" | "LIVE_RECOVERY";
  }>;
  pollFetchedAt: number;
  tickTimestamp: number | null;
  startSequence: number;
  generation: number;
  sourceRevisionId?: string | null;
  sourceRevisionHash?: string | null;
}) {
  return input.events.map((event, index) => ({
    eventIdentity: hash([
      input.cursorKey,
      input.instrumentId,
      TIMEFRAME,
      input.priceSide,
      input.generation,
      DETECTOR.detectorVersion,
      event.bar.ct,
      event.setupKey,
      event.eventKey,
      event.sourceBarFingerprint,
    ]),
    sequence: input.startSequence + index + 1,
    setupId: hash([
      input.cursorKey,
      input.instrumentId,
      TIMEFRAME,
      input.priceSide,
      input.generation,
      event.setupKey,
    ]),
    eventKey: event.eventKey,
    type: event.type,
    direction: directionFromSetupKey(event.setupKey),
    instrumentId: input.instrumentId,
    timeframe: TIMEFRAME,
    priceSide: input.priceSide,
    occurredAtTs: event.occurredAtTs ?? event.bar.ct,
    discoveredAtTs: event.bar.ct,
    confirmationBarTs: event.bar.t,
    confirmationBarCloseTs: event.bar.ct,
    sourceBarFingerprint: event.sourceBarFingerprint,
    sourceRevisionId: input.sourceRevisionId ?? null,
    sourceRevisionHash: input.sourceRevisionHash ?? null,
    sourcePollFetchedAt: input.pollFetchedAt,
    sourceTickTimestamp: input.tickTimestamp,
    reason: event.reason,
    evidenceJson: JSON.stringify(event.evidence ?? []),
    origin: event.origin,
  }));
}

function safeJsonState(value: string): StructureBreakRetestState {
  const parsed = JSON.parse(value) as StructureBreakRetestState;
  if (
    !parsed ||
    !Array.isArray(parsed.rollingBars) ||
    ![-1, 0, 1].includes(parsed.trend) ||
    typeof parsed.previousClose !== "number" && parsed.previousClose !== null
  ) {
    throw new Error("Persisted live detector state is invalid; cursor requires explicit reseed.");
  }
  return parsed;
}

async function getSnapshot(instrumentId: InstrumentId, priceSide: PriceSide) {
  const root = resolve(process.cwd(), "data/market-data/.monitor");
  const path = join(root, INSTRUMENTS[instrumentId].file);
  const [raw, fileStat] = await Promise.all([
    readFile(path, "utf8"),
    stat(path),
  ]);
  const envelope = JSON.parse(raw) as MonitorEnvelope;
  if (!envelope.snapshot) throw new Error("Monitor snapshot has no successful market data.");
  const snapshot = envelope.snapshot as Record<string, unknown>;
  assertValidSnapshot(envelope, snapshot, instrumentId);
  const poller = envelope.poller!;
  const tick = snapshot.tick as Record<string, unknown> | null;
  const health = classifyMonitorHealth({
    snapshotWrittenAt: fileStat.mtimeMs,
    snapshotFetchedAt: finite(snapshot.fetchedAt),
    tickTimestamp: finite(tick?.timestamp),
    timeframe: TIMEFRAME,
    pollSeconds: finite(poller.intervalSeconds),
    lastError: typeof poller.lastError === "string" ? poller.lastError : null,
  });
  const fetchedAt = finite(snapshot.fetchedAt);
  const tickTimestamp = finite(tick?.timestamp);
  const side = snapshot[priceSide] as Record<string, unknown> | undefined;
  const closed = Array.isArray(side?.closedBars) ? side.closedBars : [];
  const bars = closed
    .map((value) => {
      if (!value || typeof value !== "object") return null;
      const row = value as Record<string, unknown>;
      const parsed = {
        t: finite(row.t), ct: finite(row.ct), o: finite(row.o),
        h: finite(row.h), l: finite(row.l), c: finite(row.c),
        v: finite(row.v), forming: row.forming === true,
      };
      if (Object.values(parsed).some((item) => item === null || item === undefined)) return null;
      const bar: ForwardBar = {
        t: parsed.t!, ct: parsed.ct!, o: parsed.o!, h: parsed.h!,
        l: parsed.l!, c: parsed.c!, v: parsed.v ?? 0, forming: parsed.forming,
      };
      if (bar.ct > Date.now() || bar.forming) return null;
      return bar;
    })
    .filter((bar): bar is ForwardBar => bar !== null)
    .sort((a, b) => a.t - b.t);

  return {
    health,
    fetchedAt,
    tickTimestamp,
    poller,
    bars,
  };
}


async function ensureCursor(instrumentId: InstrumentId, priceSide: PriceSide) {
  const cursorKey = buildCursorKey(instrumentId, priceSide);
  const initialState = DETECTOR.createInitialState();
  return db.liveOpportunityCursor.upsert({
    where: { cursorKey },
    create: {
      cursorKey,
      instrumentId,
      providerInstrument: INSTRUMENTS[instrumentId].providerInstrument,
      timeframe: TIMEFRAME,
      priceSide,
      detectorId: DETECTOR.detectorId,
      detectorVersion: DETECTOR.detectorVersion,
      paramsHash: DETECTOR_PARAMS_HASH,
      engineVersion: ENGINE_VERSION,
      stateSchemaVersion: 1,
      stateJson: JSON.stringify(initialState),
      status: "NOT_STARTED",
    },
    update: {},
  });
}

async function recoverFromVerifiedDataset(input: {
  instrumentId: InstrumentId;
  priceSide: PriceSide;
  cursor: {
    stateJson: string;
    barsProcessedCount: number;
    lastProcessedBarTs: number | null;
    lastProcessedBarCloseTs: number | null;
    lastProcessedBarFingerprint: string | null;
  };
  latestLiveBar: ForwardBar;
}) {
  if (input.cursor.lastProcessedBarTs === null ||
      input.cursor.lastProcessedBarFingerprint === null) return null;

  const catalog = await listMarketDatasets();
  const candidates = catalog.datasets
    .filter((item) =>
      item.instrumentId === input.instrumentId &&
      item.timeframe === TIMEFRAME &&
      item.priceSide === input.priceSide &&
      item.qualityStatus === "PASS" &&
      item.fromTs !== null &&
      item.toTs !== null &&
      item.fromTs <= input.cursor.lastProcessedBarTs! &&
      item.toTs >= input.latestLiveBarTs
    )
    .sort((left, right) =>
      (right.importedAt ?? "").localeCompare(left.importedAt ?? "")
    );

  for (const candidate of candidates) {
    try {
      const dataset = await loadMarketDataset(candidate.datasetId);
      const manifest = dataset.manifest;
      const policy = assessMarketDatasetUse(manifest, { allowReview: false });

      if (
        !policy.signalResearch.allowed ||
        manifest.quality.qualityStatus !== "PASS" ||
        manifest.instrument.id !== input.instrumentId ||
        manifest.provenance.provider !== "Dukascopy" ||
        manifest.provenance.providerInstrument !== INSTRUMENTS[input.instrumentId].providerInstrument ||
        manifest.interval.timeframe !== TIMEFRAME ||
        manifest.pricing.datasetPriceSide !== input.priceSide
      ) continue;

      const bars: ForwardBar[] = dataset.bars
        .filter((bar) =>
          bar.t >= input.cursor.lastProcessedBarTs! &&
          bar.t <= input.latestLiveBar.t
        )
        .map((bar) => ({
          t: bar.t,
          ct: bar.ct,
          o: bar.o,
          h: bar.h,
          l: bar.l,
          c: bar.c,
          v: bar.v ?? 0,
          forming: false,
        }));

      const watermark = bars.find((bar) => bar.t === input.cursor.lastProcessedBarTs);
      const datasetTail = bars.find((bar) => bar.t === input.latestLiveBar.t);
      if (!watermark ||
          fingerprintForwardBar(watermark) !== input.cursor.lastProcessedBarFingerprint ||
          !datasetTail ||
          fingerprintForwardBar(datasetTail) !== fingerprintForwardBar(input.latestLiveBar)) {
        continue;
      }

      const recovered = processForwardClosedBars({
        cursor: {
          state: safeJsonState(input.cursor.stateJson),
          barsProcessedCount: input.cursor.barsProcessedCount,
          lastProcessedBarTs: input.cursor.lastProcessedBarTs,
          lastProcessedBarCloseTs: input.cursor.lastProcessedBarCloseTs,
          lastProcessedBarFingerprint: input.cursor.lastProcessedBarFingerprint,
        },
        bars,
        machine: createStructureBreakRetestMachine(DETECTOR_OPTIONS),
        instrumentId: input.instrumentId,
        timeframe: TIMEFRAME,
        timeframeMs: TIMEFRAME_MS,
        processingOrigin: "LIVE_RECOVERY",
      });

      if (
        (recovered.status === "PROCESSED" || recovered.status === "NO_NEW_BARS") &&
        recovered.lastProcessedBarTs === input.latestLiveBar.t
      ) {
        return {
          result: recovered,
          revisionId: manifest.datasetId,
          revisionHash: manifest.provenance.normalizedSha256,
        };
      }
    } catch (error) {
      process.stderr.write("[AMI] Recovery candidate " + candidate.datasetId +
        " rejected: " + (error instanceof Error ? error.message : String(error)) + "\n");
    }
  }
  return null;
}

async function updateCursorHealth(
  cursorId: string,
  status: string,
  error: string | null,
  fetchedAt: number | null,
  tickTimestamp: number | null
): Promise<void> {
  await db.liveOpportunityCursor.update({
    where: { id: cursorId },
    data: {
      status,
      lastError: error,
      ...(fetchedAt !== null ? { lastSnapshotFetchedAt: fetchedAt } : {}),
      ...(tickTimestamp !== null ? { lastTickTimestamp: tickTimestamp } : {}),
      heartbeatAt: new Date(),
    },
  });
}

async function processSnapshot(input: {
  instrumentId: InstrumentId;
  priceSide: PriceSide;
  reseed: boolean;
}): Promise<void> {
  const cursorKey = buildCursorKey(input.instrumentId, input.priceSide);
  const initial = await ensureCursor(input.instrumentId, input.priceSide);
  const snapshotData = await getSnapshot(input.instrumentId, input.priceSide);
  const fetchedAt = snapshotData.fetchedAt ?? Date.now();

  if (snapshotData.health.state !== "FRESH") {
    await updateCursorHealth(
      initial.id,
      snapshotData.health.state,
      snapshotData.health.reason,
      fetchedAt,
      snapshotData.tickTimestamp
    );
    return;
  }

  let cursor = await db.liveOpportunityCursor.findUnique({ where: { cursorKey } });
  if (!cursor) throw new Error("Live opportunity cursor disappeared.");
  if (input.reseed) {
    const fresh = DETECTOR.createInitialState();
    cursor = await db.liveOpportunityCursor.update({
      where: { id: cursor.id },
      data: {
        stateJson: JSON.stringify(fresh),
        lastProcessedBarTs: null,
        lastProcessedBarCloseTs: null,
        lastProcessedBarFingerprint: null,
        barsProcessedCount: 0,
        generation: { increment: 1 },
        status: "NOT_STARTED",
        lastError: "Explicit --reseed reset requested; historical live events were retained.",
      },
    });
  }

  if (cursor.stateSchemaVersion !== 1 ||
      cursor.detectorVersion !== DETECTOR.detectorVersion ||
      cursor.paramsHash !== DETECTOR_PARAMS_HASH ||
      cursor.engineVersion !== ENGINE_VERSION) {
    await updateCursorHealth(
      cursor.id,
      "ERROR",
      "Persisted detector provenance does not match this worker version. Use an explicit new cursor/migration.",
      fetchedAt,
      snapshotData.tickTimestamp
    );
    return;
  }

  const existingState = safeJsonState(cursor.stateJson);
  const forwardCursor: ForwardCursor = {
    state: existingState,
    barsProcessedCount: cursor.barsProcessedCount,
    lastProcessedBarTs: cursor.lastProcessedBarTs,
    lastProcessedBarCloseTs: cursor.lastProcessedBarCloseTs,
    lastProcessedBarFingerprint: cursor.lastProcessedBarFingerprint,
  };
  const machine = createStructureBreakRetestMachine(DETECTOR_OPTIONS);
  const result = processForwardClosedBars({
    cursor: forwardCursor,
    bars: snapshotData.bars,
    machine,
    instrumentId: input.instrumentId,
    timeframe: TIMEFRAME,
    timeframeMs: TIMEFRAME_MS,
    maxBootstrapBars: 64,
  });

  let finalResult = result;
  let recoveryRevisionId: string | null = null;
  let recoveryRevisionHash: string | null = null;

  if (result.status === "GAP_UNRECONCILED" && snapshotData.bars.length > 0) {
    const latestLiveBar = snapshotData.bars[snapshotData.bars.length - 1];
    const recovered = await recoverFromVerifiedDataset({
      instrumentId: input.instrumentId,
      priceSide: input.priceSide,
      cursor,
      latestLiveBar,
    });
    if (recovered) {
      finalResult = recovered.result;
      recoveryRevisionId = recovered.revisionId;
      recoveryRevisionHash = recovered.revisionHash;
    }
  }

  if (finalResult.status === "GAP_UNRECONCILED" || finalResult.status === "INVALID_BAR") {
    await updateCursorHealth(
      cursor.id,
      finalResult.status,
      finalResult.reason,
      fetchedAt,
      snapshotData.tickTimestamp
    );
    return;
  }

  const rows = buildEventRows({
    cursorKey,
    instrumentId: input.instrumentId,
    priceSide: input.priceSide,
    events: finalResult.events,
    pollFetchedAt: fetchedAt,
    tickTimestamp: snapshotData.tickTimestamp,
    startSequence: cursor.lastEventSequence,
    generation: cursor.generation,
    sourceRevisionId: recoveryRevisionId,
    sourceRevisionHash: recoveryRevisionHash,
  });
  const status = finalResult.state.activeSetup ? "ACTIVE" :
    finalResult.status === "BOOTSTRAPPED" ? "BOOTSTRAPPED" :
    finalResult.status === "NO_BARS" ? "WAITING_FOR_CLOSED_BARS" : "RUNNING";

  await db.$transaction(async (tx) => {
    await tx.liveOpportunityCursor.update({
      where: { id: cursor!.id },
      data: {
        lastRecoveryRevisionId: recoveryRevisionId ?? cursor!.lastRecoveryRevisionId,
        lastRecoveryRevisionHash: recoveryRevisionHash ?? cursor!.lastRecoveryRevisionHash,
        stateJson: JSON.stringify(finalResult.state),
        barsProcessedCount: finalResult.barsProcessedCount,
        lastProcessedBarTs: finalResult.lastProcessedBarTs,
        lastProcessedBarCloseTs: finalResult.lastProcessedBarCloseTs,
        lastProcessedBarFingerprint: finalResult.lastProcessedBarFingerprint,
        ...(rows.length > 0 ? { lastEventSequence: rows[rows.length - 1].sequence } : {}),
        status,
        lastError: finalResult.reason,
        lastSnapshotFetchedAt: fetchedAt,
        lastTickTimestamp: snapshotData.tickTimestamp,
        heartbeatAt: new Date(),
        ...(rows.length > 0 ? { events: { create: rows } } : {}),
      },
    });
  });

  process.stdout.write(JSON.stringify({
    instrumentId: input.instrumentId,
    priceSide: input.priceSide,
    status,
    batchStatus: finalResult.status,
    processedBars: finalResult.processedBars,
    barsProcessedCount: finalResult.barsProcessedCount,
    emittedEvents: rows.length,
    latestClosedBarTs: finalResult.lastProcessedBarTs,
    recoveryRevisionId,
    providerTickTs: snapshotData.tickTimestamp,
    fetchedAt,
    ordersEnabled: false,
  }) + "\n");
}

async function printStatus(input: ParsedArgs): Promise<void> {
  const cursorKey = buildCursorKey(input.instrumentId, input.priceSide);
  const cursor = await db.liveOpportunityCursor.findUnique({
    where: { cursorKey },
    include: { events: { orderBy: { sequence: "desc" }, take: 10 } },
  });
  process.stdout.write(JSON.stringify(cursor ?? {
    status: "NOT_STARTED",
    instrumentId: input.instrumentId,
    priceSide: input.priceSide,
  }, null, 2) + "\n");
}

async function acquireWorkerLock(lockPath: string): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const lock = await open(lockPath, "wx");
      await lock.writeFile(String(process.pid) + "\n");
      await lock.close();
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }

    let currentContents: string;
    let fileStat: Awaited<ReturnType<typeof stat>>;
    try {
      [currentContents, fileStat] = await Promise.all([
        readFile(lockPath, "utf8"),
        stat(lockPath),
      ]);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }

    const existingPid = Number(currentContents.trim());
    if (!Number.isInteger(existingPid) || existingPid <= 0) {
      if (Date.now() - fileStat.mtimeMs < 30_000) {
        throw new Error("A worker lock is being initialized; refusing to remove a recent incomplete lock.");
      }
    } else {
      try {
        process.kill(existingPid, 0);
        throw new Error("Live opportunity worker already holds this lock (PID " + existingPid + ").");
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === "EPERM") {
          throw new Error("Live opportunity worker lock is owned by a process that cannot be inspected (PID " + existingPid + ").");
        }
        if (code !== "ESRCH") throw error;
      }
    }

    // Avoid deleting a lock replaced by another process between read and cleanup.
    const latest = await readFile(lockPath, "utf8").catch(() => null);
    if (latest === currentContents) {
      await rm(lockPath, { force: true });
    }
  }
  throw new Error("Could not acquire worker lock after stale-lock recovery.");
}

async function run(input: ParsedArgs): Promise<void> {
  const instrumentDirectory = resolve(process.cwd(), "data/market-data/.monitor");
  await mkdir(instrumentDirectory, { recursive: true });
  const lockPath = join(
    instrumentDirectory,
    "live-opportunity-" + input.instrumentId.toLowerCase() + "-" + input.priceSide + ".pid"
  );

  await acquireWorkerLock(lockPath);

  let stopping = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stop = () => {
    stopping = true;
    if (timer) clearTimeout(timer);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  process.stdout.write(JSON.stringify({
    message: "Starting closed-bar live opportunity worker.",
    instrumentId: input.instrumentId,
    priceSide: input.priceSide,
    timeframe: TIMEFRAME,
    detectorId: DETECTOR.detectorId,
    detectorVersion: DETECTOR.detectorVersion,
    pollSeconds: input.pollSeconds,
    reseed: input.reseed,
    ordersEnabled: false,
  }) + "\n");

  let reseedPending = input.reseed;
  try {
    do {
      try {
        await processSnapshot({ ...input, reseed: reseedPending });
        reseedPending = false;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const cursor = await db.liveOpportunityCursor.findUnique({
          where: { cursorKey: buildCursorKey(input.instrumentId, input.priceSide) },
        });
        if (cursor) {
          await updateCursorHealth(cursor.id, "ERROR", message, null, null);
        }
        process.stderr.write(JSON.stringify({
          instrumentId: input.instrumentId,
          priceSide: input.priceSide,
          state: "ERROR",
          error: message,
        }) + "\n");
      }

      if (input.once || stopping) break;
      await new Promise<void>((resolvePromise) => {
        timer = setTimeout(() => {
          timer = null;
          resolvePromise();
        }, input.pollSeconds * 1_000);
      });
    } while (!stopping);
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    try {
      await rm(lockPath, { force: true });
    } finally {
      await db.$disconnect();
    }
  }
}

async function main() {
  const input = parseArgs(Bun.argv.slice(2));
  if (input.action === "status") return printStatus(input);
  await run(input);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    process.stderr.write("AMI live opportunity worker failed: " +
      (error instanceof Error ? error.message : String(error)) + "\n");
    process.exitCode = 1;
  });
}
