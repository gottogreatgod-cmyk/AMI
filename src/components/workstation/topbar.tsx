"use client";

import { useEffect, useState } from "react";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { fmtClock } from "./hooks";
import { LogOut, RefreshCw, Wifi, WifiOff } from "lucide-react";

export interface FeedHealth {
  engineVersion?: string;
  db?: string;
  providers?: {
    binance?: { requests?: number; retries?: number; last429?: number; lastError?: string | null };
    yahoo?: { requests?: number; retries?: number; lastError?: string | null };
  };
  time?: string;
}

export function Topbar({
  sessionEmail,
  health,
  healthLoading,
  onRefresh,
  online,
}: {
  sessionEmail: string | null;
  health: FeedHealth | null;
  healthLoading: boolean;
  onRefresh: () => void;
  online: boolean;
}) {
  const [clock, setClock] = useState<string>("");
  const [utc, setUtc] = useState<string>("");

  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setClock(fmtClock(d));
      setUtc(`${d.toISOString().slice(11, 19)} UTC`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const binanceOk = !health?.providers?.binance?.lastError;
  const yahooOk = !health?.providers?.yahoo?.lastError;
  const dbOk = health?.db === "OK";

  return (
    <header className="panel h-[54px] flex items-center justify-between px-3 gap-3 shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-[#78a9ea] via-[#a58de6] to-[#48b997] grid place-items-center text-[#071019] font-black text-sm">
            A
          </div>
          <div className="leading-none">
            <div className="font-extrabold tracking-[0.14em] text-[15px]">AMI</div>
            <div className="text-[9px] tracking-[0.1em] text-[#788c9c] font-medium mt-0.5 hidden sm:block">
              QUANT WORKSTATION
            </div>
          </div>
        </div>
        <div className="h-6 w-px bg-[#2b3e4d] hidden sm:block" />
        <Badge className="bg-[#123025] text-[#4bc39a] border-[#2b5c48] text-[10px] tracking-wide hidden sm:inline-flex">
          ● MONITOR
        </Badge>
        <Badge className="bg-[#302719] text-[#e7b86d] border-[#5c4a2b] text-[10px] tracking-wide hidden md:inline-flex">
          ● PAPER LOCKED
        </Badge>
        <span className="chip hidden lg:inline-block">{health?.engineVersion ?? "ami-engine"}</span>
      </div>

      <div className="flex items-center gap-2.5">
        <div className="hidden md:flex items-center gap-2 text-[10px] text-[#8193a3]">
          <span className="flex items-center gap-1">
            {online ? (
              <Wifi className="w-3.5 h-3.5 text-[#4bc39a]" />
            ) : (
              <WifiOff className="w-3.5 h-3.5 text-[#ef777d]" />
            )}
            Binance REST {binanceOk ? <span className="text-[#4bc39a]">ok</span> : <span className="text-[#ef777d]">err</span>}
          </span>
          <span className="flex items-center gap-1">
            Yahoo REST {yahooOk ? <span className="text-[#4bc39a]">ok</span> : <span className="text-[#ef777d]">err</span>}
          </span>
          <span className="flex items-center gap-1">
            DB {dbOk ? <span className="text-[#4bc39a]">ok</span> : <span className="text-[#e7b86d]">…</span>}
          </span>
        </div>
        <div className="text-right leading-none hidden sm:block">
          <div className="text-[13px] font-bold tnum">{clock}</div>
          <div className="text-[9px] text-[#687e90] tnum">{utc}</div>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          className="h-8 w-8 p-0 text-[#8193a3] hover:text-[#e5edf4]"
          aria-label="Refresh feeds"
        >
          <RefreshCw className={`w-4 h-4 ${healthLoading ? "animate-spin" : ""}`} />
        </Button>
        <div className="hidden sm:block text-[10px] text-[#8193a3] max-w-[140px] truncate" title={sessionEmail ?? ""}>
          {sessionEmail ?? "—"}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => signOut({ callbackUrl: "/" })}
          className="h-8 px-2 text-[#8193a3] hover:text-[#ef777d]"
        >
          <LogOut className="w-4 h-4" />
          <span className="hidden sm:inline text-[11px] ml-1">Sign out</span>
        </Button>
      </div>
    </header>
  );
}
