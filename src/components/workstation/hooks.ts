"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";

// ---------------------------------------------------------------------------
// Workstation shared hooks & formatters
// ---------------------------------------------------------------------------

export function usePolling<T>(url: string | null, intervalMs: number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const urlRef = useRef(url);
  urlRef.current = url;

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;

    async function tick() {
      const u = urlRef.current;
      if (!u) {
        setLoading(false);
        return;
      }
      try {
        const res = await fetch(u, { cache: "no-store" });
        if (res.status === 401) {
          if (alive) setError("Session expired — reload to sign in again.");
          setLoading(false);
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as T;
        if (alive) {
          setData(json);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) {
          setLoading(false);
          timer = setTimeout(tick, intervalMs);
        }
      }
    }
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [url, intervalMs]);

  return { data, error, loading, refresh: () => setLoading(true) };
}

export function useAuthGate() {
  const { data: session, status } = useSession();
  return { session, status, ready: status !== "loading" };
}

// ---------------------------------------------------------------------------
// Formatters
// ---------------------------------------------------------------------------

export function fmtPrice(v: number | null | undefined, decimals = 2): string {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function fmtPct(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(v)) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

export function fmtCompact(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  if (Math.abs(v) >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (Math.abs(v) >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return v.toFixed(0);
}

export function fmtClock(d: Date = new Date()): string {
  return d.toLocaleTimeString("en-GB", { hour12: false });
}

export function fmtTime(ts: number | string | Date): string {
  const d = ts instanceof Date ? ts : new Date(ts);
  return d.toLocaleTimeString("en-GB", { hour12: false });
}

export function fmtDate(ts: number | string | Date): string {
  const d = ts instanceof Date ? ts : new Date(ts);
  return d.toLocaleDateString("en-GB", { month: "short", day: "numeric" });
}

export function fmtCountdown(ms: number): string {
  if (ms < 0) return "now";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function pnlClass(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v) || v === 0) return "text-foreground";
  return v > 0 ? "text-[#4bc39a]" : "text-[#ef777d]";
}

export function verdictColor(v: string): string {
  switch (v) {
    case "PASS":
      return "text-[#4bc39a] border-[#2b5c48] bg-[#123025]";
    case "WATCH":
      return "text-[#e7b86d] border-[#5c4a2b] bg-[#302719]";
    case "FAIL":
      return "text-[#ef777d] border-[#5c2b31] bg-[#301919]";
    default:
      return "text-[#8193a3] border-[#2b3e4d] bg-[#152330]";
  }
}

export const ASSET_CLASS_LABEL: Record<string, string> = {
  crypto: "CRYPTO · 24/7",
  futures: "FUTURES / INDEX · CME",
  forex: "FOREX · SPOT",
  index: "INDEX · CBOE",
};

/** Local timezone offset in minutes, as expected by the analyst API. */
export function localTzOffsetMin(): number {
  return -new Date().getTimezoneOffset();
}
