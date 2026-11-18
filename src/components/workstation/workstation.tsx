"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Topbar, type FeedHealth } from "./topbar";
import { Watchlist, type MarketRow } from "./watchlist";
import { DeskPanel, type ChartSlot } from "./desk-panel";
import { RightSidebar } from "./right-sidebar";
import { BottomDock } from "./bottom-dock";
import { LabPanel } from "./lab-panel";
import { AnalystPanel } from "./analyst-panel";
import { DayReviewPanel } from "./day-review-panel";
import { usePolling } from "./hooks";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from "@/components/ui/sheet";
import { CandlestickChart, FlaskConical, Radio, List, History } from "lucide-react";

export type WorkstationTab = "desk" | "review" | "lab" | "analyst";

interface MarketsResponse {
  markets: MarketRow[];
  fetchedAt: number;
}

const DEFAULT_SLOTS: ChartSlot[] = [
  { symbol: "BTCUSDT", tf: "4h" },
  { symbol: "NQ=F", tf: "1d" },
  { symbol: "PAXGUSDT", tf: "1d" },
  { symbol: "EURUSD=X", tf: "1h" },
];

const LS_KEY = "ami-workstation-v1";

interface Persisted {
  tab?: WorkstationTab;
  focusSymbol?: string;
  slots?: ChartSlot[];
}

