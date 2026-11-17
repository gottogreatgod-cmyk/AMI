"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  createSeriesMarkers,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type UTCTimestamp,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import type { Bar } from "@/lib/engine/types";

export interface ChartMarker {
  time: number; // ms epoch
  position: "aboveBar" | "belowBar";
  color: string;
  shape: "arrowUp" | "arrowDown" | "circle";
  text: string;
}

const THEME = {
  background: { type: ColorType.Solid, color: "transparent" },
  textColor: "#8193a3",
  grid: {
    vertLines: { color: "#152230" },
    horzLines: { color: "#152230" },
  },
  borderVisible: false,
  crosshair: {
    mode: CrosshairMode.Normal,
    vertLine: { color: "#3a5268", labelBackgroundColor: "#1b3347" },
    horzLine: { color: "#3a5268", labelBackgroundColor: "#1b3347" },
  },
  rightPriceScale: { borderColor: "#1f303d" },
  timeScale: { borderColor: "#1f303d", timeVisible: true, secondsVisible: false },
};

function normalizeBars(input: Bar[]): Bar[] {
  const sorted = [...input]
    .filter((bar) =>
      [bar.t, bar.ct, bar.o, bar.h, bar.l, bar.c, bar.v].every(Number.isFinite) &&
      bar.t > 0 && bar.ct >= bar.t && bar.o > 0 && bar.h > 0 && bar.l > 0 &&
      bar.c > 0 && bar.v >= 0 &&
      bar.h >= Math.max(bar.o, bar.c, bar.l) &&
      bar.l <= Math.min(bar.o, bar.c, bar.h)
    )
    .sort((a, b) => a.t - b.t);

  // Lightweight Charts requires strictly ascending, unique timestamps.
  const byTime = new Map<number, Bar>();
  for (const bar of sorted) byTime.set(bar.t, bar);
  return [...byTime.values()];
}

export function MiniChart({
  bars,
  markers,
  height,
  decimals = 2,
  chartId,
}: {
  bars: Bar[];
  markers?: ChartMarker[];
  height?: number | string;
  decimals?: number;
  chartId?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const markersRef = useRef<ReturnType<typeof createSeriesMarkers<Time>> | null>(null);
  const hasFitContentRef = useRef(false);
  const [ready, setReady] = useState(false);

  // create once
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const chart = createChart(el, {
      ...THEME,
      width: Math.max(1, Math.floor(rect.width || el.clientWidth || 1)),
      height: Math.max(1, Math.floor(rect.height || el.clientHeight || 160)),
    });
    const candle = chart.addSeries(CandlestickSeries, {
      upColor: "#4bc39a",
      downColor: "#ef777d",
      borderUpColor: "#4bc39a",
      borderDownColor: "#ef777d",
      wickUpColor: "#4bc39a",
      wickDownColor: "#ef777d",
      priceFormat: { type: "price", precision: decimals, minMove: Math.pow(10, -decimals) },
    });
    const volume = chart.addSeries(HistogramSeries, {
      color: "#4bc39a55",
      priceScaleId: "vol",
      priceFormat: { type: "volume" },
    });
    chart.priceScale("vol").applyOptions({ scaleMargins: { top: 0.85, bottom: 0 } });
    markersRef.current = createSeriesMarkers(candle, []);
    hasFitContentRef.current = false;
    chartRef.current = chart;
    candleRef.current = candle;
    volumeRef.current = volume;

    const resize = (width: number, h: number) => {
      if (width > 0 && h > 0) {
        chart.applyOptions({ width: Math.max(1, Math.floor(width)), height: Math.max(1, Math.floor(h)) });
      }
    };
    let ro: ResizeObserver | null = null;
    const onWindowResize = () => {
      const bounds = el.getBoundingClientRect();
      resize(bounds.width, bounds.height);
    };
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver((entries) => {
        const bounds = entries[0]?.contentRect;
        if (bounds) resize(bounds.width, bounds.height);
      });
      ro.observe(el);
    } else {
      window.addEventListener("resize", onWindowResize);
    }
    // notify the data effect after the chart exists (deferred — keeps the
    // effect body free of synchronous setState)
    queueMicrotask(() => setReady(true));
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", onWindowResize);
      chart.remove();
      hasFitContentRef.current = false;
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      markersRef.current = null;
    };
  }, []);

  useEffect(() => {
    const candle = candleRef.current;
    const volume = volumeRef.current;
    if (!candle || !volume || !ready) return;
    const normalized = normalizeBars(bars);
    const candleData: CandlestickData[] = normalized.map((b) => ({
      time: (b.t / 1000) as UTCTimestamp,
      open: b.o,
      high: b.h,
      low: b.l,
      close: b.c,
    }));
    const volumeData: HistogramData[] = normalized.map((b) => ({
      time: (b.t / 1000) as UTCTimestamp,
      value: b.v,
      color: b.c >= b.o ? "#4bc39a55" : "#ef777d55",
    }));
    // Always clear as well as replace: empty/error responses must not leave
    // another symbol's old candles rendered in this chart.
    candle.setData(candleData);
    volume.setData(volumeData);
    if (candleData.length > 0 && !hasFitContentRef.current) {
      chartRef.current?.timeScale().fitContent();
      hasFitContentRef.current = true;
    }
    if (candleData.length === 0) hasFitContentRef.current = false;

    if (markers && markers.length > 0 && markersRef.current) {
      const sorted = [...markers]
        .filter((marker) => Number.isFinite(marker.time))
        .sort((a, b) => a.time - b.time);
      const seriesMarkers: SeriesMarker<Time>[] = sorted.map((m) => ({
        time: (m.time / 1000) as UTCTimestamp,
        position: m.position,
        color: m.color,
        shape: m.shape,
        text: m.text,
      }));
      markersRef.current.setMarkers(seriesMarkers);
    } else if (markersRef.current) {
      markersRef.current.setMarkers([]);
    }
  }, [bars, markers, ready]);

  return (
    <div className="relative w-full h-full min-h-[160px]" data-chart={chartId ?? "mini"}>
      <div ref={containerRef} className="absolute inset-0" />
      {bars.length === 0 && (
        <div className="absolute inset-0 grid place-items-center text-[10px] text-[#687e90] pointer-events-none">
          waiting for closed bars…
        </div>
      )}
    </div>
  );
}
