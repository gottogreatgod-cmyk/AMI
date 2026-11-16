import type { Bar, Timeframe } from "@/lib/engine/types";
import { Limiter, sleep } from "./cache";

// ---------------------------------------------------------------------------
// Yahoo Finance public chart API adapter (no key, read-only).
// Serves the futures/index/forex side of the workstation:
//   NQ=F (E-mini Nasdaq-100 continuous), GC=F (Gold continuous),
//   ^VIX, EURUSD=X, USDJPY=X.
// Intraday history is bounded by the provider: 15m ≈ 60d, 1h ≈ 730d.
// Only closed bars are returned (the final forming candle is dropped).
// ---------------------------------------------------------------------------

export const YAHOO_INTERVALS: Partial<Record<Timeframe, string>> = {
  "15m": "15m",
  "1h": "1h",
  "1d": "1d",
  "1w": "1wk",
};

export const YAHOO_MAX_DAYS: Partial<Record<Timeframe, number>> = {
  "15m": 60,
  "1h": 730,
  "1d": 4000,
  "1w": 4000,
};

const limiter = new Limiter(3);
export const yahooStats = { requests: 0, retries: 0, lastError: "" };

interface YahooResult {
  meta: {
    symbol: string;
    regularMarketPrice?: number;
    chartPreviousClose?: number;
    previousClose?: number;
  };
  timestamp?: number[];
  indicators: {
    quote: Array<{
      open?: (number | null)[];
      high?: (number | null)[];
      low?: (number | null)[];
      close?: (number | null)[];
      volume?: (number | null)[];
    }>;
  };
}

interface YahooChart {
  chart: {
    result?: YahooResult[];
    error?: { code?: string; description?: string } | null;
  };
}

async function fetchChart(symbol: string, interval: string, period1: number, period2: number): Promise<YahooResult> {
  const params = new URLSearchParams({
    interval,
    period1: String(Math.floor(period1)),
    period2: String(Math.floor(period2)),
    includePrePost: "false",
    events: "div,split",
  });
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${params.toString()}`;
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36",
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 429) {
        yahooStats.retries++;
        await sleep(1500 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`Yahoo HTTP ${res.status} for ${symbol}`);
      const json = (await res.json()) as YahooChart;
      const first = json.chart?.result?.[0];
      if (json.chart?.error || !first) {
        throw new Error(json.chart?.error?.description ?? `Yahoo empty result for ${symbol}`);
      }
      yahooStats.requests++;
      return first;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      yahooStats.retries++;
      await sleep(700 * (attempt + 1));
    }
  }
  throw lastErr ?? new Error("Yahoo fetch failed");
}

export async function fetchYahooBars(
  providerSymbol: string,
  yahooInterval: string,
  period1Sec: number,
  period2Sec: number,
  intervalMs: number
): Promise<Bar[]> {
  const result = await limiter.run(() => fetchChart(providerSymbol, yahooInterval, period1Sec, period2Sec));
  const ts = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0] ?? {};
  const bars: Bar[] = [];
  const now = Date.now();
  for (let i = 0; i < ts.length; i++) {
    const o = q.open?.[i];
    const h = q.high?.[i];
    const l = q.low?.[i];
    const c = q.close?.[i];
    if (o == null || h == null || l == null || c == null) continue;
    const t = ts[i] * 1000;
    const ct = t + intervalMs - 1;
    if (ct > now) continue; // forming candle
    bars.push({ t, o, h, l, c, v: q.volume?.[i] ?? 0, ct });
  }
  bars.sort((a, b) => a.t - b.t);
  return bars;
}

export interface YahooQuote {
  symbol: string;
  price: number;
  prevClose: number;
}

export async function fetchYahooQuote(providerSymbol: string): Promise<YahooQuote> {
  const nowSec = Math.floor(Date.now() / 1000);
  const result = await limiter.run(() =>
    fetchChart(providerSymbol, "1d", nowSec - 10 * 86400, nowSec)
  );
  const price = result.meta?.regularMarketPrice ?? 0;
  const prev = result.meta?.chartPreviousClose ?? result.meta?.previousClose ?? 0;
  return { symbol: providerSymbol, price, prevClose: prev };
}
