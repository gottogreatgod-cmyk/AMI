import { NextResponse, type NextRequest } from "next/server";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { requireSession } from "@/lib/api";
import type { Bar } from "@/lib/engine/types";
import { classifyMonitorHealth, type MonitorTimeframe } from "@/lib/data/realtime-monitor";

export const dynamic = "force-dynamic";

const INSTRUMENTS = {
  "XAUUSD-DUKA": { file: "xauusd-duka.latest.json", providerInstrument: "xauusd" },
  "NAS100-DUKA": { file: "nas100-duka.latest.json", providerInstrument: "usatechidxusd" },
} as const;

type MonitorEnvelope = {
  schemaVersion?: number;
  instrumentId?: string;
  poller?: Record<string, unknown>;
  snapshot?: Record<string, unknown> | null;
};

function finiteNumber(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeLiveBar(value: unknown): (Bar & { forming: boolean }) | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const t = finiteNumber(row.t);
  const ct = finiteNumber(row.ct);
  const o = finiteNumber(row.o);
  const h = finiteNumber(row.h);
  const l = finiteNumber(row.l);
  const c = finiteNumber(row.c);
  const v = finiteNumber(row.v) ?? 0;
  if (
    t === null || ct === null || o === null || h === null || l === null || c === null ||
    t <= 0 || ct < t || o <= 0 || h <= 0 || l <= 0 || c <= 0 || v < 0 ||
    h < Math.max(o, c, l) || l > Math.min(o, c, h)
  ) return null;
  return {
    t, ct, o, h, l, c, v,
    forming: row.forming === true,
  };
}

function emptyResponse(instrumentId: string, priceSide: string, state: string, reason: string | null) {
  return {
    instrumentId,
    priceSide,
    timeframe: "m1",
    feedMode: "EXPERIMENTAL_POLLING",
    state,
    bars: [] as Array<Bar & { forming: boolean }>,
    tick: null,
    health: null,
    lastError: reason,
    ordersEnabled: false as const,
    fetchedAt: Date.now(),
  };
}

export async function GET(req: NextRequest) {
  const guard = await requireSession();
  if (!guard.ok) return guard.res;

  const params = req.nextUrl.searchParams;
  const instrumentId = params.get("instrumentId") ?? "";
  const priceSide = params.get("priceSide") ?? "";
  const instrument = INSTRUMENTS[instrumentId as keyof typeof INSTRUMENTS];
  if (!instrument) {
    return NextResponse.json({ error: "UNKNOWN_MONITOR_INSTRUMENT" }, { status: 400 });
  }
  if (priceSide !== "bid" && priceSide !== "ask") {
    return NextResponse.json({ error: "PRICE_SIDE_MUST_BE_BID_OR_ASK" }, { status: 400 });
  }

  try {
    const root = resolve(process.cwd(), "data/market-data/.monitor");
    const filePath = resolve(root, instrument.file);
    let raw: string;
    let fileStat: Awaited<ReturnType<typeof stat>>;
    try {
      [raw, fileStat] = await Promise.all([
        readFile(filePath, "utf8"),
        stat(filePath),
      ]);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return NextResponse.json(emptyResponse(instrumentId, priceSide, "NOT_STARTED", null));
      }
      throw error;
    }

    const envelope = JSON.parse(raw) as MonitorEnvelope;
    const snapshot = envelope.snapshot;
    const poller = envelope.poller ?? {};
    if (
      envelope.schemaVersion !== 1 ||
      envelope.instrumentId !== instrumentId ||
      !snapshot ||
      (snapshot.source as Record<string, unknown> | undefined)?.providerInstrument !== instrument.providerInstrument
    ) {
      return NextResponse.json(emptyResponse(instrumentId, priceSide, "INVALID_SNAPSHOT", null));
    }

    const source = snapshot.source as Record<string, unknown>;
    const timeframe = typeof source.timeframe === "string"
      ? source.timeframe as MonitorTimeframe
      : null;
    const tick = snapshot.tick as Record<string, unknown> | null;
    const health = classifyMonitorHealth({
      snapshotWrittenAt: fileStat.mtimeMs,
      snapshotFetchedAt: finiteNumber(snapshot.fetchedAt),
      tickTimestamp: finiteNumber(tick?.timestamp),
      timeframe,
      pollSeconds: finiteNumber(poller.intervalSeconds),
      lastError: typeof poller.lastError === "string" ? poller.lastError : null,
    });

    const side = snapshot[priceSide] as Record<string, unknown> | undefined;
    const bars = Array.isArray(side?.bars)
      ? side.bars.map(normalizeLiveBar).filter((bar): bar is Bar & { forming: boolean } => bar !== null)
      : [];
    const uniqueBars = new Map<number, Bar & { forming: boolean }>();
    for (const bar of bars) uniqueBars.set(bar.t, bar);
    const normalizedBars = [...uniqueBars.values()].sort((a, b) => a.t - b.t);

    return NextResponse.json({
      instrumentId,
      priceSide,
      timeframe: "m1",
      feedMode: "EXPERIMENTAL_POLLING",
      state: health.state,
      reason: health.reason,
      bars: normalizedBars,
      tick: tick ? {
        timestamp: finiteNumber(tick.timestamp),
        bid: finiteNumber(tick.bid),
        ask: finiteNumber(tick.ask),
        spread: finiteNumber(tick.spread),
        spreadBps: finiteNumber(tick.spreadBps),
      } : null,
      health,
      lastError: typeof poller.lastError === "string" ? poller.lastError : null,
      lastSuccessfulPollAt: finiteNumber(poller.lastSuccessAt),
      pollIntervalSeconds: finiteNumber(poller.intervalSeconds),
      marketSession: snapshot.marketSession ?? "UNKNOWN_NOT_CALENDAR_VERIFIED",
      ordersEnabled: false,
      fetchedAt: Date.now(),
      note: "Recent Dukascopy polling candles on the selected " + priceSide.toUpperCase() +
        " side only. Only merge into a chart using a matching immutable " + priceSide.toUpperCase() +
        " history revision. Stale/no-tick states are not treated as live. This is not WebSocket streaming.",
    });
  } catch (error) {
    return NextResponse.json({
      ...emptyResponse(instrumentId, priceSide, "ERROR", error instanceof Error ? error.message : String(error)),
      error: "LIVE_BAR_SNAPSHOT_READ_FAILED",
    }, { status: 500 });
  }
}
