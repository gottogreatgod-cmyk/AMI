// ---------------------------------------------------------------------------
// Instrument registry — the one source of truth for what the workstation
// trades in research. Contract facts seeded from the AMI handoff package
// (spec/instrument-registry.proposal.json) and public exchange specs.
//
// IMPORTANT: futures roots (NQ/GC) are continuous front-month series on the
// Yahoo provider — research constructs only. Crypto venue costs are Binance
// spot taker fees; futures/forex costs are conservative all-in per-side
// spread+commission estimates in bps of notional.
// ---------------------------------------------------------------------------

import type { Timeframe } from "@/lib/engine/types";

export type AssetClass = "crypto" | "futures" | "forex" | "index";
export type SessionKind = "24/7" | "futures" | "forex" | "index" | "metals";

export interface Instrument {
  symbol: string; // canonical AMI id
  name: string;
  assetClass: AssetClass;
  venue: string;
  provider: "binance" | "yahoo";
  providerSymbol: string;
  /** typical significant digits for display */
  decimals: number;
  /** all-in cost per side (fee + slippage), bps of notional */
  feeBpsPerSide: number;
  slipBpsPerSide: number;
  /** maintenance margin ratio used by the liquidation model */
  mmr: number;
  session: SessionKind;
  note?: string;
}

export const INSTRUMENTS: Instrument[] = [
  // ---- Crypto (Binance spot public feed, 24/7) --------------------------
  {
    symbol: "BTCUSDT", name: "Bitcoin", assetClass: "crypto", venue: "Binance Spot",
    provider: "binance", providerSymbol: "BTCUSDT", decimals: 1,
    feeBpsPerSide: 4, slipBpsPerSide: 2, mmr: 0.005, session: "24/7",
  },
  {
    symbol: "ETHUSDT", name: "Ethereum", assetClass: "crypto", venue: "Binance Spot",
    provider: "binance", providerSymbol: "ETHUSDT", decimals: 2,
    feeBpsPerSide: 4, slipBpsPerSide: 2, mmr: 0.005, session: "24/7",
  },
  {
    symbol: "SOLUSDT", name: "Solana", assetClass: "crypto", venue: "Binance Spot",
    provider: "binance", providerSymbol: "SOLUSDT", decimals: 3,
    feeBpsPerSide: 4, slipBpsPerSide: 3, mmr: 0.005, session: "24/7",
  },
  {
    symbol: "BNBUSDT", name: "BNB", assetClass: "crypto", venue: "Binance Spot",
    provider: "binance", providerSymbol: "BNBUSDT", decimals: 2,
    feeBpsPerSide: 4, slipBpsPerSide: 2, mmr: 0.005, session: "24/7",
  },
  {
    symbol: "XRPUSDT", name: "XRP", assetClass: "crypto", venue: "Binance Spot",
    provider: "binance", providerSymbol: "XRPUSDT", decimals: 4,
    feeBpsPerSide: 4, slipBpsPerSide: 3, mmr: 0.005, session: "24/7",
  },
  {
    symbol: "DOGEUSDT", name: "Dogecoin", assetClass: "crypto", venue: "Binance Spot",
    provider: "binance", providerSymbol: "DOGEUSDT", decimals: 5,
    feeBpsPerSide: 4, slipBpsPerSide: 3, mmr: 0.005, session: "24/7",
  },
  {
    symbol: "AVAXUSDT", name: "Avalanche", assetClass: "crypto", venue: "Binance Spot",
    provider: "binance", providerSymbol: "AVAXUSDT", decimals: 3,
    feeBpsPerSide: 4, slipBpsPerSide: 3, mmr: 0.005, session: "24/7",
  },
  {
    symbol: "LINKUSDT", name: "Chainlink", assetClass: "crypto", venue: "Binance Spot",
    provider: "binance", providerSymbol: "LINKUSDT", decimals: 3,
    feeBpsPerSide: 4, slipBpsPerSide: 3, mmr: 0.005, session: "24/7",
  },
  {
    symbol: "SUIUSDT", name: "Sui", assetClass: "crypto", venue: "Binance Spot",
    provider: "binance", providerSymbol: "SUIUSDT", decimals: 4,
    feeBpsPerSide: 4, slipBpsPerSide: 3, mmr: 0.005, session: "24/7",
  },
  {
    symbol: "PAXGUSDT", name: "Gold (PAXG, spot-backed)", assetClass: "crypto", venue: "Binance Spot",
    provider: "binance", providerSymbol: "PAXGUSDT", decimals: 2,
    feeBpsPerSide: 4, slipBpsPerSide: 3, mmr: 0.005, session: "24/7",
    note: "PAXG is a 1:1 troy-ounce gold-backed token; 24/7 proxy for spot gold (XAU).",
  },

  // ---- Futures / index / FX (Yahoo public chart API) --------------------
  {
    symbol: "NQ=F", name: "E-mini Nasdaq-100 (continuous)", assetClass: "futures", venue: "CME (via Yahoo)",
    provider: "yahoo", providerSymbol: "NQ=F", decimals: 2,
    feeBpsPerSide: 0.5, slipBpsPerSide: 0.7, mmr: 0.01, session: "futures",
    note: "Continuous front-month research series — not a dated tradable contract. Contract facts (MNQ $2×index, NQ $20×index, 0.25pt tick) are seeded in docs; roll gaps exist.",
  },
  {
    symbol: "GC=F", name: "Gold futures (continuous)", assetClass: "futures", venue: "COMEX (via Yahoo)",
    provider: "yahoo", providerSymbol: "GC=F", decimals: 2,
    feeBpsPerSide: 0.5, slipBpsPerSide: 0.7, mmr: 0.01, session: "futures",
    note: "Continuous front-month research series. MGC = 10 oz, GC = 100 oz, 0.10/oz tick per CME spec.",
  },
  {
    symbol: "^VIX", name: "CBOE VIX Index", assetClass: "index", venue: "CBOE (via Yahoo)",
    provider: "yahoo", providerSymbol: "^VIX", decimals: 2,
    feeBpsPerSide: 2, slipBpsPerSide: 2, mmr: 0.02, session: "index",
    note: "Index, not tradable outright — used as a risk regime input and for research only.",
  },
  {
    symbol: "EURUSD=X", name: "EUR/USD spot", assetClass: "forex", venue: "FX spot (via Yahoo)",
    provider: "yahoo", providerSymbol: "EURUSD=X", decimals: 5,
    feeBpsPerSide: 0.6, slipBpsPerSide: 0.6, mmr: 0.005, session: "forex",
  },
  {
    symbol: "USDJPY=X", name: "USD/JPY spot", assetClass: "forex", venue: "FX spot (via Yahoo)",
    provider: "yahoo", providerSymbol: "USDJPY=X", decimals: 3,
    feeBpsPerSide: 0.7, slipBpsPerSide: 0.7, mmr: 0.005, session: "forex",
  },
];

