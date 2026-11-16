"use client";

import { useState } from "react";
import { usePolling, fmtTime, verdictColor } from "./hooks";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp } from "lucide-react";

type DockTab = "signals" | "runs" | "events" | "system";

interface SignalsResponse {
  symbol: string;
  states: Array<{
    strategyKey: string;
    strategyName: string;
    tf: string;
    bias: string | null;
    htfState: string;
    atrPct: number;
    rsi: number | null;
    donchianUpper: number | null;
    donchianLower: number | null;
    asOfTs: number;
  }>;
}

interface RunsResponse {
  runs: Array<{
    id: string;
    symbol: string;
    tf: string;
    strategyName: string;
    status: string;
    trades?: number;
    profitFactor?: number;
    netReturnPct?: number;
    verdict?: string;
    robustnessScore?: number;
    createdAt: string;
  }>;
}

interface CalendarResponse {
  events: Array<{ id: string; title: string; country: string; ts: number; impact: string; forecast: string; previous: string }>;
}

interface HealthResponse {
  engineVersion: string;
  db: string;
  providers: Record<string, { requests?: number; retries?: number; lastError?: string | null }>;
  cache: { entries: number; maxEntries: number };
  time: string;
}

export function BottomDock({
  focusSymbol,
  onOpenRun,
}: {
  focusSymbol: string;
  onOpenRun: (runId: string) => void;
}) {
  const [tab, setTab] = useState<DockTab>("signals");
  const [collapsed, setCollapsed] = useState(false);

  const signals = usePolling<SignalsResponse>(`/api/signals?symbol=${encodeURIComponent(focusSymbol)}`, 60_000);
  const runs = usePolling<RunsResponse>("/api/runs?limit=25", 30_000);
  const cal = usePolling<CalendarResponse>("/api/calendar", 300_000);
  const health = usePolling<HealthResponse>("/api/health", 30_000);

  return (
    <section className="panel flex flex-col min-h-0 shrink-0" style={{ height: collapsed ? 38 : 236 }} aria-label="Event dock">
      <div className="panel-head">
        <div className="flex items-center gap-1">
          {(["signals", "runs", "events", "system"] as DockTab[]).map((t) => (
            <Button
              key={t}
              size="sm"
              variant="ghost"
              onClick={() => {
                setTab(t);
                setCollapsed(false);
              }}
              className={cn(
                "h-6 px-2.5 text-[10px] tracking-wide uppercase",
                tab === t && !collapsed ? "bg-[#203244] text-[#e5edf4]" : "text-[#8193a3]"
              )}
              aria-pressed={tab === t}
            >
              {t}
            </Button>
          ))}
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setCollapsed((c) => !c)}
          className="h-6 w-7 p-0 text-[#8193a3]"
          aria-label={collapsed ? "Expand dock" : "Collapse dock"}
        >
          {collapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </Button>
      </div>
      {!collapsed && (
        <div className="flex-1 overflow-y-auto ami-scroll px-3 py-1.5">
          {tab === "signals" && (
            <SignalsTable data={signals.data} loading={signals.loading} focusSymbol={focusSymbol} />
          )}
          {tab === "runs" && <RunsTable data={runs.data} loading={runs.loading} onOpen={onOpenRun} />}
          {tab === "events" && <EventsTable data={cal.data} loading={cal.loading} />}
          {tab === "system" && <SystemTable data={health.data} loading={health.loading} />}
        </div>
      )}
    </section>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={cn("text-left font-semibold text-[#687e90] px-2 py-1 whitespace-nowrap", className)}>{children}</th>;
}
function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn("px-2 py-1 whitespace-nowrap tnum", className)}>{children}</td>;
}

