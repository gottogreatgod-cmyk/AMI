import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { requireSession, serverError } from "@/lib/api";

export const dynamic = "force-dynamic";

const MONITORED_INSTRUMENTS = [
  { id: "XAUUSD-DUKA", file: "xauusd-duka.latest.json", providerInstrument: "xauusd" },
  { id: "NAS100-DUKA", file: "nas100-duka.latest.json", providerInstrument: "usatechidxusd" },
] as const;

export async function GET() {
  const guard = await requireSession();
  if (!guard.ok) return guard.res;

  try {
    const monitorRoot = resolve(process.cwd(), "data/market-data/.monitor");
    const results = await Promise.all(MONITORED_INSTRUMENTS.map(async (instrument) => {
      try {
        const raw = await readFile(resolve(monitorRoot, instrument.file), "utf8");
        const parsed = JSON.parse(raw) as {
          schemaVersion?: number;
          instrumentId?: string;
          poller?: Record<string, unknown>;
          snapshot?: Record<string, unknown> | null;
        };

        if (
          parsed.schemaVersion !== 1 ||
          parsed.instrumentId !== instrument.id ||
          !parsed.poller ||
          (parsed.snapshot && (
            (parsed.snapshot.source as Record<string, unknown> | undefined)?.providerInstrument !== instrument.providerInstrument
          ))
        ) {
          return {
            instrumentId: instrument.id,
            state: "INVALID_SNAPSHOT",
            poller: null,
            snapshot: null,
          };
        }

        return {
          instrumentId: instrument.id,
          state: typeof parsed.poller.state === "string" ? parsed.poller.state : "UNKNOWN",
          poller: parsed.poller,
          snapshot: parsed.snapshot ?? null,
        };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return {
            instrumentId: instrument.id,
            state: "NOT_STARTED",
            poller: null,
            snapshot: null,
          };
        }
        return {
          instrumentId: instrument.id,
          state: "INVALID_SNAPSHOT",
          poller: null,
          snapshot: null,
        };
      }
    }));

    return NextResponse.json({
      feedMode: "EXPERIMENTAL_POLLING",
      ordersEnabled: false,
      instruments: results,
      fetchedAt: Date.now(),
      note: "This endpoint reports local snapshots from the optional Dukascopy polling worker. It is not a persistent WebSocket or exchange-grade feed. NO_TICK may indicate a closed or quiet market.",
    });
  } catch (error) {
    return serverError(error);
  }
}
