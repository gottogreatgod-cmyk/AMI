// ---------------------------------------------------------------------------
// Indicators — causal by construction. Every series value at index i is a
// function of bars[0..i] only. No lookahead, no centering, no repainting.
// NaN arrays are used during warmup; callers must respect warmup bounds.
// ---------------------------------------------------------------------------

import type { Bar } from "./types";

export function sma(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (values.length === 0) return out;
  const k = 2 / (period + 1);
  let prev = NaN;
  for (let i = 0; i < values.length; i++) {
    if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += values[j];
      prev = sum / period;
      out[i] = prev;
    } else if (i >= period) {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

/** Wilder ATR — the unified stop unit across every strategy. */
export function atr(bars: Bar[], period: number): number[] {
  const out = new Array<number>(bars.length).fill(NaN);
  if (bars.length === 0) return out;
  const tr: number[] = new Array(bars.length).fill(0);
  tr[0] = bars[0].h - bars[0].l;
  for (let i = 1; i < bars.length; i++) {
    tr[i] = Math.max(
      bars[i].h - bars[i].l,
      Math.abs(bars[i].h - bars[i - 1].c),
      Math.abs(bars[i].l - bars[i - 1].c)
    );
  }
  let prev = NaN;
  for (let i = 0; i < bars.length; i++) {
    if (i === period - 1) {
      let sum = 0;
      for (let j = 0; j < period; j++) sum += tr[j];
      prev = sum / period;
      out[i] = prev;
    } else if (i >= period) {
      prev = (prev * (period - 1) + tr[i]) / period;
      out[i] = prev;
    }
  }
  return out;
}

export function rsi(values: number[], period: number): number[] {
  const out = new Array<number>(values.length).fill(NaN);
  if (values.length < period + 1) return out;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    avgGain += Math.max(d, 0);
    avgLoss += Math.max(-d, 0);
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export interface DonchianSeries {
  upper: number[]; // highest high of previous `period` bars (shifted 1)
  lower: number[]; // lowest low of previous `period` bars (shifted 1)
  mid: number[];
}

/** Channel over bars [i-period, i-1] — shifted so bar i can "break" it. */
export function donchian(bars: Bar[], period: number): DonchianSeries {
  const n = bars.length;
  const upper = new Array<number>(n).fill(NaN);
  const lower = new Array<number>(n).fill(NaN);
  const mid = new Array<number>(n).fill(NaN);
  for (let i = period; i < n; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - period; j < i; j++) {
      if (bars[j].h > hi) hi = bars[j].h;
      if (bars[j].l < lo) lo = bars[j].l;
    }
    upper[i] = hi;
    lower[i] = lo;
    mid[i] = (hi + lo) / 2;
  }
  return { upper, lower, mid };
}

export interface BollingerSeries {
  upper: number[];
  lower: number[];
  mid: number[];
}

export function bollinger(values: number[], period: number, stdMult: number): BollingerSeries {
  const mid = sma(values, period);
  const upper = new Array<number>(values.length).fill(NaN);
  const lower = new Array<number>(values.length).fill(NaN);
  for (let i = period - 1; i < values.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += (values[j] - mid[i]) ** 2;
    const sd = Math.sqrt(sum / period);
    upper[i] = mid[i] + stdMult * sd;
    lower[i] = mid[i] - stdMult * sd;
  }
  return { upper, lower, mid };
}

/** Wilder ADX — trend strength for regime filters. */
export function adx(bars: Bar[], period: number): number[] {
  const n = bars.length;
  const out = new Array<number>(n).fill(NaN);
  if (n < 2 * period) return out;
  const plusDM: number[] = new Array(n).fill(0);
  const minusDM: number[] = new Array(n).fill(0);
  const tr: number[] = new Array(n).fill(0);
  tr[0] = bars[0].h - bars[0].l;
  for (let i = 1; i < n; i++) {
    const up = bars[i].h - bars[i - 1].h;
    const down = bars[i - 1].l - bars[i].l;
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
    tr[i] = Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - bars[i - 1].c), Math.abs(bars[i].l - bars[i - 1].c));
  }
  let smTR = 0;
  let smP = 0;
  let smM = 0;
  for (let i = 1; i <= period; i++) {
    smTR += tr[i];
    smP += plusDM[i];
    smM += minusDM[i];
  }
  const dxs: number[] = [];
  let adxVal = NaN;
  for (let i = period + 1; i < n; i++) {
    smTR = smTR - smTR / period + tr[i];
    smP = smP - smP / period + plusDM[i];
    smM = smM - smM / period + minusDM[i];
    const pdi = smTR === 0 ? 0 : (100 * smP) / smTR;
    const mdi = smTR === 0 ? 0 : (100 * smM) / smTR;
    const dx = pdi + mdi === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / (pdi + mdi);
    dxs.push(dx);
    if (dxs.length === period) {
      adxVal = dxs.reduce((a, b) => a + b, 0) / period;
    } else if (dxs.length > period) {
      adxVal = (adxVal * (period - 1) + dx) / period;
    }
    out[i] = adxVal;
  }
  return out;
}

/** Annualization factor from bar spacing. */
export function barsPerYear(bars: Bar[]): number {
  if (bars.length < 3) return 252;
  const spanMs = bars[bars.length - 1].ct - bars[0].t;
  const perYear = (bars.length / spanMs) * 365 * 86_400_000;
  return Math.max(1, perYear);
}

/** Realized volatility (std of log returns, annualized). */
export function realizedVol(bars: Bar[], lookback: number): number {
  const n = bars.length;
  if (n < lookback + 2) return NaN;
  const rets: number[] = [];
  for (let i = n - lookback; i < n; i++) {
    rets.push(Math.log(bars[i].c / bars[i - 1].c));
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const varr = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  const perYear = barsPerYear(bars);
  return Math.sqrt(varr * perYear);
}