function SignalsTable({ data, loading, focusSymbol }: { data: SignalsResponse | null; loading: boolean; focusSymbol: string }) {
  if (loading && !data) return <div className="text-[10px] text-[#687e90]">evaluating…</div>;
  if (!data || data.states.length === 0)
    return (
      <div className="text-[10px] text-[#687e90]">
        No strategies yet — open the LAB tab and add the starter set.
      </div>
    );
  return (
    <table className="w-full text-[10px]">
      <thead className="sticky top-0 bg-[#0e1720]">
        <tr className="border-b border-[#1f303d]">
          <Th>strategy</Th>
          <Th>sym</Th>
          <Th>tf</Th>
          <Th>bias</Th>
          <Th>htf gate</Th>
          <Th>atr%</Th>
          <Th>rsi</Th>
          <Th>dc upper</Th>
          <Th>dc lower</Th>
          <Th>as of</Th>
        </tr>
      </thead>
      <tbody>
        {data.states.map((s) => (
          <tr key={s.strategyKey} className="border-b border-[#141f2a] hover:bg-[#0f1a26]">
            <Td className="max-w-[240px] truncate font-semibold">{s.strategyName}</Td>
            <Td>{focusSymbol}</Td>
            <Td>{s.tf}</Td>
            <Td>
              {s.bias ? (
                <span className={s.bias === "long" ? "text-[#4bc39a]" : "text-[#ef777d]"}>{s.bias.toUpperCase()}</span>
              ) : (
                <span className="text-[#687e90]">flat</span>
              )}
            </Td>
            <Td className="text-[#8193a3]">{s.htfState}</Td>
            <Td>{s.atrPct.toFixed(2)}</Td>
            <Td>{s.rsi != null ? s.rsi.toFixed(1) : "—"}</Td>
            <Td>{s.donchianUpper != null ? s.donchianUpper.toFixed(2) : "—"}</Td>
            <Td>{s.donchianLower != null ? s.donchianLower.toFixed(2) : "—"}</Td>
            <Td className="text-[#687e90]">{fmtTime(s.asOfTs)}</Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RunsTable({ data, loading, onOpen }: { data: RunsResponse | null; loading: boolean; onOpen: (id: string) => void }) {
  if (loading && !data) return <div className="text-[10px] text-[#687e90]">loading runs…</div>;
  if (!data || data.runs.length === 0)
    return <div className="text-[10px] text-[#687e90]">No runs yet — the Lab runs backtests and stores every result, including the losers.</div>;
  return (
    <table className="w-full text-[10px]">
      <thead className="sticky top-0 bg-[#0e1720]">
        <tr className="border-b border-[#1f303d]">
          <Th>when</Th>
          <Th>strategy</Th>
          <Th>sym</Th>
          <Th>tf</Th>
          <Th>trades</Th>
          <Th>PF</Th>
          <Th>net</Th>
          <Th>score</Th>
          <Th>verdict</Th>
          <Th>{""}</Th>
        </tr>
      </thead>
      <tbody>
        {data.runs.map((r) => (
          <tr key={r.id} className="border-b border-[#141f2a] hover:bg-[#0f1a26]">
            <Td className="text-[#687e90]">{fmtTime(r.createdAt)}</Td>
            <Td className="max-w-[220px] truncate font-semibold">{r.strategyName}</Td>
            <Td>{r.symbol}</Td>
            <Td>{r.tf}</Td>
            <Td>{r.trades ?? "—"}</Td>
            <Td>{r.profitFactor != null ? (r.profitFactor >= 99 ? "∞" : r.profitFactor.toFixed(2)) : "—"}</Td>
            <Td
              className={
                r.netReturnPct == null
                  ? "text-[#687e90]"
                  : r.netReturnPct > 0
                    ? "text-[#4bc39a]"
                    : r.netReturnPct < 0
                      ? "text-[#ef777d]"
                      : ""
              }
            >
              {r.netReturnPct != null ? `${r.netReturnPct.toFixed(1)}%` : "error"}
            </Td>
            <Td
              className={cn(
                "font-bold",
                (r.robustnessScore ?? 0) >= 55
                  ? "text-[#4bc39a]"
                  : (r.robustnessScore ?? 0) >= 40
                    ? "text-[#e7b86d]"
                    : "text-[#8193a3]"
              )}
            >
              {r.robustnessScore != null ? r.robustnessScore.toFixed(0) : "—"}
            </Td>
            <Td>
              <span className={cn("px-1.5 py-0.5 rounded border text-[9px]", verdictColor(r.verdict ?? r.status))}>
                {r.verdict ?? r.status}
              </span>
            </Td>
            <Td>
              <Button size="sm" variant="ghost" className="h-5 px-1.5 text-[9px] text-[#73a8e8]" onClick={() => onOpen(r.id)}>
                open
              </Button>
            </Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function EventsTable({ data, loading }: { data: CalendarResponse | null; loading: boolean }) {
  if (loading && !data) return <div className="text-[10px] text-[#687e90]">loading calendar…</div>;
  const now = Date.now();
  const events = (data?.events ?? []).filter((e) => e.ts > now - 3_600_000).slice(0, 40);
  if (events.length === 0) return <div className="text-[10px] text-[#687e90]">No upcoming events in the feed window.</div>;
  return (
    <table className="w-full text-[10px]">
      <thead className="sticky top-0 bg-[#0e1720]">
        <tr className="border-b border-[#1f303d]">
          <Th>time</Th>
          <Th>ccy</Th>
          <Th>impact</Th>
          <Th>event</Th>
          <Th>forecast</Th>
          <Th>previous</Th>
        </tr>
      </thead>
      <tbody>
        {events.map((e) => (
          <tr key={e.id} className="border-b border-[#141f2a] hover:bg-[#0f1a26]">
            <Td className="text-[#687e90]">{fmtTime(e.ts)}</Td>
            <Td className="font-semibold">{e.country}</Td>
            <Td>
              <span
                className={cn(
                  e.impact === "High" ? "text-[#ef777d]" : e.impact === "Medium" ? "text-[#e7b86d]" : "text-[#687e90]"
                )}
              >
                {e.impact}
              </span>
            </Td>
            <Td className="max-w-[380px] truncate">{e.title}</Td>
            <Td>{e.forecast || "—"}</Td>
            <Td className="text-[#8193a3]">{e.previous || "—"}</Td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SystemTable({ data, loading }: { data: HealthResponse | null; loading: boolean }) {
  if (loading && !data) return <div className="text-[10px] text-[#687e90]">checking system…</div>;
  if (!data) return <div className="text-[10px] text-[#687e90]">health unavailable</div>;
  const p = data.providers ?? {};
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[10px]">
      <div className="border border-[#1e303d] rounded-lg p-2.5 bg-[#0d1720]">
        <div className="text-[#687e90] text-[9px] mb-1">ENGINE</div>
        <div className="font-bold">{data.engineVersion}</div>
        <div className={data.db === "OK" ? "text-[#4bc39a]" : "text-[#ef777d]"}>DB {data.db}</div>
      </div>
      {Object.entries(p).map(([name, st]) => (
        <div key={name} className="border border-[#1e303d] rounded-lg p-2.5 bg-[#0d1720]">
          <div className="text-[#687e90] text-[9px] mb-1">{name.toUpperCase()} FEED</div>
          <div>requests {st.requests ?? 0}</div>
          <div>retries {st.retries ?? 0}</div>
          <div className={st.lastError ? "text-[#ef777d] truncate" : "text-[#4bc39a]"}>{st.lastError ? st.lastError : "healthy"}</div>
        </div>
      ))}
      <div className="border border-[#1e303d] rounded-lg p-2.5 bg-[#0d1720]">
        <div className="text-[#687e90] text-[9px] mb-1">CACHE</div>
        <div>{data.cache.entries} / {data.cache.maxEntries} entries</div>
        <div className="text-[#687e90]">local memory, TTL by age</div>
      </div>
      <div className="border border-[#1e303d] rounded-lg p-2.5 bg-[#0d1720]">
        <div className="text-[#687e90] text-[9px] mb-1">POLICY</div>
        <div className="text-[#e7b86d]">PAPER ONLY</div>
        <div className="text-[#687e90]">no broker · no live orders</div>
      </div>
    </div>
  );
}
