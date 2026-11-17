"use client";

import { useEffect, useMemo, useState } from "react";
import { MiniChart } from "./mini-chart";
import { buildStructureMarkers } from "@/lib/engine/market-structure";
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
  /** Exact immutable local dataset revision; absent means the normal provider feed. */
  datasetId?: string;
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

type DatasetTimeframe = "m1" | "m5" | "m15" | "m30" | "h1" | "h4" | "d1";

interface LocalDatasetOption {
  datasetId: string;
  instrumentId: string;
  displayName: string;
  dataClass: string;
  timeframe: DatasetTimeframe;
  priceSide: "bid" | "ask";
  qualityStatus: "PASS" | "REVIEW" | "REJECTED";
  rows: number;
  fromTs: number | null;
  toTs: number | null;
  importedAt: string;
}

interface DatasetCatalogResponse {
  datasets: LocalDatasetOption[];
  skipped: Array<{ directoryName: string; reason: string }>;
  fetchedAt: number;
}

interface MonitorInstrumentStatus {
  instrumentId: string;
  state: string;
  poller: {
    lastError?: string | null;
    lastSuccessAt?: number | null;
    intervalSeconds?: number;
  } | null;
  snapshot: {
    tick?: {
      bid: number;
      ask: number;
      spreadBps: number | null;
    } | null;
    fetchedAt?: number;
  } | null;
}

interface MonitorStatusResponse {
  feedMode: "EXPERIMENTAL_POLLING";
  ordersEnabled: false;
  instruments: MonitorInstrumentStatus[];
  fetchedAt: number;
  note: string;
}

const DATASET_CHART_TIMEFRAME: Partial<Record<DatasetTimeframe, Timeframe>> = {
  m15: "15m",
  h1: "1h",
  h4: "4h",
  d1: "1d",
};

interface CandlesResponse {
  symbol: string;
  tf: Timeframe;
  bars: Bar[];
  quality: DataQuality & {
    datasetId?: string;
    priceSide?: "bid" | "ask";
    qualityStatus?: "PASS" | "REVIEW" | "REJECTED";
  };
  dataset?: {
    datasetId: string;
    dataClass: string;
    recommendedAnalysisMethod: string;
    rawSha256: string;
    normalizedSha256: string;
  };
}

