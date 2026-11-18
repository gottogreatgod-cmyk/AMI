#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { db } from "../../src/lib/db";
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
    origin: "LIVE_BOOTSTRAP" | "LIVE_MONITOR";
  }>;
  pollFetchedAt: number;
  tickTimestamp: number | null;
  startSequence: number;
  generation: number;
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

async function persistCursorAndEvents(input: {
  cursorId: string;
  result: ReturnType<typeof processForwardClosedBars<StructureBreakRetestState>>;
  rows: ReturnType<typeof buildEventRows>;
  fetchedAt: number;
  tickTimestamp: number | null;
  status: string;
  lastError: string | null;
}): Promise<void> {
  const latestEventSequence = input.rows.length > 0
    ? input.rows[input.rows.length - 1].sequence
    : undefined;
  await db.$transaction(async (tx) => {
    await tx.liveOpportunityCursor.update({
      where: { id: input.cursorId },
      data: {
        stateJson: JSON.stringify(input.result.state),
        barsProcessedCount: input.result.barsProcessedCount,
        lastProcessedBarTs: input.result.lastProcessedBarTs,
        lastProcessedBarCloseTs: input.result.lastProcessedBarCloseTs,
        lastProcessedBarFingerprint: input.result.lastProcessedBarFingerprint,
        ...(latestEventSequence !== undefined ? { lastEventSequence: latestEventSequence } : {}),
        status: input.status,
        lastError: input.lastError,
        lastSnapshotFetchedAt: input.fetchedAt,
        lastTickTimestamp: input.tickTimestamp,
        heartbeatAt: new Date(),
        ...(input.rows.length > 0
          ? { events: { create: input.rows } }
          : {}),
      },
    });
  });
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
  } else if (cursor.status === "GAP_UNRECONCILED") {
    await updateCursorHealth(
      cursor.id,
      "GAP_UNRECONCILED",
      cursor.lastError ?? "Manual reseed/reconciliation required.",
      fetchedAt,
      snapshotData.tickTimestamp
    );
    return;
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
    maxBootstrapBars: 8,
  });

  if (result.status === "GAP_UNRECONCILED" || result.status === "INVALID_BAR") {
    await updateCursorHealth(
      cursor.id,
      result.status,
      result.reason,
      fetchedAt,
      snapshotData.tickTimestamp
    );
    return;
  }

  const rows = buildEventRows({
    cursorKey,
    instrumentId: input.instrumentId,
    priceSide: input.priceSide,
    events: result.events,
    pollFetchedAt: fetchedAt,
    tickTimestamp: snapshotData.tickTimestamp,
    startSequence: cursor.lastEventSequence,
    generation: cursor.generation,
  });
  const status = result.state.activeSetup ? "ACTIVE" :
    result.status === "BOOTSTRAPPED" ? "BOOTSTRAPPED" :
    result.status === "NO_BARS" ? "WAITING_FOR_CLOSED_BARS" : "RUNNING";

  await persistCursorAndEvents({
    cursorId: cursor.id,
    result,
    rows,
    fetchedAt,
    tickTimestamp: snapshotData.tickTimestamp,
    status,
    lastError: result.reason,
  });

  process.stdout.write(JSON.stringify({
    instrumentId: input.instrumentId,
    priceSide: input.priceSide,
    status,
    batchStatus: result.status,
    processedBars: result.processedBars,
    barsProcessedCount: result.barsProcessedCount,
    emittedEvents: rows.length,
    latestClosedBarTs: result.lastProcessedBarTs,
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

async function run(input: ParsedArgs): Promise<void> {
  const instrumentDirectory = resolve(process.cwd(), "data/market-data/.monitor");
  await mkdir(instrumentDirectory, { recursive: true });
  const lockPath = join(
    instrumentDirectory,
    "live-opportunity-" + input.instrumentId.toLowerCase() + "-" + input.priceSide + ".pid"
  );

  let lock;
  try {
    lock = await open(lockPath, "wx");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error("A live opportunity worker already holds the lock for this instrument and quote side.");
    }
    throw error;
  }
  await lock.writeFile(String(process.pid) + "\n");
  await lock.close();

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
