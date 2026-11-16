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
  const [ready, setReady] = useState(false);

  // create once
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const chart = createChart(el, {
      ...THEME,
      width: el.clientWidth,
      height: el.clientHeight,
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
    chartRef.current = chart;
    candleRef.current = candle;
    volumeRef.current = volume;

    const ro = new ResizeObserver((entries) => {
      const { width, height: h } = entries[0].target.getBoundingClientRect();
      chart.applyOptions({ width: Math.floor(width), height: Math.floor(h) });
    });
    ro.observe(el);
    // notify the data effect after the chart exists (deferred — keeps the
    // effect body free of synchronous setState)
    queueMicrotask(() => setReady(true));
    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      markersRef.current = null;
    };
  }, []);

  useEffect(() => {
    const candle = candleRef.current;
    const volume = volumeRef.current;
    if (!candle || !volume || bars.length === 0) return;
    const candleData: CandlestickData[] = bars.map((b) => ({
      time: (b.t / 1000) as UTCTimestamp,
      open: b.o,
      high: b.h,
      low: b.l,
      close: b.c,
    }));
    const volumeData: HistogramData[] = bars.map((b) => ({
      time: (b.t / 1000) as UTCTimestamp,
      value: b.v,
      color: b.c >= b.o ? "#4bc39a55" : "#ef777d55",
    }));
    candle.setData(candleData);
    volume.setData(volumeData);
    chartRef.current?.timeScale().fitContent();

    if (markers && markers.length > 0 && markersRef.current) {
      const sorted = [...markers].sort((a, b) => a.time - b.time);
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
        <div className="absolute inset-0 grid place-items-center text-[10px] text-[#687e90]">
          loading closed bars…
        </div>
      )}
    </div>
  );
}
