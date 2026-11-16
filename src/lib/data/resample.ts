import type { Bar, Timeframe } from "@/lib/engine/types";
import { TF_MS } from "@/lib/engine/types";

// ---------------------------------------------------------------------------
// Causal higher-timeframe aggregation.
//
// Source bars are bucketed by wall-clock boundaries aligned to the Unix epoch
// (floor(t / bucketMs)). A bucket bar becomes *available* at the close time of
// its LAST constituent source bar — never before. This is what makes gapped
// series (forex weekends, futures maintenance breaks) safe: a 3h bucket that
// only ever received 2 hours before the Friday close is emitted with the close
// of its 2nd hour, and no information from Monday is leaked into it.
// ---------------------------------------------------------------------------

export function resample(bars: Bar[], targetTf: Timeframe): Bar[] {
  if (bars.length === 0) return [];
  const bucketMs = TF_MS[targetTf];
  const out: Bar[] = [];
  let cur: Bar | null = null;
  let curBucket = -1;

  for (const b of bars) {
    const bucket = Math.floor(b.t / bucketMs);
    if (bucket !== curBucket) {
      if (cur) out.push(cur);
      curBucket = bucket;
      cur = {
        t: bucket * bucketMs,
        o: b.o,
        h: b.h,
        l: b.l,
        c: b.c,
        v: b.v,
        ct: b.ct,
      };
    } else if (cur) {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += b.v;
      cur.ct = b.ct;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Detect rough gaps: consecutive closed bars whose spacing exceeds 2× the TF. */
export function detectGaps(bars: Bar[], tf: Timeframe): number {
  const ms = TF_MS[tf];
  let gaps = 0;
  for (let i = 1; i < bars.length; i++) {
    if (bars[i].t - bars[i - 1].t > 2 * ms) gaps++;
  }
  return gaps;
}
