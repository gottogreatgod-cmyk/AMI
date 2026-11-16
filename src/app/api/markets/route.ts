import { NextResponse } from "next/server";
import { INSTRUMENTS, COVERAGE } from "@/lib/data/instruments";
import { cacheGet, cacheSet } from "@/lib/data/cache";
import { fetchBinanceTickers } from "@/lib/data/binance";
import { fetchYahooQuote } from "@/lib/data/yahoo";
import { providerHealth } from "@/lib/data/providers";
import { requireSession, serverError } from "@/lib/api";
import { TIMEFRAMES } from "@/lib/engine/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireSession();
  if (!guard.ok) return guard.res;
  try {
    const cached = cacheGet<{ markets: unknown[]; providers: unknown; fetchedAt: number }>("markets-data");
    if (cached) return NextResponse.json(cached);

    const binanceSymbols = INSTRUMENTS.filter((i) => i.provider === "binance").map((i) => i.providerSymbol);
    const yahooInstruments = INSTRUMENTS.filter((i) => i.provider === "yahoo");

    const [binanceTickers, yahooQuotes] = await Promise.all([
      fetchBinanceTickers(binanceSymbols).catch(() => ({})),
      Promise.all(yahooInstruments.map((i) => fetchYahooQuote(i.providerSymbol).catch(() => null))),
    ]);

    const markets = INSTRUMENTS.map((inst) => {
      let price: number | null = null;
      let changePct: number | null = null;
      let high24h: number | null = null;
      let low24h: number | null = null;
      let quoteVolume: number | null = null;
      let fresh = false;
      if (inst.provider === "binance") {
        const t = binanceTickers[inst.providerSymbol];
        if (t) {
          price = t.lastPrice;
          changePct = t.priceChangePercent;
          high24h = t.highPrice;
          low24h = t.lowPrice;
          quoteVolume = t.quoteVolume;
          fresh = true;
        }
      } else {
        const q = yahooQuotes[yahooInstruments.indexOf(inst)];
        if (q && q.price > 0) {
          price = q.price;
          changePct = q.prevClose > 0 ? ((q.price - q.prevClose) / q.prevClose) * 100 : null;
          fresh = true;
        }
      }
      const coverage: Record<string, { maxDays: number; note: string; source?: string }> = {};
      for (const tf of TIMEFRAMES) {
        const cov = COVERAGE[inst.provider][tf];
        if (cov) coverage[tf] = { maxDays: cov.maxDays, note: cov.note, source: cov.source };
      }
      return {
        symbol: inst.symbol,
        name: inst.name,
        assetClass: inst.assetClass,
        venue: inst.venue,
        provider: inst.provider,
        decimals: inst.decimals,
        session: inst.session,
        note: inst.note ?? null,
        costBpsPerSide: inst.feeBpsPerSide + inst.slipBpsPerSide,
        mmr: inst.mmr,
        price,
        changePct,
        high24h,
        low24h,
        quoteVolume,
        fresh,
        coverage,
      };
    });

    const data = { markets, providers: providerHealth(), fetchedAt: Date.now() };
    cacheSet("markets-data", data, 30_000);
    return NextResponse.json(data);
  } catch (e) {
    return serverError(e);
  }
}