export function Workstation({ sessionEmail }: { sessionEmail: string | null }) {
  const [tab, setTab] = useState<WorkstationTab>("desk");
  const [focusSymbol, setFocusSymbol] = useState("BTCUSDT");
  const [slots, setSlots] = useState<ChartSlot[]>(DEFAULT_SLOTS);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [mobileWatchlist, setMobileWatchlist] = useState(false);
  const [refreshBust, setRefreshBust] = useState(0);

  useEffect(() => {
    // Restore persisted layout after the mount commit (avoids SSR hydration
    // mismatch); deferred to a macrotask so effect body stays render-pure.
    const t = setTimeout(() => {
      try {
        const raw = localStorage.getItem(LS_KEY);
        if (raw) {
          const p = JSON.parse(raw) as Persisted;
          if (p.tab) setTab(p.tab);
          if (p.focusSymbol) setFocusSymbol(p.focusSymbol);
          if (p.slots?.length) setSlots(p.slots);
        }
      } catch {
        /* fresh start */
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ tab, focusSymbol, slots }));
    } catch {
      /* storage unavailable */
    }
  }, [tab, focusSymbol, slots]);

  const markets = usePolling<MarketsResponse>("/api/markets", 30_000, refreshBust);
  const health = usePolling<FeedHealth>("/api/health", 30_000, refreshBust);

  const marketRows = useMemo(() => markets.data?.markets ?? [], [markets.data]);
  const symbolOptions = useMemo(
    () => marketRows.map((m) => ({ symbol: m.symbol, name: m.name, decimals: m.decimals })),
    [marketRows]
  );
  const focused = marketRows.find((m) => m.symbol === focusSymbol);

  const onFocus = useCallback((symbol: string) => {
    setFocusSymbol(symbol);
    setMobileWatchlist(false);
  }, []);

  const openRun = useCallback((runId: string) => {
    setSelectedRunId(runId);
    setTab("lab");
  }, []);

  const refreshAll = useCallback(() => {
    setRefreshBust((n) => n + 1);
  }, []);

  const tabs: Array<{ id: WorkstationTab; label: string; icon: React.ReactNode }> = [
    { id: "desk", label: "DESK", icon: <CandlestickChart className="w-3.5 h-3.5" /> },
    { id: "review", label: "DAY REVIEW", icon: <History className="w-3.5 h-3.5" /> },
    { id: "lab", label: "LAB", icon: <FlaskConical className="w-3.5 h-3.5" /> },
    { id: "analyst", label: "ANALYST", icon: <Radio className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="min-h-screen flex flex-col gap-2 p-2 sm:p-2.5 max-w-[2400px] mx-auto bg-[#080d13]">
      <Topbar
        sessionEmail={sessionEmail}
        health={health.data}
        healthLoading={health.loading}
        onRefresh={refreshAll}
        online={!markets.error}
      />

      {/* toolbar */}
      <div className="panel h-[42px] flex items-center justify-between px-2 gap-2 shrink-0">
        <div className="flex items-center gap-1 min-w-0">
          <Sheet open={mobileWatchlist} onOpenChange={setMobileWatchlist}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px] text-[#8193a3] md:hidden">
                <List className="w-3.5 h-3.5" />
                <span className="ml-1">Markets</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[260px] bg-[#0d1520] border-[#1f303d] p-0">
              <SheetTitle className="sr-only">Market watch</SheetTitle>
              <div className="h-full pt-8">
                <Watchlist
                  markets={marketRows}
                  focusSymbol={focusSymbol}
                  onFocus={onFocus}
                  loading={markets.loading}
                />
              </div>
            </SheetContent>
          </Sheet>
          {tabs.map((t) => (
            <Button
              key={t.id}
              size="sm"
              variant="ghost"
              onClick={() => setTab(t.id)}
              className={cn(
                "h-7 px-3 text-[11px] tracking-wide gap-1.5",
                tab === t.id ? "bg-[#203244] text-[#e5f0fb] border border-[#34506a]" : "text-[#a8b7c4]"
              )}
              aria-pressed={tab === t.id}
            >
              {t.icon}
              {t.label}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="chip hidden sm:inline-block">
            FOCUS · {focusSymbol} {focused?.price != null ? focused.price.toFixed(Math.min(focused.decimals, 2)) : ""}
          </span>
          <span className="chip hidden md:inline-block">
            {marketRows.length} MARKETS · 8 TIMEFRAMES
          </span>
          <span className="chip lg:hidden">{tab.toUpperCase()}</span>
        </div>
      </div>

      {/* main region */}
      <div className="flex-1 min-h-0 grid gap-2 grid-cols-1 lg:grid-cols-[218px_minmax(0,1fr)] xl:grid-cols-[218px_minmax(0,1fr)_300px]">
        <div className="hidden lg:flex min-h-0">
          <Watchlist
            markets={marketRows}
            focusSymbol={focusSymbol}
            onFocus={onFocus}
            loading={markets.loading}
          />
        </div>
        <div className="min-h-0 flex flex-col">
          {tab === "desk" && (
            <DeskPanel slots={slots} onSlotsChange={setSlots} symbols={symbolOptions} focusSymbol={focusSymbol} onFocus={onFocus} refreshKey={refreshBust} />
          )}
          {tab === "review" && <DayReviewPanel />}
          {tab === "lab" && <LabPanel selectedRunId={selectedRunId} onSelectRun={setSelectedRunId} />}
          {tab === "analyst" && <AnalystPanel focusSymbol={focusSymbol} />}
        </div>
        <div className="hidden xl:flex min-h-0">
          <RightSidebar
            focusSymbol={focusSymbol}
            focusName={focused?.name ?? ""}
            focusPrice={focused?.price ?? null}
            focusChangePct={focused?.changePct ?? null}
            focusSession={focused?.session ?? "—"}
            focusFresh={focused?.fresh ?? false}
          />
        </div>
      </div>

      <BottomDock focusSymbol={focusSymbol} onOpenRun={openRun} />

      {/* sticky footer */}
      <footer className="mt-auto shrink-0 h-[26px] flex items-center justify-between px-3 rounded-lg border border-[#1f303d] bg-[#0b131c] text-[9px] tracking-[0.08em] text-[#728798]">
        <span>
          AMI MARKET OBSERVATION + HISTORICAL RESEARCH · NO BROKER ORDER ROUTING
        </span>
        <span className="hidden sm:inline">
          DATA: PUBLIC REST POLLING · LOCAL DUKASCOPY HISTORY / EXPERIMENTAL POLLING
        </span>
      </footer>
    </div>
  );
}
