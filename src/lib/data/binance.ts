import type { Bar, Timeframe } from "@/lib/engine/types";
import { Limiter, sleep } from "./cache";

// ---------------------------------------------------------------------------
// Binance spot public REST adapter (no key, read-only).
// Klines are paginated 1000/request. Only CLOSED bars are returned: a forming
// candle is dropped because its close time is still in the future.
// ---------------------------------------------------------------------------

export const BINANCE_INTERVALS: Partial<Record<Timeframe, string>> = {
  "15m": "15m",
  "1h": "1h",
  "4h": "4h",
  "1d": "1d",
  "1w": "1w",
};

const BASES = ["https://api.binance.com", "https://api1.binance.com", "https://data-api.binance.vision"];
const limiter = new Limiter(6);

export const binanceStats = { requests: 0, retries: 0, last429: 0, lastError: "" };

async function fetchJson(url: string): Promise<unknown> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.status === 429 || res.status === 418) {
        binanceStats.last429 = Date.now();
        binanceStats.retries++;
        await sleep(1500 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
      return (await res.json()) as unknown;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      binanceStats.retries++;
      await sleep(600 * (attempt + 1));
    }
  }
  throw lastErr ?? new Error("Binance fetch failed");
}

type RawKline = [number, string, string, string, string, string, number, ...unknown[]];

/**
 * Fetch closed klines ending "now", going back `maxBars` bars.
 */
export async function fetchBinanceKlines(
  symbol: string,
  interval: Timeframe,
  maxBars: number,
  sinceMs?: number
): Promise<Bar[]> {
  const out: Bar[] = [];
  let startTime = sinceMs;
  const now = Date.now();

  while (out.length < maxBars) {
    const params = new URLSearchParams({
      symbol,
      interval: BINANCE_INTERVALS[interval] ?? interval,
      limit: String(Math.min(1000, maxBars - out.length)),
    });
    if (startTime) params.set("startTime", String(startTime));
    const base = BASES[out.length % BASES.length === 0 ? 0 : out.length % BASES.length % BASES.length];
    const url = `${base}/api/v3/klines?${params.toString()}`;
    const data = (await limiter.run(() => fetchJson(url))) as RawKline[];
    binanceStats.requests++;
    if (!Array.isArray(data) || data.length === 0) break;

    for (const k of data) {
      const closeTime = Number(k[6]);
      if (closeTime > now) continue; // forming candle — never used
      out.push({
        t: Number(k[0]),
        o: parseFloat(String(k[1])),
        h: parseFloat(String(k[2])),
        l: parseFloat(String(k[3])),
        c: parseFloat(String(k[4])),
        v: parseFloat(String(k[5])),
        ct: closeTime,
      });
    }
    const last = data[data.length - 1];
    const nextStart = Number(last[6]) + 1;
    if (data.length < 1000 || nextStart <= (startTime ?? 0) || nextStart > now) break;
    startTime = nextStart;
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

export interface BinanceTicker {
  symbol: string;
  lastPrice: number;
  priceChangePercent: number;
  quoteVolume: number;
  highPrice: number;
  lowPrice: number;
}

export async function fetchBinanceTickers(symbols: string[]): Promise<Record<string, BinanceTicker>> {
  if (symbols.length === 0) return {};
  const params = new URLSearchParams({ symbols: JSON.stringify(symbols) });
  const data = (await limiter.run(() =>
    fetchJson(`${BASES[0]}/api/v3/ticker/24hr?${params.toString()}`)
  )) as Array<{
    symbol: string;
    lastPrice: string;
    priceChangePercent: string;
    quoteVolume: string;
    highPrice: string;
    lowPrice: string;
  }>;
  binanceStats.requests++;
  const out: Record<string, BinanceTicker> = {};
  for (const t of data ?? []) {
    out[t.symbol] = {
      symbol: t.symbol,
      lastPrice: parseFloat(t.lastPrice),
      priceChangePercent: parseFloat(t.priceChangePercent),
      quoteVolume: parseFloat(t.quoteVolume),
      highPrice: parseFloat(t.highPrice),
      lowPrice: parseFloat(t.lowPrice),
    };
  }
  return out;
}
