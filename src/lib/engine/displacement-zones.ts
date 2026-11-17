import type { Bar } from "./types";
import { atr } from "./indicators";

export type DisplacementZoneDirection = "DEMAND" | "SUPPLY";
export type DisplacementZoneStatus = "ACTIVE" | "TESTED" | "INVALIDATED";

export interface DisplacementZone {
  id: string;
  direction: DisplacementZoneDirection;
  status: DisplacementZoneStatus;
  /** Distal/proximal price bounds, always lower <= upper. */
  lower: number;
  upper: number;
  /** First bar in the compressed base cluster. */
  originStartTs: number;
  /** Close timestamp of the final base bar. */
  originEndTs: number;
  /** Close timestamp of the impulse bar that confirms the zone. */
  confirmedAtTs: number;
  /** Closed base bars used by the detector. */
  baseBars: number;
  /** ATR value on the closed impulse bar. */
  atrAtConfirmation: number;
  /** Absolute impulse candle body in price units. */
  impulseBody: number;
  /** Full base-cluster high/low width in price units. */
  baseRange: number;
  firstRetestTs: number | null;
  invalidatedTs: number | null;
  retestCount: number;
}

export interface DisplacementZoneOptions {
  atrPeriod?: number;
  baseBars?: number;
  minImpulseBodyAtr?: number;
  maxBaseRangeAtr?: number;
  maxZones?: number;
}

const DEFAULT_OPTIONS: Required<DisplacementZoneOptions> = {
  atrPeriod: 14,
  baseBars: 2,
  minImpulseBodyAtr: 1.0,
  maxBaseRangeAtr: 1.5,
  maxZones: 16,
};

function normalizeClosedBars(input: readonly Bar[]): Bar[] {
  const sorted = [...input]
    .filter((bar) =>
      [bar.t, bar.ct, bar.o, bar.h, bar.l, bar.c, bar.v].every(Number.isFinite) &&
      bar.t > 0 &&
      bar.ct >= bar.t &&
      bar.o > 0 &&
      bar.h > 0 &&
      bar.l > 0 &&
      bar.c > 0 &&
      bar.v >= 0 &&
      bar.h >= Math.max(bar.o, bar.c, bar.l) &&
      bar.l <= Math.min(bar.o, bar.c, bar.h)
    )
    .sort((a, b) => a.t - b.t);

  const byTimestamp = new Map<number, Bar>();
  for (const bar of sorted) byTimestamp.set(bar.t, bar);
  return [...byTimestamp.values()];
}

function resolveOptions(options: DisplacementZoneOptions): Required<DisplacementZoneOptions> | null {
  const resolved = { ...DEFAULT_OPTIONS, ...options };
  if (
    !Number.isInteger(resolved.atrPeriod) || resolved.atrPeriod < 2 ||
    !Number.isInteger(resolved.baseBars) || resolved.baseBars < 1 || resolved.baseBars > 4 ||
    !Number.isFinite(resolved.minImpulseBodyAtr) || resolved.minImpulseBodyAtr <= 0 ||
    !Number.isFinite(resolved.maxBaseRangeAtr) || resolved.maxBaseRangeAtr <= 0 ||
    !Number.isInteger(resolved.maxZones) || resolved.maxZones < 1 || resolved.maxZones > 100
  ) {
    return null;
  }
  return resolved;
}

/**
 * Detects mechanical displacement-origin zones from closed bars.
 *
 * A zone is only created after:
 * 1. a fixed-size base cluster has a range no larger than maxBaseRangeAtr * ATR;
 * 2. the following closed candle has a body at least minImpulseBodyAtr * ATR;
 * 3. that candle closes above the base high (DEMAND) or below the base low (SUPPLY).
 *
 * Demand bounds are [lowest base wick, highest base body]. Supply bounds are
 * [lowest base body, highest base wick]. The detector does not use future bars
 * to decide when a zone exists. Subsequent closed bars only update its
 * retest/invalidation lifecycle.
 *
 * These are research heuristics, not evidence of institutional orders.
 */
export function buildDisplacementZones(
  input: readonly Bar[],
  options: DisplacementZoneOptions = {}
): DisplacementZone[] {
  const config = resolveOptions(options);
  if (!config) return [];

  const bars = normalizeClosedBars(input);
  if (bars.length < config.atrPeriod + config.baseBars) return [];

  const atrValues = atr(bars, config.atrPeriod);
  const zones: DisplacementZone[] = [];

  for (let index = config.atrPeriod; index < bars.length; index++) {
    const impulse = bars[index];
    const atrValue = atrValues[index];
    if (!Number.isFinite(atrValue) || atrValue <= 0) continue;

    const base = bars.slice(index - config.baseBars, index);
    if (base.length !== config.baseBars) continue;

    const baseHigh = Math.max(...base.map((bar) => bar.h));
    const baseLow = Math.min(...base.map((bar) => bar.l));
    const baseRange = baseHigh - baseLow;
    if (baseRange > config.maxBaseRangeAtr * atrValue) continue;

    const impulseBody = Math.abs(impulse.c - impulse.o);
    if (impulseBody < config.minImpulseBodyAtr * atrValue) continue;

    const direction: DisplacementZoneDirection | null =
      impulse.c > impulse.o && impulse.c > baseHigh
        ? "DEMAND"
        : impulse.c < impulse.o && impulse.c < baseLow
          ? "SUPPLY"
          : null;
    if (!direction) continue;

    const baseBodyHigh = Math.max(...base.map((bar) => Math.max(bar.o, bar.c)));
    const baseBodyLow = Math.min(...base.map((bar) => Math.min(bar.o, bar.c)));
    const lower = direction === "DEMAND" ? baseLow : baseBodyLow;
    const upper = direction === "DEMAND" ? baseBodyHigh : baseHigh;
    if (!Number.isFinite(lower) || !Number.isFinite(upper) || upper <= lower) continue;

    const zone: DisplacementZone = {
      id: direction.toLowerCase() + "-" + base[0].t + "-" + impulse.ct,
      direction,
      status: "ACTIVE",
      lower,
      upper,
      originStartTs: base[0].t,
      originEndTs: base[base.length - 1].ct,
      confirmedAtTs: impulse.ct,
      baseBars: config.baseBars,
      atrAtConfirmation: atrValue,
      impulseBody,
      baseRange,
      firstRetestTs: null,
      invalidatedTs: null,
      retestCount: 0,
    };

    let wasIntersecting = false;
    for (let futureIndex = index + 1; futureIndex < bars.length; futureIndex++) {
      const future = bars[futureIndex];
      const invalidated =
        direction === "DEMAND"
          ? future.c < zone.lower
          : future.c > zone.upper;

      if (invalidated) {
        zone.status = "INVALIDATED";
        zone.invalidatedTs = future.ct;
        break;
      }

      const intersects = future.l <= zone.upper && future.h >= zone.lower;
      if (intersects && !wasIntersecting) {
        zone.retestCount++;
        if (zone.firstRetestTs === null) zone.firstRetestTs = future.ct;
        zone.status = "TESTED";
      }
      wasIntersecting = intersects;
    }

    zones.push(zone);
    if (zones.length > config.maxZones) zones.shift();
  }

  return zones;
}