function ChartCard({
  slot,
  symbols,
  onFocus,
  isFocused,
  onSymbolChange,
  onTfChange,
  priceDecimals,
  refreshKey,
  datasets,
  includeReview,
}: {
  slot: ChartSlot;
  symbols: Array<{ symbol: string; name: string; decimals: number }>;
  datasets: LocalDatasetOption[];
  includeReview: boolean;
  onFocus: () => void;
  isFocused: boolean;
  onSymbolChange: (symbol: string) => void;
  onTfChange: (tf: Timeframe) => void;
  onDatasetChange: (datasetId: string | null) => void;
  priceDecimals: number;
  refreshKey: number;
}) {
  const selectedDatasetId = slot.datasetId ?? "provider";
  const [showStructure, setShowStructure] = useState(false);
  const selectableDatasets = useMemo(
    () => datasets.filter((dataset) =>
      (dataset.qualityStatus === "PASS" || (includeReview && dataset.qualityStatus === "REVIEW")) &&
      DATASET_CHART_TIMEFRAME[dataset.timeframe] === slot.tf
    ),
    [datasets, slot.tf, includeReview]
  );
  const selectedDataset = selectableDatasets.find((dataset) => dataset.datasetId === selectedDatasetId);
  const chartSymbol = selectedDataset?.instrumentId ?? slot.symbol;
  const chartTf = selectedDataset
    ? DATASET_CHART_TIMEFRAME[selectedDataset.timeframe] ?? slot.tf
    : slot.tf;
  const candlesUrl = selectedDataset
    ? `/api/candles?symbol=${encodeURIComponent(chartSymbol)}&tf=${chartTf}&datasetId=${encodeURIComponent(selectedDataset.datasetId)}&limit=600${selectedDataset.qualityStatus === "REVIEW" ? "&allowReview=true" : ""}`
    : `/api/candles?symbol=${encodeURIComponent(slot.symbol)}&tf=${slot.tf}&limit=600&days=${daysForTf(slot.tf)}`;
  // A pinned local dataset is immutable; refetch it only on explicit refresh
  // or an infrequent safety interval instead of rereading the entire archive each minute.
  const { data, error, loading } = usePolling<CandlesResponse>(
    candlesUrl,
    selectedDataset ? 86_400_000 : 60_000,
    refreshKey
  );
  const dataMatchesSelection = Boolean(
    data &&
    data.symbol === chartSymbol &&
    data.tf === chartTf &&
    (selectedDataset
      ? data.dataset?.datasetId === selectedDataset.datasetId
      : data.dataset === undefined)
  );
  const visibleBars = dataMatchesSelection ? data?.bars ?? [] : [];
  const last = visibleBars[visibleBars.length - 1];
  const q = dataMatchesSelection ? data?.quality : undefined;
  const chartDecimals = selectedDataset ? 2 : priceDecimals;
  const structureMarkers = useMemo(
    () => showStructure ? buildStructureMarkers(visibleBars) : [],
    [showStructure, visibleBars]
  );

  return (
    <article
      className={cn(
        "flex flex-col min-h-0 min-w-0 rounded-lg border overflow-hidden bg-gradient-to-b from-[#101d28] to-[#0d1720]",
        isFocused ? "border-[#668db9] shadow-[inset_0_0_0_1px_#668db933]" : "border-[#20323f]"
      )}
      aria-label={`Chart ${chartSymbol} ${chartTf}`}
    >
      <div className="flex items-center justify-between gap-2 px-2.5 pt-2 pb-1.5">
        <button onClick={onFocus} disabled={Boolean(selectedDataset)} className="flex items-baseline gap-2 min-w-0 text-left disabled:cursor-default">
          <strong className="text-[12px] truncate">{chartSymbol}</strong>
          <span className="text-[9px] text-[#8193a3] truncate hidden sm:inline">
            {selectedDataset ? "LOCAL · " + selectedDataset.displayName : q?.providerSymbol ?? ""}
          </span>
        </button>
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowStructure((value) => !value)}
            aria-pressed={showStructure}
            className={cn(
              "h-6 px-2 text-[9px]",
              showStructure ? "text-[#4bc39a] bg-[#123025]" : "text-[#8193a3]"
            )}
            title="Confirmed closed-bar BOS and CHoCH markers only"
          >
            STRUCTURE {showStructure ? "ON" : "OFF"}
          </Button>
          <Select
            value={selectedDataset?.datasetId ?? "provider"}
            onValueChange={(value) => onDatasetChange(value === "provider" ? null : value)}
          >
            <SelectTrigger className="h-6 w-[138px] bg-[#0a121a] border-[#34506a] text-[10px] px-2">
              <SelectValue placeholder="Provider feed" />
            </SelectTrigger>
            <SelectContent className="bg-[#0e1720] border-[#223546] text-[11px] max-h-72">
              <SelectItem value="provider" className="text-[11px]">Provider feed</SelectItem>
              {selectableDatasets.map((dataset) => (
                <SelectItem key={dataset.datasetId} value={dataset.datasetId} className="text-[10px]">
                  {dataset.instrumentId} · {dataset.timeframe} · {dataset.priceSide.toUpperCase()} · {dataset.qualityStatus} · {dataset.rows} bars
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={slot.symbol} onValueChange={(symbol) => {
            onDatasetChange(null);
            onSymbolChange(symbol);
          }}>
            <SelectTrigger disabled={Boolean(selectedDataset)} className="h-6 w-[104px] bg-[#0a121a] border-[#223546] text-[10px] px-2">
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
          <Select value={slot.tf} onValueChange={(v) => {
            onDatasetChange(null);
            onTfChange(v as Timeframe);
          }}>
            <SelectTrigger disabled={Boolean(selectedDataset)} className="h-6 w-[62px] bg-[#0a121a] border-[#223546] text-[10px] px-2">
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
            <span>O {fmtPrice(last.o, Math.min(chartDecimals, 2))}</span>
            <span>H {fmtPrice(last.h, Math.min(chartDecimals, 2))}</span>
            <span>L {fmtPrice(last.l, Math.min(chartDecimals, 2))}</span>
            <span className={last.c >= last.o ? "text-[#4bc39a]" : "text-[#ef777d]"}>
              C {fmtPrice(last.c, Math.min(chartDecimals, 2))}
            </span>
          </>
        )}
        {loading && !dataMatchesSelection && <span>loading…</span>}
      </div>
      <div className="flex-1 min-h-0 px-1 pb-1">
        <MiniChart
          bars={visibleBars}
          markers={structureMarkers}
          decimals={chartDecimals}
          chartId={`${chartSymbol}-${chartTf}-${selectedDataset?.datasetId ?? "provider"}`}
        />
      </div>
      <div className="h-[20px] border-t border-[#1d2c38] flex items-center justify-between px-2 text-[8.5px] text-[#748999]">
        <span className="truncate" title={error ?? q?.note ?? undefined}>
          {error
            ? (dataMatchesSelection ? "STALE · " : "ERROR · ") + error
            : q?.datasetId
              ? "LOCAL DATASET · " + (q.priceSide ?? "").toUpperCase() + " · " + (q.qualityStatus ?? "UNVERIFIED") + " · " + q.bars + " bars"
              : q
              ? q.provider.toUpperCase() + " · " + q.bars + " closed bars" + (q.resampledFrom ? " · agg from " + q.resampledFrom : "")
              : loading
                  ? "FETCHING CLOSED BARS…"
                  : selectedDataset ? "WAITING FOR DATASET" : "WAITING FOR PROVIDER"}
        </span>
        <span
          className={cn(
            "shrink-0",
            q?.coverage === "FULL" && "text-[#4bc39a]",
            q?.coverage === "PARTIAL" && "text-[#e7b86d]",
            (q?.coverage === "PROVIDER_LIMIT" || q?.coverage === "INSUFFICIENT") && "text-[#e7b86d]"
          )}
        >
          {q?.datasetId ? "HASH VERIFIED" : q ? `${q.coverage} · ${q.coveredDays}d` : ""}
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
  refreshKey = 0,
}: {
  slots: ChartSlot[];
  onSlotsChange: (slots: ChartSlot[]) => void;
  symbols: Array<{ symbol: string; name: string; decimals: number }>;
  focusSymbol: string;
  onFocus: (symbol: string) => void;
  refreshKey?: number;
}) {
  const { data: catalog } = usePolling<DatasetCatalogResponse>(
    "/api/market-data/datasets",
    60_000,
    refreshKey
  );
  const { data: monitorStatus } = usePolling<MonitorStatusResponse>("/api/market-data/monitor", 15_000);
  const [includeReviewDatasets, setIncludeReviewDatasets] = useState(false);
  const datasets = catalog?.datasets ?? [];
  const localDatasets = datasets;
  const chartSymbols = useMemo(() => {
    const combined = [...symbols];
    const seen = new Set(combined.map((item) => item.symbol));
    for (const dataset of datasets) {
      if (seen.has(dataset.instrumentId)) continue;
      seen.add(dataset.instrumentId);
      combined.push({
        symbol: dataset.instrumentId,
        name: dataset.displayName,
        decimals: 2,
      });
    }
    return combined;
  }, [symbols, datasets]);
  const preset = slots.length; // layout preset is derived from the slot count
  const decimalsOf = (symbol: string) => chartSymbols.find((s) => s.symbol === symbol)?.decimals ?? 2;
  const gridClass =
    preset === 1
      ? "grid-cols-1 grid-rows-1"
      : preset === 2
        ? "grid-cols-1 sm:grid-cols-2 grid-rows-1"
        : "grid-cols-1 sm:grid-cols-2 grid-rows-2";

  const setPresetSafe = (n: 1 | 2 | 4) => {
    const cur = [...slots];
    while (cur.length < n) cur.push({ symbol: chartSymbols[cur.length % chartSymbols.length]?.symbol ?? "BTCUSDT", tf: "4h" });
    onSlotsChange(cur.slice(0, n));
  };

  return (
    <section className="panel flex flex-col min-h-0 min-w-0" aria-label="Chart desk">
      <div className="panel-head">
        <div className="flex items-center gap-2">
          <span>CHART CANVAS</span>
          <span className="text-[9px] font-normal text-[#687e90]">
            closed bars · independent panels · {localDatasets.filter((dataset) => dataset.qualityStatus === "PASS").length} PASS / {localDatasets.filter((dataset) => dataset.qualityStatus === "REVIEW").length} REVIEW
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setIncludeReviewDatasets((value) => !value)}
            aria-pressed={includeReviewDatasets}
            className={cn(
              "h-6 px-2 text-[9px]",
              includeReviewDatasets ? "text-[#e7b86d] bg-[#302719]" : "text-[#8193a3]"
            )}
            title="REVIEW datasets may contain unclassified session gaps or resolved duplicates"
          >
            REVIEW {includeReviewDatasets ? "ON" : "OFF"}
          </Button>
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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1 border-b border-[#1d2c38] text-[9px] text-[#748999]">
        <span className="text-[#e7b86d]">EXPERIMENTAL POLLING · NOT THE CHART FEED</span>
        {(monitorStatus?.instruments ?? []).map((item) => {
          const tick = item.snapshot?.tick;
          const color = item.state === "FRESH"
            ? "text-[#4bc39a]"
            : item.state === "STALE" || item.state === "ERROR"
              ? "text-[#ef777d]"
              : item.state === "NOT_STARTED"
                ? "text-[#748999]"
                : "text-[#e7b86d]";
          return (
            <span key={item.instrumentId} className={cn("tnum", color)} title={item.poller?.lastError ?? undefined}>
              {item.instrumentId} · {item.state}
              {tick ? ` · ${fmtPrice(tick.bid, 2)} / ${fmtPrice(tick.ask, 2)} · ${tick.spreadBps?.toFixed(2) ?? "—"} bps` : ""}
            </span>
          );
        })}
        {!monitorStatus && <span>status unavailable</span>}
        {monitorStatus?.instruments.every((item) => item.state === "NOT_STARTED") && (
          <span>start with bun run market-data:monitor -- --instrument XAUUSD-DUKA</span>
        )}
      </div>
      <div className={cn("grid gap-1.5 p-1.5 flex-1 min-h-0", gridClass)}>
        {slots.map((slot, i) => (
          <ChartCard
            key={String(i) + "-" + slot.symbol + "-" + slot.tf + "-" + (slot.datasetId ?? "provider")}
            slot={slot}
            symbols={chartSymbols}
            onFocus={() => onFocus(slot.symbol)}
            isFocused={slot.symbol === focusSymbol}
            onSymbolChange={(symbol) => {
              const next = [...slots];
              next[i] = { ...slot, symbol, datasetId: undefined };
              onSlotsChange(next);
              onFocus(symbol);
            }}
            onTfChange={(tf) => {
              const next = [...slots];
              next[i] = { ...slot, tf, datasetId: undefined };
              onSlotsChange(next);
            }}
            priceDecimals={decimalsOf(slot.symbol)}
            refreshKey={refreshKey}
            datasets={localDatasets}
            includeReview={includeReviewDatasets}
            onDatasetChange={(datasetId) => {
              const next = [...slots];
              next[i] = { ...slot, datasetId: datasetId ?? undefined };
              onSlotsChange(next);
            }}
          />
        ))}
      </div>
    </section>
  );
}
