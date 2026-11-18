"use client";

import { useEffect, useState } from "react";

type LiveEvent = {
  id: string;
  sequence: number;
  setupId: string;
  eventKey: string;
  type: string;
  direction: "long" | "short" | null;
  priceSide: "bid" | "ask";
  occurredAtTs: number;
  discoveredAtTs: number;
  reason: string;
  evidence: Array<{ code: string; value?: string | number | boolean | null; sourceBarTs: number }>;
  origin: "LIVE_MONITOR" | "LIVE_BOOTSTRAP";
  recordedAt: string;
};

type LiveCursor = {
  id?: string;
  instrumentId: string;
  priceSide: "bid" | "ask";
  timeframe: "m1";
  status: string;
  lastError?: string | null;
  barsProcessedCount?: number;
  lastProcessedBarCloseTs?: number | null;
  heartbeatAgeMs?: number | null;
  snapshotAgeMs?: number | null;
  tickAgeMs?: number | null;
  detectorState?: {
    activeSetup?: {
      setupKey: string;
      direction: "long" | "short";
      structureKind: "BOS" | "CHoCH";
      breakLevel: number;
      phase: "FORMING" | "ARMED";
      invalidationReference: number | null;
      retestHigh: number | null;
      retestLow: number | null;
    } | null;
  } | null;
  events: LiveEvent[];
};

type LiveApiResponse = {
  feedMode: string;
  ordersEnabled: false;
  cursors: LiveCursor[];
  fetchedAt: number;
  note: string;
};

function stamp(ts: number | null | undefined): string {
  if (ts == null || !Number.isFinite(ts)) return "—";
  return new Date(ts).toISOString().slice(11, 19) + " UTC";
}

function age(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "—";
  return Math.max(0, Math.floor(seconds / 1000)) + "s";
}

function price(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "—" : value.toFixed(2);
}

function statusClass(status: string): string {
  if (status === "ACTIVE" || status === "RUNNING") return "text-[#4bc39a]";
  if (status === "BOOTSTRAPPED") return "text-[#d5a85c]";
  if (status === "GAP_UNRECONCILED" || status === "ERROR" || status === "STALE") return "text-[#ef777d]";
  if (status === "NO_TICK" || status === "NOT_STARTED" || status === "WAITING_FOR_CLOSED_BARS") return "text-[#d5a85c]";
  return "text-[#9bb4c9]";
}

function invalidation(setup: NonNullable<NonNullable<LiveCursor["detectorState"]>["activeSetup"]>): number | null {
  if (setup.phase === "ARMED") {
    return setup.direction === "long" ? setup.retestLow : setup.retestHigh;
  }
  return setup.invalidationReference;
}

