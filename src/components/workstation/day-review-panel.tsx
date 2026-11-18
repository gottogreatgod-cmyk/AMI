"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { MiniChart, type ChartMarker } from "./mini-chart";
import { cn } from "@/lib/utils";

type DatasetOption = {
  datasetId: string;
  instrumentId: "XAUUSD-DUKA" | "NAS100-DUKA";
  displayName: string;
  dataClass: string;
  timeframe: string;
  priceSide: "bid" | "ask";
  qualityStatus: "PASS" | "REVIEW" | "REJECTED";
  rows: number;
  fromTs: number | null;
  toTs: number | null;
  importedAt: string;
};

type CatalogResponse = { datasets: DatasetOption[]; fetchedAt: number };

type ReplayEvidence = {
  code: string;
  value?: string | number | boolean | null;
  threshold?: string | number | boolean | null;
  sourceBarTs: number;
};

type ReplayEvent = {
  id: string;
  setupId: string;
  eventKey: string;
  type: string;
  instrumentId: string;
  timeframe: string;
  occurredAtTs: number;
  discoveredAtTs: number;
  confirmationBarTs: number;
  confirmationBarCloseTs: number;
  withinRequestedRange: boolean;
  reason: string;
  evidence: ReplayEvidence[];
  origin: "HISTORICAL_REPLAY";
};

type ReplayResult = {
  id: string;
  runKey: string;
  instrumentId: string;
  timeframe: string;
  source: {
    provider: string;
    sourceId: string;
    dataClass: string;
    revisionId: string;
    revisionHash: string;
  };
  detectorId: string;
  detectorVersion: string;
  paramsHash: string;
  engineVersion: string;
  interval: { fromTs: number; toTs: number };
  warmupBarsRequested: number;
  warmupBarsUsed: number;
  inputBars: number;
  evaluatedBars: number;
  origin: "HISTORICAL_REPLAY";
  createdAt: string;
  events: ReplayEvent[];
};

type ReplayApiResponse = {
  replay?: ReplayResult;
  error?: string;
  message?: string;
  issues?: Array<{ path: Array<string | number>; message: string }>;
  dataLimitations?: string[];
  execution?: { enabled: false; ordersSubmitted: false; fillsCreated: false };
};

type CandleResponse = {
  bars: Array<{ t: number; o: number; h: number; l: number; c: number; v: number; ct: number }>;
  quality?: { bars: number; gapsDetected: number; qualityStatus?: string; note?: string };
  error?: string;
  message?: string;
};

const UTC_DAY_MS = 86_400_000;

function utcDate(value: number | null): string {
  return value === null ? "—" : new Date(value).toISOString().slice(0, 10);
}

function utcTime(value: number): string {
  return new Date(value).toISOString().slice(11, 23) + " UTC";
}

function markerColor(type: string): string {
  if (type === "FORMING") return "#d5a85c";
  if (type === "ARMED") return "#7299c7";
  if (type === "TRIGGERED") return "#4bc39a";
  if (type === "INVALIDATED") return "#ef777d";
  return "#8193a3";
}

function buildReplayMarkers(events: ReplayEvent[]): ChartMarker[] {
  const directions = new Map<string, "long" | "short">();
  for (const event of events) {
    if (event.type !== "FORMING") continue;
    if (event.evidence.some((item) => item.code === "broken-swing-high")) {
      directions.set(event.setupId, "long");
    } else if (event.evidence.some((item) => item.code === "broken-swing-low")) {
      directions.set(event.setupId, "short");
    }
  }

  return events
    .filter((event) => event.withinRequestedRange)
    .map((event) => {
      const direction = directions.get(event.setupId) ?? "long";
      const bullish = direction === "long";
      const isArrow = event.type === "FORMING" || event.type === "TRIGGERED";
      return {
        time: event.confirmationBarTs,
        position: bullish ? "belowBar" : "aboveBar",
        color: markerColor(event.type),
        shape: isArrow ? (bullish ? "arrowUp" : "arrowDown") : "circle",
        text: event.type === "INVALIDATED"
          ? "INV"
          : event.type === "TRIGGERED"
            ? "TRG"
            : event.type === "FORMING"
              ? "SET"
              : event.type === "ARMED"
                ? "ARM"
                : "EXP",
      } satisfies ChartMarker;
    });
}

