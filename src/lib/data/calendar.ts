import { cacheGet, cacheSet, sleep } from "./cache";

// ---------------------------------------------------------------------------
// Economic calendar — ForexFactory weekly JSON feed (public, no key).
// Provides: title, country, exact date-time with offset, impact, forecast,
// previous. Used by the analyst briefing + confluence engine.
//
// Resilience: 429-aware retry with backoff, and stale-while-error serving —
// if the feed rate-limits us, the last good calendar is served (flagged)
// rather than silently degrading to "no events".
// ---------------------------------------------------------------------------

export interface CalendarEvent {
  id: string;
  title: string;
  country: string;
  date: string; // ISO with offset, as published
  ts: number; // UTC epoch ms
  impact: "High" | "Medium" | "Low" | "Holiday";
  forecast: string;
  previous: string;
}

export interface CalendarPayload {
  events: CalendarEvent[];
  fetchedAt: number;
  source: string;
  stale?: boolean;
}

const FEED_URL = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
const TTL = 15 * 60_000; // feed is weekly; 15 minutes is plenty and kind to it
let lastGood: CalendarPayload | null = null;

function normalize(raw: Array<Record<string, unknown>>): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const e of raw ?? []) {
    const date = typeof e.date === "string" ? e.date : "";
    const ts = date ? Date.parse(date) : NaN;
    if (Number.isNaN(ts)) continue;
    const impactRaw = typeof e.impact === "string" ? e.impact : "Low";
    const impact =
      impactRaw === "High" || impactRaw === "Medium" || impactRaw === "Low" ? impactRaw : "Holiday";
    out.push({
      id: `${ts}-${String(e.title ?? "").slice(0, 40)}`,
      title: String(e.title ?? ""),
      country: String(e.country ?? ""),
      date,
      ts,
      impact,
      forecast: String(e.forecast ?? ""),
      previous: String(e.previous ?? ""),
    });
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

export async function getCalendar(): Promise<CalendarPayload> {
  const cached = cacheGet<CalendarPayload>("calendar");
  if (cached) return cached;

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(FEED_URL, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(12_000),
      });
      if (res.status === 429 || res.status === 503) {
        await sleep(2500 * (attempt + 1));
        continue;
      }
      if (!res.ok) throw new Error(`Calendar HTTP ${res.status}`);
      const raw = (await res.json()) as Array<Record<string, unknown>>;
      const payload: CalendarPayload = {
        events: normalize(raw),
        fetchedAt: Date.now(),
        source: FEED_URL,
      };
      lastGood = payload;
      cacheSet("calendar", payload, TTL);
      return payload;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      await sleep(1500 * (attempt + 1));
    }
  }

  // stale-while-error: serve the last good calendar (flagged) within 24h
  if (lastGood && Date.now() - lastGood.fetchedAt < 24 * 3_600_000) {
    return { ...lastGood, stale: true };
  }
  throw lastErr ?? new Error("calendar unavailable");
}