export function LiveOpportunityPanel() {
  const [data, setData] = useState<LiveApiResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let interval: ReturnType<typeof setInterval> | null = null;
    const refresh = async () => {
      try {
        const response = await fetch("/api/opportunities/live", { cache: "no-store" });
        const body = await response.json() as LiveApiResponse & { error?: string };
        if (!response.ok) throw new Error(body.error ?? "Unable to read live opportunity state.");
        if (active) {
          setData(body);
          setError(null);
          setLoading(false);
        }
      } catch (cause) {
        if (active) {
          setError(cause instanceof Error ? cause.message : String(cause));
          setLoading(false);
        }
      }
    };
    void refresh();
    interval = setInterval(() => { void refresh(); }, 10_000);
    return () => {
      active = false;
      if (interval) clearInterval(interval);
    };
  }, []);

  const cursors = data?.cursors ?? [];
  const activeCount = cursors.filter((cursor) =>
    cursor.detectorState?.activeSetup != null
  ).length;
  const latestEvents = cursors.flatMap((cursor) =>
    cursor.events.map((event) => ({ ...event, instrumentId: cursor.instrumentId }))
  ).sort((a, b) => b.discoveredAtTs - a.discoveredAtTs).slice(0, 8);

  return (
    <section className="panel mb-2" aria-label="Forward live opportunities">
      <div className="panel-head flex-wrap gap-2">
        <div>LIVE OPPORTUNITY MONITOR · M1 CLOSED-BAR</div>
        <div className="flex gap-2 text-[9px]">
          <span className="text-[#8193a3]">{loading ? "CONNECTING…" : error ? "API ERROR" : activeCount + " ACTIVE SETUPS"}</span>
          <span className="text-[#d5a85c]">EXPERIMENTAL POLLING</span>
          <span className="text-[#ef777d]">NO ORDERS</span>
        </div>
      </div>
      {error && <p className="px-2 py-2 text-[10px] text-[#ef777d]">{error}</p>}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-1.5 p-2">
        {cursors.map((cursor) => {
          const setup = cursor.detectorState?.activeSetup ?? null;
          return (
            <article key={cursor.instrumentId + ":" + cursor.priceSide} className="rounded border border-[#203444] bg-[#0b151f] p-2 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[9px] font-semibold text-[#dce7f0]">{cursor.instrumentId} · {cursor.priceSide.toUpperCase()}</span>
                <span className={"text-[9px] font-bold " + statusClass(cursor.status)}>{cursor.status}</span>
              </div>
              {setup ? (
                <div className="mt-2 space-y-1 text-[9px]">
                  <div className="font-semibold text-[#dce7f0]">
                    {setup.direction.toUpperCase()} · {setup.structureKind} · {setup.phase}
                  </div>
                  <div className="flex justify-between text-[#9eb2c3]">
                    <span>Break level</span><span className="tnum">{price(setup.breakLevel)}</span>
                  </div>
                  <div className="flex justify-between text-[#9eb2c3]">
                    <span>Invalidation</span><span className="tnum">{price(invalidation(setup))}</span>
                  </div>
                  <div className="text-[8px] text-[#748999]">Setup remains provisional until the next closed-bar transition.</div>
                </div>
              ) : (
                <div className="mt-2 text-[9px] text-[#748999]">No active setup in the persisted detector state.</div>
              )}
              <div className="mt-2 border-t border-[#1d2c38] pt-1.5 space-y-0.5 text-[8px] text-[#748999]">
                <div className="flex justify-between"><span>Last closed bar</span><span>{stamp(cursor.lastProcessedBarCloseTs)}</span></div>
                <div className="flex justify-between"><span>Provider tick age</span><span>{age(cursor.tickAgeMs)}</span></div>
                <div className="flex justify-between"><span>Worker heartbeat age</span><span>{age(cursor.heartbeatAgeMs)}</span></div>
                <div className="flex justify-between"><span>Bars processed</span><span>{cursor.barsProcessedCount ?? 0}</span></div>
              </div>
              {cursor.lastError && <p className="mt-1 text-[8px] text-[#ef777d] break-words">{cursor.lastError}</p>}
            </article>
          );
        })}
        {cursors.length === 0 && (
          <div className="p-3 text-[10px] text-[#8193a3]">No live opportunity cursors are registered yet. Start the local station and wait for fresh M1 poll snapshots.</div>
        )}
      </div>
      <div className="px-2 pb-2">
        <div className="mb-1 text-[8px] tracking-wide text-[#748999]">RECENT EVENT LOG · LIVE_MONITOR IS FORWARD-OBSERVED · LIVE_BOOTSTRAP IS RECONSTRUCTED CONTEXT</div>
        {latestEvents.length === 0 ? (
          <p className="text-[9px] text-[#748999]">No lifecycle events recorded yet. A quiet/closed market or no qualifying setup can legitimately produce no events.</p>
        ) : (
          <div className="space-y-1">
            {latestEvents.map((event) => (
              <div key={event.id} className="grid grid-cols-[70px_70px_95px_minmax(0,1fr)] gap-2 items-start rounded bg-[#09121a] px-2 py-1 text-[8px]">
                <span className="text-[#8193a3]">{stamp(event.discoveredAtTs)}</span>
                <span className="font-bold text-[#9eb2c3]">{event.instrumentId.replace("-DUKA", "")}</span>
                <span className={event.origin === "LIVE_MONITOR" ? "text-[#4bc39a]" : "text-[#d5a85c]"}>{event.origin}</span>
                <span className="min-w-0 text-[#c7d4de]">{event.type} · {event.reason}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="px-2 pb-2 text-[8px] leading-relaxed text-[#687e90]">
        A fresh quote does not guarantee a new closed candle. LIVE_BOOTSTRAP is never counted as an alert delivered at the event's historical market time. GAP_UNRECONCILED halts processing rather than skipping missing data. Feed polling and detector processing are separate workers.
      </div>
    </section>
  );
}
