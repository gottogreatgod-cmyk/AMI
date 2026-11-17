export type MonitorTimeframe = "m1" | "m5" | "m15" | "m30" | "h1" | "h4" | "d1";

export const MONITOR_TIMEFRAME_MS: Record<MonitorTimeframe, number> = {
  m1: 60_000,
  m5: 5 * 60_000,
  m15: 15 * 60_000,
  m30: 30 * 60_000,
  h1: 60 * 60_000,
  h4: 4 * 60 * 60_000,
  d1: 24 * 60 * 60_000,
};

export interface MonitorBar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number | null;
  ct: number;
  forming: boolean;
}

export interface MonitorTick {
  timestamp: number;
  bid: number;
  ask: number;
  bidVolume: number | null;
  askVolume: number | null;
  spread: number | null;
  spreadBps: number | null;
}

function finite(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rowValues(row: unknown): {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
} | null {
  if (Array.isArray(row)) {
    const [timestamp, open, high, low, close, volume] = row;
    const values = [timestamp, open, high, low, close].map(finite);
    if (values.some((value) => value === null)) return null;
    return {
      timestamp: values[0]!,
      open: values[1]!,
      high: values[2]!,
      low: values[3]!,
      close: values[4]!,
      volume: finite(volume),
    };
  }
  if (!row || typeof row !== "object") return null;
  const source = row as Record<string, unknown>;
  const values = [
    source.timestamp ?? source.t,
    source.open ?? source.o,
    source.high ?? source.h,
    source.low ?? source.l,
    source.close ?? source.c,
  ].map(finite);
  if (values.some((value) => value === null)) return null;
  return {
    timestamp: values[0]!,
    open: values[1]!,
    high: values[2]!,
    low: values[3]!,
    close: values[4]!,
    volume: finite(source.volume ?? source.v),
  };
}

/** Normalize the library's JSON candle response without creating synthetic bars or mid OHLC. */
export function normalizeMonitorCandles(
  input: unknown,
  timeframeMs: number,
  now = Date.now()
): { bars: MonitorBar[]; closedBars: MonitorBar[]; formingBar: MonitorBar | null } {
  if (!Number.isFinite(timeframeMs) || timeframeMs <= 0) {
    return { bars: [], closedBars: [], formingBar: null };
  }
  const sourceRows = Array.isArray(input) ? input : [];
  const valid = sourceRows
    .map(rowValues)
    .filter((row): row is NonNullable<typeof row> => row !== null)
    .filter((row) =>
      Number.isInteger(row.timestamp) &&
      row.timestamp > 0 &&
      row.timestamp <= now &&
      row.open > 0 &&
      row.high > 0 &&
      row.low > 0 &&
      row.close > 0 &&
      row.high >= Math.max(row.open, row.close, row.low) &&
      row.low <= Math.min(row.open, row.close, row.high) &&
      (row.volume === null || row.volume >= 0)
    )
    .sort((a, b) => a.timestamp - b.timestamp);

  const byTimestamp = new Map<number, MonitorBar>();
  for (const row of valid) {
    const ct = row.timestamp + timeframeMs - 1;
    byTimestamp.set(row.timestamp, {
      t: row.timestamp,
      o: row.open,
      h: row.high,
      l: row.low,
      c: row.close,
      v: row.volume,
      ct,
      forming: ct > now,
    });
  }

  const bars = [...byTimestamp.values()];
  const closedBars = bars.filter((bar) => !bar.forming);
  const formingBar = bars.findLast((bar) => bar.forming) ?? null;
  return { bars, closedBars, formingBar };
}

/** Normalize the latest two-sided quote. No trade or OHLC is inferred from a tick. */
export function normalizeMonitorTick(
  input: unknown,
  now = Date.now(),
  maxFutureSkewMs = 10_000
): MonitorTick | null {
  if (!Number.isFinite(now) || !Number.isFinite(maxFutureSkewMs) || maxFutureSkewMs < 0) {
    return null;
  }
  if (!Array.isArray(input)) return null;
  const rows = input
    .map((row) => {
      if (Array.isArray(row)) {
        const [timestamp, ask, bid, askVolume, bidVolume] = row;
        return {
          timestamp: finite(timestamp),
          ask: finite(ask),
          bid: finite(bid),
          askVolume: finite(askVolume),
          bidVolume: finite(bidVolume),
        };
      }
      if (!row || typeof row !== "object") return null;
      const source = row as Record<string, unknown>;
      return {
        timestamp: finite(source.timestamp),
        ask: finite(source.askPrice ?? source.ask),
        bid: finite(source.bidPrice ?? source.bid),
        askVolume: finite(source.askVolume),
        bidVolume: finite(source.bidVolume),
      };
    })
    .filter((row): row is NonNullable<typeof row> =>
      row !== null &&
      row.timestamp !== null &&
      row.ask !== null &&
      row.bid !== null &&
      row.timestamp > 0 &&
      row.timestamp <= now + maxFutureSkewMs &&
      row.ask > 0 &&
      row.bid > 0 &&
      row.ask >= row.bid
    )
    .sort((a, b) => a.timestamp! - b.timestamp!);

  const last = rows[rows.length - 1];
  if (!last || last.timestamp === null || last.ask === null || last.bid === null) return null;
  const mid = (last.ask + last.bid) / 2;
  const spread = last.ask - last.bid;
  return {
    timestamp: last.timestamp,
    bid: last.bid,
    ask: last.ask,
    bidVolume: last.bidVolume,
    askVolume: last.askVolume,
    spread,
    spreadBps: mid > 0 ? (spread / mid) * 10_000 : null,
  };
}

export function classifyMonitorFreshness(
  tick: MonitorTick | null,
  now: number,
  staleAfterMs: number
): { state: "NO_TICK" | "FRESH" | "STALE"; ageMs: number | null } {
  if (!tick) return { state: "NO_TICK", ageMs: null };
  const ageMs = Math.max(0, now - tick.timestamp);
  return {
    state: ageMs <= staleAfterMs ? "FRESH" : "STALE",
    ageMs,
  };
}
