import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { requireSession, serverError } from "@/lib/api";
import {
  classifyMonitorHealth,
  type MonitorTimeframe,
} from "@/lib/data/realtime-monitor";
import { classifyLocalSupervisorHealth } from "@/lib/data/local-supervisor-health";

export const dynamic = "force-dynamic";

const MONITORED_INSTRUMENTS = [
  { id: "XAUUSD-DUKA", file: "xauusd-duka.latest.json", providerInstrument: "xauusd" },
  { id: "NAS100-DUKA", file: "nas100-duka.latest.json", providerInstrument: "usatechidxusd" },
] as const;

type MonitorEnvelope = {
  schemaVersion?: number;
  instrumentId?: string;
  poller?: Record<string, unknown>;
  snapshot?: Record<string, unknown> | null;
};

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function readSupervisorHealth(monitorRoot: string) {
  try {
    const raw = await readFile(resolve(monitorRoot, "local-supervisor.latest.json"), "utf8");
    return classifyLocalSupervisorHealth(JSON.parse(raw));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return classifyLocalSupervisorHealth(null);
    }
    return {
      ...classifyLocalSupervisorHealth(null),
      error: "Supervisor status could not be read or parsed.",
    };
  }
}

export async function GET() {
  const guard = await requireSession();
  if (!guard.ok) return guard.res;

  try {
    const monitorRoot = resolve(process.cwd(), "data/market-data/.monitor");
    const [supervisor, results] = await Promise.all([
      readSupervisorHealth(monitorRoot),
      Promise.all(MONITORED_INSTRUMENTS.map(async (instrument) => {
        const filePath = resolve(monitorRoot, instrument.file);
        try {
          const [raw, fileStat] = await Promise.all([
            readFile(filePath, "utf8"),
            stat(filePath),
          ]);
          const parsed = JSON.parse(raw) as MonitorEnvelope;
          const snapshot = parsed.snapshot ?? null;
          const source = snapshot?.source as Record<string, unknown> | undefined;
          const tick = snapshot?.tick as Record<string, unknown> | null | undefined;

          if (
            parsed.schemaVersion !== 1 ||
            parsed.instrumentId !== instrument.id ||
            !parsed.poller ||
            (snapshot && source?.providerInstrument !== instrument.providerInstrument)
          ) {
            return {
              instrumentId: instrument.id,
              state: "INVALID_SNAPSHOT",
              poller: null,
              snapshot: null,
              health: null,
            };
          }

          const now = Date.now();
          const poller = parsed.poller;
          const timeframe = typeof source?.timeframe === "string"
            ? source.timeframe as MonitorTimeframe
            : null;
          const health = classifyMonitorHealth({
            snapshotWrittenAt: fileStat.mtimeMs,
            snapshotFetchedAt: finiteNumber(snapshot?.fetchedAt),
            tickTimestamp: finiteNumber(tick?.timestamp),
            timeframe,
            pollSeconds: finiteNumber(poller.intervalSeconds),
            lastError: typeof poller.lastError === "string" ? poller.lastError : null,
            now,
          });

          return {
            instrumentId: instrument.id,
            state: health.state,
            poller: {
              ...poller,
              persistedState: typeof poller.state === "string" ? poller.state : "UNKNOWN",
            },
            snapshot,
            health,
          };
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") {
            return {
              instrumentId: instrument.id,
              state: "NOT_STARTED",
              poller: null,
              snapshot: null,
              health: null,
            };
          }
          return {
            instrumentId: instrument.id,
            state: "INVALID_SNAPSHOT",
            poller: null,
            snapshot: null,
            health: null,
          };
        }
      })),
    ]);

    return NextResponse.json({
      feedMode: "EXPERIMENTAL_POLLING",
      ordersEnabled: false,
      supervisor,
      instruments: results,
      fetchedAt: Date.now(),
      note: "Local Dukascopy polling snapshots only. Supervisor heartbeat, snapshot write age and provider tick time are evaluated independently. NO_TICK may indicate a closed or quiet market because session calendars are not verified. This is not a persistent WebSocket or exchange-grade feed.",
    });
  } catch (error) {
    return serverError(error);
  }
}
