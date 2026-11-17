"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";

// ---------------------------------------------------------------------------
// Workstation shared hooks & formatters
// ---------------------------------------------------------------------------

export function usePolling<T>(url: string | null, intervalMs: number, refreshKey = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [localRefresh, setLocalRefresh] = useState(0);
  const refresh = useCallback(() => setLocalRefresh((value) => value + 1), []);

  useEffect(() => {
    let alive = true;
    let authExpired = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let activeController: AbortController | null = null;

    if (!url) {
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);

    async function tick() {
      if (!alive || authExpired) return;
      if (document.visibilityState === "hidden") {
        timer = setTimeout(() => void tick(), intervalMs);
        return;
      }

      const controller = new AbortController();
      activeController = controller;
      const timeout = setTimeout(() => controller.abort(), 15_000);

      try {
        const response = await fetch(url, { cache: "no-store", signal: controller.signal });
        if (response.status === 401) {
          authExpired = true;
          if (alive) setError("Session expired — reload to sign in again.");
          return;
        }
        if (!response.ok) throw new Error("HTTP " + response.status);
        const json = (await response.json()) as T;
        if (alive) {
          setData(json);
          setError(null);
        }
      } catch (cause) {
        if (alive) {
          const message = controller.signal.aborted
            ? "Request timed out after 15 seconds."
            : cause instanceof Error
              ? cause.message
              : String(cause);
          setError(message);
        }
      } finally {
        clearTimeout(timeout);
        if (activeController === controller) activeController = null;
        if (alive) {
          setLoading(false);
          if (!authExpired) timer = setTimeout(() => void tick(), intervalMs);
        }
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible" || !alive || authExpired) return;
      if (timer) clearTimeout(timer);
      activeController?.abort();
      void tick();
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    void tick();

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
      activeController?.abort();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [url, intervalMs, refreshKey, localRefresh]);

  return { data, error, loading, refresh };
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
