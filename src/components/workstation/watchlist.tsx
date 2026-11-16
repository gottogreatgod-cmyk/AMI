"use client";

import { ASSET_CLASS_LABEL, fmtPct, fmtPrice, pnlClass } from "./hooks";
import { Search } from "lucide-react";
import { useMemo, useState } from "react";

export interface MarketRow {
  symbol: string;
  name: string;
  assetClass: string;
  venue: string;
  session: string;
  decimals: number;
  price: number | null;
  changePct: number | null;
  fresh: boolean;
  costBpsPerSide: number;
  note?: string | null;
}

export function Watchlist({
  markets,
  focusSymbol,
  onFocus,
  loading,
}: {
  markets: MarketRow[];
  focusSymbol: string;
  onFocus: (symbol: string) => void;
  loading: boolean;
}) {
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const filtered = markets.filter(
      (m) =>
        !query ||
        m.symbol.toLowerCase().includes(query.toLowerCase()) ||
        m.name.toLowerCase().includes(query.toLowerCase())
    );
    const byClass = new Map<string, MarketRow[]>();
    for (const m of filtered) {
      const key = m.assetClass;
      if (!byClass.has(key)) byClass.set(key, []);
      byClass.get(key)!.push(m);
    }
    return [...byClass.entries()].sort((a, b) => classOrder(a[0]) - classOrder(b[0]));
  }, [markets, query]);

  return (
    <aside className="panel flex flex-col min-h-0 overflow-hidden" aria-label="Market watch">
      <div className="panel-head">
        <span>MARKET WATCH</span>
        <span className="text-[#687e90] font-normal">{loading ? "…" : `${markets.length}`}</span>
      </div>
      <div className="px-2.5 py-2 border-b border-[#1f303d]">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-[#687e90]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter…"
            aria-label="Filter markets"
            className="w-full h-7 bg-[#0a121a] border border-[#223546] rounded-md pl-8 pr-2 text-[11px] outline-none focus:border-[#3a5268]"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto ami-scroll">
        {groups.map(([cls, rows]) => (
          <div key={cls}>
            <div className="px-2.5 pt-2.5 pb-1 text-[9px] tracking-[0.12em] text-[#687e90]">
              {ASSET_CLASS_LABEL[cls] ?? cls.toUpperCase()}
            </div>
            {rows.map((m) => {
              const selected = m.symbol === focusSymbol;
              return (
                <button
                  key={m.symbol}
                  onClick={() => onFocus(m.symbol)}
                  className={`w-full grid grid-cols-[8px_1fr_auto] gap-2 items-center px-2.5 py-2 text-left border-l-2 transition-colors ${
                    selected
                      ? "bg-[#152330] border-l-[#73a8e8]"
                      : "border-l-transparent hover:bg-[#0f1a26]"
                  }`}
                  title={m.note ?? `${m.name} · ${m.venue}`}
                >
                  <i
                    className={`w-1.5 h-1.5 rounded-full ${
                      !m.fresh ? "bg-[#687887]" : m.session === "24/7" ? "bg-[#4bc39a]" : "bg-[#e7b86d]"
                    }`}
                    aria-hidden
                  />
                  <span className="min-w-0">
                    <span className="block text-[11px] font-bold truncate">{m.symbol}</span>
                    <span className="block text-[9px] text-[#8193a3] truncate">{m.name}</span>
                  </span>
                  <span className="text-right">
                    <span className="block text-[10px] tnum">
                      {m.price != null ? fmtPrice(m.price, Math.min(m.decimals, 2)) : "—"}
                    </span>
                    <span className={`block text-[9px] tnum ${pnlClass(m.changePct)}`}>
                      {m.fresh ? fmtPct(m.changePct, 2) : "stale"}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        ))}
        {markets.length === 0 && (
          <div className="p-3 text-[10px] text-[#687e90]">
            {loading ? "Loading live quotes…" : "No markets match the filter."}
          </div>
        )}
      </div>
      <div className="border-t border-[#1f303d] p-2.5 text-[9px] text-[#687e90] leading-relaxed">
        NQ=F / GC=F are continuous front-month research series — not dated contracts. Costs: crypto
        6 bps/side all-in, futures/FX ~1.2 bps/side.
      </div>
    </aside>
  );
}

function classOrder(c: string): number {
  return { crypto: 0, futures: 1, index: 2, forex: 3 }[c] ?? 9;
}