function eventSummary(events: ReplayEvent[]) {
  const setups = new Set(events.map((event) => event.setupId));
  return {
    setups: setups.size,
    forming: events.filter((event) => event.type === "FORMING").length,
    armed: events.filter((event) => event.type === "ARMED").length,
    triggered: events.filter((event) => event.type === "TRIGGERED").length,
    invalidated: events.filter((event) => event.type === "INVALIDATED").length,
    expired: events.filter((event) => event.type.startsWith("EXPIRED")).length,
    warmup: events.filter((event) => !event.withinRequestedRange).length,
  };
}

export function DayReviewPanel() {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [warmupBars, setWarmupBars] = useState(200);
  const [allowReview, setAllowReview] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [replayLoading, setReplayLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [result, setResult] = useState<ReplayResult | null>(null);
  const [bars, setBars] = useState<CandleResponse["bars"]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [chartError, setChartError] = useState<string | null>(null);
  const [dataNote, setDataNote] = useState<string | null>(null);

  const reloadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    setCatalogError(null);
    try {
      const response = await fetch("/api/market-data/datasets", { cache: "no-store" });
      const data = await response.json() as CatalogResponse & { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Unable to load local datasets.");
      setCatalog(data);
      const usable = data.datasets
        .filter((item) => item.timeframe === "m1" && item.qualityStatus !== "REJECTED")
        .sort((a, b) => b.importedAt.localeCompare(a.importedAt));
      setSelectedDatasetId((current) =>
        usable.some((item) => item.datasetId === current)
          ? current
          : usable[0]?.datasetId ?? ""
      );
    } catch (error) {
      setCatalogError(error instanceof Error ? error.message : String(error));
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadCatalog();
  }, [reloadCatalog]);

  const datasets = useMemo(
    () => (catalog?.datasets ?? []).filter((item) =>
      item.timeframe === "m1" &&
      (item.qualityStatus === "PASS" || (allowReview && item.qualityStatus === "REVIEW"))
    ),
    [catalog, allowReview]
  );
  const selectedDataset = datasets.find((item) => item.datasetId === selectedDatasetId) ?? null;
  const fromTs = Date.parse(date + "T00:00:00.000Z");
  const toTs = fromTs + UTC_DAY_MS - 1;
  const validDate = Number.isFinite(fromTs) && fromTs > 0;

  useEffect(() => {
    if (!selectedDataset?.toTs || !selectedDataset.fromTs) return;
    if (!validDate || toTs < selectedDataset.fromTs || fromTs > selectedDataset.toTs) {
      setDate(utcDate(selectedDataset.toTs));
      setResult(null);
    }
  }, [selectedDataset?.datasetId, selectedDataset?.fromTs, selectedDataset?.toTs, validDate, fromTs, toTs]);

  useEffect(() => {
    if (!selectedDataset || !validDate) {
      setBars([]);
      setChartError(null);
      return;
    }
    const controller = new AbortController();
    setChartLoading(true);
    setChartError(null);
    const params = new URLSearchParams({
      symbol: selectedDataset.instrumentId,
      tf: "1m",
      datasetId: selectedDataset.datasetId,
      fromTs: String(fromTs),
      toTs: String(toTs),
      limit: "2000",
      ...(selectedDataset.qualityStatus === "REVIEW" ? { allowReview: "true" } : {}),
    });
    fetch("/api/candles?" + params.toString(), {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json() as CandleResponse;
        if (!response.ok) throw new Error(data.message ?? data.error ?? "Unable to load chart candles.");
        setBars(data.bars ?? []);
        setDataNote(data.quality?.note ?? null);
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setBars([]);
        setChartError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setChartLoading(false);
      });

    return () => controller.abort();
  }, [selectedDataset?.datasetId, selectedDataset?.qualityStatus, selectedDataset?.instrumentId, date, validDate, fromTs, toTs]);

  const markers = useMemo(
    () => result ? buildReplayMarkers(result.events) : [],
    [result]
  );
  const summary = useMemo(
    () => result ? eventSummary(result.events) : null,
    [result]
  );
  const groupedEvents = useMemo(() => {
    if (!result) return [];
    const groups = new Map<string, ReplayEvent[]>();
    for (const event of result.events) {
      const group = groups.get(event.setupId) ?? [];
      group.push(event);
      groups.set(event.setupId, group);
    }
    return [...groups.entries()].map(([setupId, events]) => ({
      setupId,
      events: events.sort((a, b) => a.discoveredAtTs - b.discoveredAtTs),
    })).sort((a, b) =>
      (a.events[0]?.discoveredAtTs ?? 0) - (b.events[0]?.discoveredAtTs ?? 0)
    );
  }, [result]);

  const runReplay = async () => {
    if (!selectedDataset || !validDate) return;
    setReplayLoading(true);
    setReplayError(null);
    setResult(null);
    const response = await fetch("/api/replay", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        datasetId: selectedDataset.datasetId,
        fromTs,
        toTs,
        warmupBars,
        allowReview,
        detector: {
          leftBars: 3,
          rightBars: 3,
          maxBarsAfterBreak: 12,
          maxBarsAfterRetest: 8,
        },
      }),
    });

    try {
      const data = await response.json() as ReplayApiResponse;
      if (!response.ok || !data.replay) {
        const issueText = data.issues?.map((issue) => issue.path.join(".") + ": " + issue.message).join("; ");
        throw new Error([data.error, data.message, issueText].filter(Boolean).join(" · ") || "Replay failed.");
      }
      setResult(data.replay);
      setDataNote((data.dataLimitations ?? []).join(" "));
    } catch (error) {
      setReplayError(error instanceof Error ? error.message : String(error));
    } finally {
      setReplayLoading(false);
    }
  };

  const latestDate = selectedDataset?.toTs ? utcDate(selectedDataset.toTs) : "";
  const earliestDate = selectedDataset?.fromTs ? utcDate(selectedDataset.fromTs) : "";
  const canRun = Boolean(
    selectedDataset &&
    validDate &&
    fromTs >= (selectedDataset.fromTs ?? 0) &&
    fromTs <= (selectedDataset.toTs ?? 0) &&
    warmupBars >= 0 &&
    Number.isInteger(warmupBars) &&
    !replayLoading
  );

  return (
    <section className="panel flex flex-col min-h-0 min-w-0" aria-label="Historical day review">
      <div className="panel-head flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <span>DAY REVIEW · HISTORICAL REPLAY</span>
          <span className="text-[9px] font-normal text-[#687e90]">same causal detector as the future live monitor</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[9px] text-[#d5a85c] border border-[#5c4a2b] rounded px-2 py-1">RETROSPECTIVE · NOT A LIVE ALERT</span>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)] gap-2 p-2 border-b border-[#1d2c38]">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-2">
          <label className="flex flex-col gap-1 text-[10px] text-[#8193a3]">
            Local immutable M1 dataset
            <select
              value={selectedDatasetId}
              onChange={(event) => {
                setSelectedDatasetId(event.target.value);
                setResult(null);
              }}
              disabled={catalogLoading || datasets.length === 0}
              className="h-9 rounded-md border border-[#34506a] bg-[#0a121a] px-2 text-[11px] text-[#e5edf4]"
            >
              {datasets.length === 0 && <option value="">No eligible M1 datasets found</option>}
              {datasets.map((item) => (
                <option key={item.datasetId} value={item.datasetId}>
                  {item.instrumentId} · {item.priceSide.toUpperCase()} · {item.qualityStatus} · {item.rows.toLocaleString()} bars · {item.datasetId.slice(-12)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[10px] text-[#8193a3]">
            UTC calendar day
            <input
              type="date"
              value={date}
              min={earliestDate || undefined}
              max={latestDate || undefined}
              onChange={(event) => {
                setDate(event.target.value);
                setResult(null);
              }}
              className="h-9 rounded-md border border-[#34506a] bg-[#0a121a] px-2 text-[11px] text-[#e5edf4] scheme-dark"
            />
          </label>
          <label className="flex flex-col gap-1 text-[10px] text-[#8193a3]">
            Warmup bars before the selected day
            <input
              type="number"
              min={0}
              max={20000}
              value={warmupBars}
              onChange={(event) => setWarmupBars(Math.max(0, Math.min(20000, Number(event.target.value) || 0)))}
              className="h-9 rounded-md border border-[#34506a] bg-[#0a121a] px-2 text-[11px] text-[#e5edf4]"
            />
          </label>
          <div className="flex items-center gap-2 text-[10px] text-[#a8b7c4]">
            <input
              id="include-review-datasets"
              type="checkbox"
              checked={allowReview}
              onChange={(event) => {
                setAllowReview(event.target.checked);
                setResult(null);
              }}
              className="accent-amber-500"
            />
            <label htmlFor="include-review-datasets">Include REVIEW datasets (explicit exploratory opt-in)</label>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => void runReplay()} disabled={!canRun} className="h-8 text-[10px]">
              {replayLoading ? "RUNNING REPLAY…" : "SCAN SELECTED UTC DAY"}
            </Button>
            <Button size="sm" variant="outline" onClick={() => void reloadCatalog()} disabled={catalogLoading} className="h-8 text-[10px]">
              REFRESH DATASETS
            </Button>
          </div>
          {catalogLoading && <p className="text-[10px] text-[#8193a3]">Loading local dataset catalog…</p>}
          {catalogError && <p className="text-[10px] text-[#ef777d]">{catalogError}</p>}
          {replayError && <p className="text-[10px] text-[#ef777d]">{replayError}</p>}
          {selectedDataset && (
            <div className="rounded border border-[#263b4c] bg-[#0a121a] p-2 text-[9px] leading-relaxed text-[#8193a3]">
              <div className="text-[#d5a85c]">EXACT REVISION · {selectedDataset.priceSide.toUpperCase()} ONLY</div>
              <div>{selectedDataset.instrumentId} · {selectedDataset.dataClass}</div>
              <div>{utcDate(selectedDataset.fromTs)} → {utcDate(selectedDataset.toTs)} UTC</div>
              <div className="break-all">ID: {selectedDataset.datasetId}</div>
            </div>
          )}
        </div>

        <div className="min-h-[280px] rounded-md border border-[#1d2c38] bg-[#0a121a] p-1.5 flex flex-col">
          <div className="flex items-center justify-between px-1 pb-1 text-[9px] text-[#8193a3]">
            <span>{selectedDataset?.instrumentId ?? "M1 CHART"} · {date} UTC</span>
            <span>{chartLoading ? "LOADING…" : chartError ? "CHART ERROR" : bars.length.toLocaleString() + " CLOSED BARS"}</span>
          </div>
          <div className="flex-1 min-h-[250px]">
            <MiniChart
              bars={bars}
              markers={markers}
              decimals={2}
              chartId={"day-review-" + (selectedDataset?.datasetId ?? "none")}
            />
          </div>
          {chartError && <p className="px-1 py-1 text-[9px] text-[#ef777d]">{chartError}</p>}
          {!chartLoading && !chartError && bars.length === 0 && (
            <p className="px-1 py-1 text-[9px] text-[#8193a3]">No M1 bars are available for this day in the selected revision.</p>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto p-2 space-y-2">
        {result ? (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-1.5">
              {[
                ["SETUPS", summary?.setups ?? 0],
                ["FORMING", summary?.forming ?? 0],
                ["ARMED", summary?.armed ?? 0],
                ["TRIGGERED", summary?.triggered ?? 0],
                ["INVALIDATED", summary?.invalidated ?? 0],
                ["EXPIRED", summary?.expired ?? 0],
                ["WARMUP EVENTS", summary?.warmup ?? 0],
              ].map(([label, value]) => (
                <div key={String(label)} className="rounded border border-[#203444] bg-[#0b151f] px-2 py-2">
                  <div className="text-[8px] tracking-wide text-[#748999]">{label}</div>
                  <div className="text-[16px] font-bold tnum text-[#e5edf4]">{value}</div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[9px] text-[#8193a3]">
              <span>{result.detectorId} v{result.detectorVersion} · engine {result.engineVersion}</span>
              <span>{result.evaluatedBars.toLocaleString()} review bars · {result.warmupBarsUsed.toLocaleString()} warmup bars</span>
            </div>
            <div className="rounded border border-[#5c4a2b] bg-[#201a11] p-2 text-[9px] leading-relaxed text-[#d6bc8b]">
              This result is a deterministic retrospective scan of the selected quote-side dataset. It is not a historical live alert, a broker fill, a backtest result, or proof of strategy profitability. Only closed M1 candles are used.
            </div>
            {groupedEvents.length === 0 ? (
              <div className="rounded border border-[#203444] bg-[#0b151f] p-4 text-center text-[11px] text-[#8193a3]">
                No events were emitted by this detector for the selected date and its configured warmup.
              </div>
            ) : groupedEvents.map((group, index) => (
              <article key={group.setupId} className="rounded border border-[#263b4c] bg-[#0b151f] p-2">
                <div className="flex items-center justify-between gap-2 border-b border-[#1d2c38] pb-1.5">
                  <div className="text-[10px] font-semibold text-[#dce7f0]">
                    SETUP {String(index + 1).padStart(2, "0")} · {group.events[0]?.instrumentId} · {group.events[0]?.timeframe}
                  </div>
                  <div className="text-[8px] text-[#748999] break-all">{group.setupId.slice(0, 20)}…</div>
                </div>
                <div className="space-y-1.5 pt-2">
                  {group.events.map((event) => (
                    <div key={event.id} className="grid grid-cols-[88px_94px_minmax(0,1fr)] gap-2 items-start text-[9px]">
                      <div className="tnum text-[#8193a3]">{utcTime(event.discoveredAtTs)}</div>
                      <div className={cn("font-bold tracking-wide", event.type === "TRIGGERED" ? "text-[#4bc39a]" : event.type === "INVALIDATED" ? "text-[#ef777d]" : event.type === "FORMING" ? "text-[#d5a85c]" : "text-[#9bb4c9]")}>
                        {event.type}
                        {!event.withinRequestedRange && <span className="block text-[7px] font-normal text-[#748999]">WARMUP CONTEXT</span>}
                      </div>
                      <div className="min-w-0">
                        <div className="text-[#c7d4de]">{event.reason}</div>
                        <div className="text-[8px] text-[#748999]">
                          occurred {utcTime(event.occurredAtTs)} · confirmed on bar {utcTime(event.confirmationBarTs)}
                        </div>
                        {event.evidence.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {event.evidence.map((item, evidenceIndex) => (
                              <span key={item.code + "-" + evidenceIndex} className="rounded border border-[#203444] bg-[#101d28] px-1.5 py-0.5 text-[8px] text-[#9eb2c3]">
                                {item.code}: {item.value ?? "—"}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </article>
            ))}
            <div className="text-[8px] text-[#687e90] break-all">
              REPLAY {result.runKey} · REVISION SHA256 {result.source.revisionHash}
            </div>
          </>
        ) : (
          <div className="rounded border border-dashed border-[#2a4051] bg-[#0b151f] p-5 text-center">
            <div className="text-[11px] font-semibold text-[#dce7f0]">Historical setup timeline is ready to scan</div>
            <p className="mx-auto mt-1 max-w-[760px] text-[10px] leading-relaxed text-[#8193a3]">
              Choose a verified local M1 dataset, choose a UTC calendar day and run the deterministic structure-break/retest scan. The chart above will show the closed candles and retrospective event markers for that day.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
