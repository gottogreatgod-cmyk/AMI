"use client";

import { usePolling, fmtPct, fmtPrice, pnlClass, verdictColor } from "./hooks";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Activity, Gauge, Newspaper, TrendingUp } from "lucide-react";

interface SignalsResponse {
  symbol: string;
  states: Array<{
    symbol: string;
    tf: string;
    strategyKey: string;
    strategyName: string;
    bias: "long" | "short" | "flat" | null;
    htfState: string;
    lastPrice: number;
    atrPct: number;
    rsi: number | null;
    donchianUpper: number | null;
    donchianLower: number | null;
    asOfTs: number;
    note: string;
  }>;
  generatedAt: number;
}

interface LeaderboardResponse {
  leaderboard: Array<{
    id: string;
    strategyName: string;
    symbol: string;
    tf: string;
    score: number;
    grade: string;
    verdict: string;
    pf: number;
    trades: number;
  }>;
}

export function RightSidebar({
  focusSymbol,
  focusName,
  focusPrice,
  focusChangePct,
  focusSession,
  focusFresh,
}: {
  focusSymbol: string;
  focusName: string;
  focusPrice: number | null;
  focusChangePct: number | null;
  focusSession: string;
  focusFresh: boolean;
}) {
  const signals = usePolling<SignalsResponse>(`/api/signals?symbol=${encodeURIComponent(focusSymbol)}`, 60_000);
  const board = usePolling<LeaderboardResponse>("/api/leaderboard", 90_000);

  return (
    <aside className="panel flex flex-col min-h-0 overflow-hidden" aria-label="Metrics and risk">
      <div className="panel-head">
        <span>METRICS & RESEARCH</span>
        <span className="chip">{focusFresh ? "LIVE FEED" : "STALE"}</span>
      </div>
      <div className="flex-1 overflow-y-auto ami-scroll p-2.5 space-y-2.5 text-[11px]">
        {/* focused market */}
        <section className="rounded-lg border border-[#1e303d] bg-[#0d1720] p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-extrabold tracking-[0.08em] text-[#aebdca]">
              <Activity className="w-3 h-3 inline mr-1 -mt-0.5" />
              FOCUSED MARKET
            </span>
            <span className="chip">{focusSession}</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="font-bold text-[13px]">{focusSymbol}</span>
            <span className="text-[16px] font-bold tnum">{focusPrice != null ? fmtPrice(focusPrice, 2) : "—"}</span>
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-[9px] text-[#8193a3] truncate">{focusName}</span>
            <span className={cn("text-[11px] tnum", pnlClass(focusChangePct))}>{fmtPct(focusChangePct)}</span>
          </div>
        </section>

        {/* engine signals */}
        <section className="rounded-lg border border-[#1e303d] bg-[#0d1720] p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-extrabold tracking-[0.08em] text-[#aebdca]">
              <Gauge className="w-3 h-3 inline mr-1 -mt-0.5" />
              ENGINE SIGNALS · {focusSymbol}
            </span>
          </div>
          <div className="space-y-1.5">
            {signals.loading && !signals.data && <div className="text-[10px] text-[#687e90]">evaluating closed bars…</div>}
            {signals.data?.states.map((s) => (
              <div key={s.strategyKey} className="flex items-center justify-between gap-2 border-b border-[#1b2a35] pb-1.5 last:border-0 last:pb-0">
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold truncate" title={s.strategyName}>
                    {s.strategyName}
                  </div>
                  <div className="text-[9px] text-[#687e90]">
                    {s.tf} · ATR {s.atrPct.toFixed(2)}% · htf {s.htfState}
                  </div>
                </div>
                {s.bias ? (
                  <Badge
                    className={cn(
                      "text-[9px] shrink-0",
                      s.bias === "long"
                        ? "bg-[#123025] text-[#4bc39a] border-[#2b5c48]"
                        : "bg-[#301919] text-[#ef777d] border-[#5c2b31]"
                    )}
                  >
                    {s.bias.toUpperCase()}
                  </Badge>
                ) : (
                  <span className="text-[9px] text-[#687e90] shrink-0">flat</span>
                )}
              </div>
            ))}
            {signals.data && signals.data.states.length === 0 && (
              <div className="text-[10px] text-[#687e90]">
                No strategies yet — add the starter set in the Lab.
              </div>
            )}
          </div>
        </section>

        {/* leaderboard top */}
        <section className="rounded-lg border border-[#1e303d] bg-[#0d1720] p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-extrabold tracking-[0.08em] text-[#aebdca]">
              <TrendingUp className="w-3 h-3 inline mr-1 -mt-0.5" />
              TOP ROBUST RUNS
            </span>
            <span className="text-[9px] text-[#687e90]">score 0–100</span>
          </div>
          <div className="space-y-1">
            {board.data?.leaderboard.slice(0, 6).map((r, i) => (
              <div key={r.id} className="flex items-center justify-between gap-2 text-[10px]">
                <span className="text-[#687e90] w-4 shrink-0">{i + 1}</span>
                <span className="flex-1 truncate" title={`${r.strategyName} · ${r.symbol} ${r.tf}`}>
                  {r.strategyName.replace(/\s*\(.*\)/, "").slice(0, 22)} · {r.symbol} {r.tf}
                </span>
                <span className={cn("tnum font-bold", r.score >= 55 ? "text-[#4bc39a]" : r.score >= 40 ? "text-[#e7b86d]" : "text-[#8193a3]")}>
                  {r.score.toFixed(0)}
                </span>
              </div>
            ))}
            {board.loading && !board.data && <div className="text-[10px] text-[#687e90]">loading runs…</div>}
            {board.data && board.data.leaderboard.length === 0 && (
              <div className="text-[10px] text-[#687e90]">No stored runs yet — run the Lab.</div>
            )}
          </div>
        </section>

        {/* calendar quick view */}
        <section className="rounded-lg border border-[#1e303d] bg-[#0d1720] p-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-extrabold tracking-[0.08em] text-[#aebdca]">
              <Newspaper className="w-3 h-3 inline mr-1 -mt-0.5" />
              NEXT HIGH-IMPACT
            </span>
          </div>
          <NextHighImpact />
        </section>
      </div>
    </aside>
  );
}

interface CalendarResponse {
  events: Array<{ id: string; title: string; country: string; ts: number; impact: string; forecast: string; previous: string }>;
}

function NextHighImpact() {
  const cal = usePolling<CalendarResponse>("/api/calendar?tz=0", 300_000);
  const now = Date.now();
  const next = (cal.data?.events ?? [])
    .filter((e) => e.ts > now - 3_600_000)
    .sort((a, b) => a.ts - b.ts)
    .slice(0, 5);
  if (!cal.data) return <div className="text-[10px] text-[#687e90]">loading calendar…</div>;
  if (next.length === 0) return <div className="text-[10px] text-[#687e90]">no upcoming events in feed window</div>;
  return (
    <div className="space-y-1.5">
      {next.map((e) => {
        const hours = (e.ts - now) / 3_600_000;
        return (
          <div key={e.id} className="flex items-start justify-between gap-2 text-[10px]">
            <div className="min-w-0">
              <div className="truncate" title={e.title}>{e.title}</div>
              <div className="text-[9px] text-[#687e90]">
                {e.country} · {e.forecast ? `f ${e.forecast}` : "—"} · prev {e.previous || "—"}
              </div>
            </div>
            <span className={cn("text-[9px] shrink-0 tnum", e.impact === "High" ? "text-[#ef777d]" : e.impact === "Medium" ? "text-[#e7b86d]" : "text-[#687e90]")}>
              {hours < 1 ? `${Math.max(0, Math.round(hours * 60))}m` : `${hours.toFixed(1)}h`}
            </span>
          </div>
        );
      })}
    </div>
  );
}
