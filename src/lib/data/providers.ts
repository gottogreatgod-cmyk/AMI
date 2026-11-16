import type { Bar, DataQuality, Timeframe } from "@/lib/engine/types";
import { TF_MS } from "@/lib/engine/types";
import { cacheGet, cacheSet } from "./cache";
import { COVERAGE, DEFAULT_MAX_BARS, getInstrument } from "./instruments";
import { BINANCE_INTERVALS, binanceStats, fetchBinanceKlines } from "./binance";
import { YAHOO_INTERVALS, fetchYahooBars, yahooStats } from "./yahoo";
import { detectGaps, resample } from "./resample";

// ---------------------------------------------------------------------------
// Unified data plane: one entry point for every market + timeframe.
//
//   getBars(symbol, tf, { days, maxBars })
//
// Native intervals are used whenever the provider has them; 3h is causally
// aggregated from 1h everywhere; 45m from 15m on Yahoo; 4h from 1h on Yahoo.
// Results are cached in memory keyed by (symbol|tf|days|maxBars).
// ---------------------------------------------------------------------------

export interface BarsResult {
  bars: Bar[];
  quality: DataQuality;
}

export async function getBars(
  symbol: string,
  tf: Timeframe,
  opts: { days: number; maxBars?: number; noCache?: boolean }
): Promise<BarsResult> {
  const inst = getInstrument(symbol);
  if (!inst) throw new Error(`Unknown instrument ${symbol}`);

  const maxBars = opts.maxBars ?? DEFAULT_MAX_BARS;
  const cacheKey = `bars|${symbol}|${tf}|${opts.days}|${maxBars}`;
  const cached = opts.noCache ? null : cacheGet<BarsResult>(cacheKey);
  if (cached) return cached;

  const cov = COVERAGE[inst.provider][tf];
  if (!cov) throw new Error(`Timeframe ${tf} not supported for ${symbol}`);

  const now = Date.now();
  const effectiveDays = Math.min(opts.days, cov.maxDays);
  const sinceMs = now - effectiveDays * 86_400_000;
  let bars: Bar[] = [];
  let resampledFrom: Timeframe | null = null;

  if (inst.provider === "binance") {
    if (BINANCE_INTERVALS[tf]) {
      bars = await fetchBinanceKlines(inst.providerSymbol, tf, maxBars, sinceMs);
    } else {
      // 3h from native 1h (causal bucket aggregation)
      const srcTf: Timeframe = (cov.source ?? "1h") as Timeframe;
      resampledFrom = srcTf;
      const src = await fetchBinanceKlines(inst.providerSymbol, srcTf, maxBars * 4, sinceMs);
      bars = resample(src, tf);
    }
  } else {
    // yahoo
    if (YAHOO_INTERVALS[tf]) {
      const iv = YAHOO_INTERVALS[tf]!;
      bars = await fetchYahooBars(inst.providerSymbol, iv, sinceMs / 1000, now / 1000, TF_MS[tf]);
    } else {
      const srcTf = (cov.source ?? "1h") as Timeframe;
      resampledFrom = srcTf;
      const srcIv = YAHOO_INTERVALS[srcTf]!;
      const src = await fetchYahooBars(inst.providerSymbol, srcIv, sinceMs / 1000, now / 1000, TF_MS[srcTf]);
      bars = resample(src, tf);
    }
  }

  // enforce maxBars on the final series (keep the newest)
  if (bars.length > maxBars) bars = bars.slice(bars.length - maxBars);

  const first = bars[0];
  const last = bars[bars.length - 1];
  const coveredDays = first && last ? (last.ct - first.t) / 86_400_000 : 0;
  let coverage: DataQuality["coverage"] = "FULL";
  let note: string | undefined = cov.note;
  if (bars.length === 0) coverage = "INSUFFICIENT";
  else if (effectiveDays < opts.days) {
    coverage = "PROVIDER_LIMIT";
    note = `Provider intraday cap: ${cov.maxDays}d for ${tf}${cov.source ? ` (built from ${cov.source})` : ""}.`;
  } else if (coveredDays < opts.days * 0.85) {
    coverage = "PARTIAL";
    note = `Exchange holds ${Math.round(coveredDays)}d of ${tf} history (below requested ${opts.days}d).`;
  }

  const result: BarsResult = {
    bars,
    quality: {
      provider: inst.provider,
      providerSymbol: inst.providerSymbol,
      bars: bars.length,
      fromTs: first?.t ?? 0,
      toTs: last?.ct ?? 0,
      requestedDays: opts.days,
      coveredDays: Math.round(coveredDays),
      coverage,
      session: inst.session,
      resampledFrom,
      gapsDetected: detectGaps(bars, tf),
      fetchedAt: now,
      note,
    },
  };

  const ttl = opts.days <= 2 ? 60_000 : opts.days <= 400 ? 300_000 : 900_000;
  // weight ≈ 72 bytes per bar (JS object overhead) — keeps the shared cache
  // inside its memory budget during deep-history campaigns
  cacheSet(cacheKey, result, ttl, bars.length * 72 + 2_048);
  return result;
}

export function providerHealth() {
  return {
    binance: {
      requests: binanceStats.requests,
      retries: binanceStats.retries,
      last429: binanceStats.last429,
      lastError: binanceStats.lastError || null,
    },
    yahoo: {
      requests: yahooStats.requests,
      retries: yahooStats.retries,
      lastError: yahooStats.lastError || null,
    },
  };
}
