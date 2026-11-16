// ---------------------------------------------------------------------------
// In-memory TTL cache + provider-friendly concurrency limiter.
// Local memory only — no external cache middleware.
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  value: T;
  expires: number;
  weight: number; // approximate memory weight (bytes)
}

const store = new Map<string, CacheEntry<unknown>>();
const order: string[] = [];
const MAX_ENTRIES = 600;
/** Total memory budget for cached payloads (~350MB) — protects the dev
 *  server from OOM during deep-history campaigns (105k-bar 15m sets etc.). */
const MAX_TOTAL_WEIGHT = 350 * 1024 * 1024;
let totalWeight = 0;

export function cacheGet<T>(key: string): T | null {
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    store.delete(key);
    const i = order.indexOf(key);
    if (i >= 0) order.splice(i, 1);
    totalWeight -= hit.weight;
    return null;
  }
  return hit.value as T;
}

function evict(key: string) {
  const e = store.get(key);
  if (!e) return;
  store.delete(key);
  totalWeight -= e.weight;
  const i = order.indexOf(key);
  if (i >= 0) order.splice(i, 1);
}

export function cacheSet<T>(key: string, value: T, ttlMs: number, weightBytes = 4_096): void {
  if (store.has(key)) evict(key);
  // enforce both entry count and byte budget (FIFO eviction)
  while (order.length >= MAX_ENTRIES || (totalWeight + weightBytes > MAX_TOTAL_WEIGHT && order.length > 0)) {
    const drop = order.shift();
    if (drop) evict(drop);
    else break;
  }
  store.set(key, { value, expires: Date.now() + ttlMs, weight: weightBytes });
  order.push(key);
  totalWeight += weightBytes;
}

export function cacheStats() {
  return {
    entries: store.size,
    maxEntries: MAX_ENTRIES,
    approxBytesMB: Math.round(totalWeight / 1024 / 1024),
  };
}

// ---------------------------------------------------------------------------
// Concurrency limiter — keeps public exchange APIs happy
// ---------------------------------------------------------------------------

export class Limiter {
  private active = 0;
  private queue: Array<() => void> = [];

  constructor(private max: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      const next = this.queue.shift();
      if (next) next();
    }
  }

  get inFlight() {
    return this.active;
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
