"use client";

import { useEffect, useMemo, useState } from "react";
import { MiniChart, type ChartMarker } from "./mini-chart";
import { usePolling, fmtPrice } from "./hooks";
import type { Bar, DataQuality, Timeframe } from "@/lib/engine/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ChartSlot {
  symbol: string;
  tf: Timeframe;
}

const TFS: Timeframe[] = ["15m", "45m", "1h", "3h", "4h", "1d", "1w"];

function daysForTf(tf: Timeframe): number {
  switch (tf) {
    case "15m":
    case "45m":
      return 10;
    case "1h":
    case "3h":
      return 45;
    case "4h":
      return 90;
    case "1d":
      return 365;
    case "1w":
      return 900;
  }
}

interface CandlesResponse {
  symbol: string;
  tf: Timeframe;
  bars: Bar[];
  quality: DataQuality;
}

function ChartCard({
  slot,
  symbols,
  onFocus,
  isFocused,
  onSymbolChange,
  onTfChange,
  priceDecimals,
}: {
  slot: ChartSlot;
  symbols: Array<{ symbol: string; name: string; decimals: number }>;
  onFocus: () => void;
  isFocused: boolean;
  onSymbolChange: (symbol: string) => void;
  onTfChange: (tf: Timeframe) => void;
  priceDecimals: number;
}) {
  const { data, loading } = usePolling<CandlesResponse>(
    `/api/candles?symbol=${encodeURIComponent(slot.symbol)}&tf=${slot.tf}&limit=600&days=${daysForTf(slot.tf)}`,
    60_000
  );
  const last = data?.bars?.[data.bars.length - 1];
  const q = data?.quality;

  return (
    <article
      className={cn(
        "flex flex-col min-h-0 min-w-0 rounded-lg border overflow-hidden bg-gradient-to-b from-[#101d28] to-[#0d1720]",
        isFocused ? "border-[#668db9] shadow-[inset_0_0_0_1px_#668db933]" : "border-[#20323f]"
      )}
      aria-label={`Chart ${slot.symbol} ${slot.tf}`}
    >
      <div className="flex items-center justify-between gap-2 px-2.5 pt-2 pb-1.5">
        <button onClick={onFocus} className="flex items-baseline gap-2 min-w-0 text-left">
          <strong className="text-[12px] truncate">{slot.symbol}</strong>
          <span className="text-[9px] text-[#8193a3] truncate hidden sm:inline">{q?.providerSymbol ?? ""}</span>
        </button>
        <div className="flex items-center gap-1.5">
          <Select value={slot.symbol} onValueChange={onSymbolChange}>
            <SelectTrigger className="h-6 w-[104px] bg-[#0a121a] border-[#223546] text-[10px] px-2">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[#0e1720] border-[#223546] text-[11px] max-h-72">
              {symbols.map((s) => (
                <SelectItem key={s.symbol} value={s.symbol} className="text-[11px]">
                  {s.symbol}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={slot.tf} onValueChange={(v) => onTfChange(v as Timeframe)}>
            <SelectTrigger className="h-6 w-[62px] bg-[#0a121a] border-[#223546] text-[10px] px-2">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-[#0e1720] border-[#223546] text-[11px]">
              {TFS.map((t) => (
                <SelectItem key={t} value={t} className="text-[11px]">
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex gap-2.5 px-2.5 pb-1 text-[9px] text-[#8295a6] tnum">
        {last && (
          <>
            <span>O {fmtPrice(last.o, Math.min(priceDecimals, 2))}</span>
            <span>H {fmtPrice(last.h, Math.min(priceDecimals, 2))}</span>
            <span>L {fmtPrice(last.l, Math.min(priceDecimals, 2))}</span>
            <span className={last.c >= last.o ? "text-[#4bc39a]" : "text-[#ef777d]"}>
              C {fmtPrice(last.c, Math.min(priceDecimals, 2))}
            </span>
          </>
        )}
        {loading && !data && <span>loading…</span>}
      </div>
      <div className="flex-1 min-h-0 px-1 pb-1">
        <MiniChart bars={data?.bars ?? []} decimals={priceDecimals} chartId={`${slot.symbol}-${slot.tf}`} />
      </div>
      <div className="h-[20px] border-t border-[#1d2c38] flex items-center justify-between px-2 text-[8.5px] text-[#748999]">
        <span className="truncate">
          {q
            ? `${q.provider.toUpperCase()} · ${q.bars} closed bars${q.resampledFrom ? ` · agg from ${q.resampledFrom}` : ""}`
            : "…"}
        </span>
        <span
          className={cn(
            "shrink-0",
            q?.coverage === "FULL" && "text-[#4bc39a]",
            q?.coverage === "PARTIAL" && "text-[#e7b86d]",
            (q?.coverage === "PROVIDER_LIMIT" || q?.coverage === "INSUFFICIENT") && "text-[#e7b86d]"
          )}
        >
          {q ? `${q.coverage} · ${q.coveredDays}d` : ""}
        </span>
      </div>
    </article>
  );
}

export function DeskPanel({
  slots,
  onSlotsChange,
  symbols,
  focusSymbol,
  onFocus,
}: {
  slots: ChartSlot[];
  onSlotsChange: (slots: ChartSlot[]) => void;
  symbols: Array<{ symbol: string; name: string; decimals: number }>;
  focusSymbol: string;
  onFocus: (symbol: string) => void;
}) {
  const preset = slots.length; // layout preset is derived from the slot count
  const decimalsOf = (symbol: string) => symbols.find((s) => s.symbol === symbol)?.decimals ?? 2;
  const gridClass =
    preset === 1
      ? "grid-cols-1 grid-rows-1"
      : preset === 2
        ? "grid-cols-1 sm:grid-cols-2 grid-rows-1"
        : "grid-cols-1 sm:grid-cols-2 grid-rows-2";

  const setPresetSafe = (n: 1 | 2 | 4) => {
    const cur = [...slots];
    while (cur.length < n) cur.push({ symbol: symbols[cur.length % symbols.length]?.symbol ?? "BTCUSDT", tf: "4h" });
    onSlotsChange(cur.slice(0, n));
  };

  return (
    <section className="panel flex flex-col min-h-0 min-w-0" aria-label="Chart desk">
      <div className="panel-head">
        <div className="flex items-center gap-2">
          <span>CHART CANVAS</span>
          <span className="text-[9px] font-normal text-[#687e90]">closed bars · independent panels</span>
        </div>
        <div className="flex items-center gap-1">
          <LayoutGrid className="w-3 h-3 text-[#687e90]" aria-hidden />
          {([1, 2, 4] as const).map((n) => (
            <Button
              key={n}
              size="sm"
              variant="ghost"
              onClick={() => setPresetSafe(n)}
              className={cn(
                "h-6 w-7 p-0 text-[10px]",
                preset === n ? "bg-[#203244] text-[#e5f0fb] border border-[#34506a]" : "text-[#8193a3]"
              )}
              aria-label={`${n} chart layout`}
              aria-pressed={preset === n}
            >
              {n}
            </Button>
          ))}
        </div>
      </div>
      <div className={cn("grid gap-1.5 p-1.5 flex-1 min-h-0", gridClass)}>
        {slots.map((slot, i) => (
          <ChartCard
            key={i}
            slot={slot}
            symbols={symbols}
            onFocus={() => onFocus(slot.symbol)}
            isFocused={slot.symbol === focusSymbol}
            onSymbolChange={(symbol) => {
              const next = [...slots];
              next[i] = { ...slot, symbol };
              onSlotsChange(next);
              onFocus(symbol);
            }}
            onTfChange={(tf) => {
              const next = [...slots];
              next[i] = { ...slot, tf };
              onSlotsChange(next);
            }}
            priceDecimals={decimalsOf(slot.symbol)}
          />
        ))}
      </div>
    </section>
  );
}