export const INSTRUMENT_MAP: Record<string, Instrument> = Object.fromEntries(
  INSTRUMENTS.map((i) => [i.symbol, i])
);

export function getInstrument(symbol: string): Instrument | null {
  return INSTRUMENT_MAP[symbol] ?? null;
}

/**
 * Provider coverage per timeframe. Yahoo intraday history is bounded
 * (15m ≈ 60 days, 1h ≈ 730 days); Binance allows deep pagination.
 */
export const COVERAGE: Record<
  "binance" | "yahoo",
  Partial<Record<Timeframe, { maxDays: number; source?: Timeframe; note: string }>>
> = {
  binance: {
    "15m": { maxDays: 4000, note: "native 15m" },
    "45m": { maxDays: 4000, source: "15m", note: "aggregated from native 15m (causal; Binance has no 45m kline)" },
    "1h": { maxDays: 4000, note: "native 1h" },
    "3h": { maxDays: 4000, source: "1h", note: "aggregated from native 1h (causal)" },
    "4h": { maxDays: 4000, note: "native 4h" },
    "1d": { maxDays: 4000, note: "native 1d" },
    "1w": { maxDays: 4000, note: "native 1w" },
  },
  yahoo: {
    "15m": { maxDays: 60, note: "Yahoo 15m intraday cap ≈ 60 days" },
    "45m": { maxDays: 60, source: "15m", note: "aggregated from 15m (Yahoo cap ≈ 60 days)" },
    "1h": { maxDays: 730, note: "Yahoo 1h intraday cap ≈ 730 days" },
    "3h": { maxDays: 730, source: "1h", note: "aggregated from 1h (Yahoo cap ≈ 730 days)" },
    "4h": { maxDays: 730, source: "1h", note: "aggregated from 1h (Yahoo cap ≈ 730 days)" },
    "1d": { maxDays: 4000, note: "daily history" },
    "1w": { maxDays: 4000, note: "weekly history" },
  },
};

export const DEFAULT_MAX_BARS = 30_000;
/** 15m over 3 years ≈ 105k bars — allowed explicitly for the 3-year reruns. */
export const EXTENDED_MAX_BARS = 130_000;
