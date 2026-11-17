// ---------------------------------------------------------------------------
// THE unified backtest engine.
//
// Invariants (these are the product, not implementation details):
//   1. Signals fire on CLOSED bars only.
//   2. Fills happen at the NEXT bar's open (never the signal bar's close).
//   3. Within a bar, liquidation is checked first, then the stop, then the
//      target — stop before target is the conservative ordering.
//   4. Fees + slippage are charged on BOTH directions, per side.
//   5. Stops are ATR-based; trailing stops only tighten, never loosen.
//   6. Liquidation is modelled against actual implied leverage: liq move =
//      (1/lev) * (1 - maintenance margin ratio). When sizing from the stop,
//      the leverage cap never binds — it only shortens the wick that ends
//      the position.
//   7. Higher-timeframe filters consume only HTF bars whose close time is
//      <= the decision bar's close time (causal, no peeking).
//   8. One position at a time; opposite signals exit at next open.
// ---------------------------------------------------------------------------

import type {
  Bar,
  EquityPoint,
  ExitReason,
  StrategyConfig,
  Timeframe,
  Trade,
} from "./types";
import { adx, atr, bollinger, donchian, ema, rsi as rsiSeries } from "./indicators";
import type { Instrument } from "@/lib/data/instruments";

export interface Diagnostics {
  startingEquity: number;
  leverageCappedEntries: number;
  liquidationBoundEntries: number; // liq distance < stop distance at entry
  signalExits: number;
  barsInMarket: number;
  totalBars: number;
  warmup: number;
  insufficientData: boolean;
}

export interface BacktestOutput {
  trades: Trade[];
  equityCurve: EquityPoint[]; // mark-to-market, one point per bar (downsampled later)
  diagnostics: Diagnostics;
}

export interface HtfStateSeries {
  /** state per HTF bar index: 1 bullish, -1 bearish, 0 neutral/ok */
  state: number[];
  closeTs: number[];
}

/** Build the causal HTF gate states from closed HTF bars. */
export function buildHtfStates(htfBars: Bar[], cfg: StrategyConfig): HtfStateSeries | null {
  const f = cfg.htf;
  if (!f || htfBars.length === 0) return null;
  const closes = htfBars.map((b) => b.c);
  const state = new Array<number>(htfBars.length).fill(0);
  const closeTs = htfBars.map((b) => b.ct);

  if (f.type === "ema-trend" || f.type === "donchian-mid") {
    let fast: number[] | null = null;
    let slow: number[] | null = null;
    if (f.type === "ema-trend") {
      fast = ema(closes, Math.min(f.fast, htfBars.length));
      slow = ema(closes, Math.min(f.slow, htfBars.length));
    } else {
      const dc = donchian(htfBars, Math.min(f.slow, Math.max(2, htfBars.length - 2)));
      fast = dc.mid;
      slow = dc.mid;
    }
    for (let i = 0; i < htfBars.length; i++) {
      const fv = fast[i];
      const sv = slow[i];
      if (Number.isNaN(fv) || Number.isNaN(sv)) {
        state[i] = 0;
      } else if (f.type === "ema-trend") {
        state[i] = fv > sv ? 1 : fv < sv ? -1 : 0;
      } else {
        state[i] = closes[i] > sv ? 1 : closes[i] < sv ? -1 : 0;
      }
    }
  } else if (f.type === "momentum-sign") {
    const lb = Math.max(2, f.slow);
    for (let i = 0; i < htfBars.length; i++) {
      if (i < lb) {
        state[i] = 0;
      } else {
        const mom = closes[i] - closes[i - lb];
        state[i] = mom > 0 ? 1 : mom < 0 ? -1 : 0;
      }
    }
  } else if (f.type === "range-neutral") {
    const adxSeries = adx(htfBars, Math.min(f.fast, 14));
    const adxMax = f.adxMax ?? 25;
    for (let i = 0; i < htfBars.length; i++) {
      state[i] = Number.isNaN(adxSeries[i]) ? 0 : adxSeries[i] < adxMax ? 1 : -1;
      // 1 = ranging regime (entries allowed), -1 = trending (blocked)
    }
  }
  return { state, closeTs };
}

/** Last HTF state whose close time is <= decision time (binary search). */
export function htfStateAt(htf: HtfStateSeries | null, decisionTs: number): number {
  if (!htf) return 1; // no filter configured → permissive
  const { closeTs, state } = htf;
  let lo = 0;
  let hi = closeTs.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (closeTs[mid] <= decisionTs) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (ans < 0) return 0;
  return state[ans];
}

interface Series {
  atr: number[];
  emaFilter: number[] | null;
  dc: ReturnType<typeof donchian> | null;
  bb: ReturnType<typeof bollinger> | null;
  rsi: number[] | null;
}

function computeSeries(bars: Bar[], cfg: StrategyConfig): Series {
  const closes = bars.map((b) => b.c);
  const s: Series = {
    atr: atr(bars, cfg.atrPeriod),
    emaFilter: cfg.entry.emaFilter ? ema(closes, cfg.entry.emaFilter) : null,
    // Also surfaced in live market context even when the strategy family does not trade Donchian breaks.
    dc: donchian(bars, cfg.entry.lookback),
    bb:
      cfg.entry.kind === "rsi-extreme" || cfg.entry.kind === "bb-extreme"
        ? bollinger(closes, cfg.entry.bbPeriod ?? 20, cfg.entry.bbStd ?? 2)
        : null,
    rsi:
      cfg.entry.kind === "rsi-extreme" || cfg.exit.exitOnRsiMid
        ? rsiSeries(closes, cfg.entry.rsiPeriod ?? 2)
        : null,
  };
  return s;
}

/** Entry signal for bar index i (i must be a closed bar; -1 none, 1 long, -1 short). */
function entrySignalAt(bars: Bar[], i: number, cfg: StrategyConfig, s: Series): 0 | 1 | -1 {
  const c = bars[i].c;
  const allowLong = cfg.direction === "long" || cfg.direction === "both";
  const allowShort = cfg.direction === "short" || cfg.direction === "both";

  let longOk = false;
  let shortOk = false;

  switch (cfg.entry.kind) {
    case "donchian-break": {
      const dc = s.dc!;
      if (!Number.isNaN(dc.upper[i]) && c > dc.upper[i]) longOk = true;
      if (!Number.isNaN(dc.lower[i]) && c < dc.lower[i]) shortOk = true;
      break;
    }
    case "rsi-extreme": {
      const r = s.rsi![i];
      const bb = s.bb!;
      if (!Number.isNaN(r) && r < (cfg.entry.rsiLongBelow ?? 10) && c <= bb.lower[i]) longOk = true;
      if (!Number.isNaN(r) && r > (cfg.entry.rsiShortAbove ?? 90) && c >= bb.upper[i]) shortOk = true;
      break;
    }
    case "bb-extreme": {
      const bb = s.bb!;
      if (!Number.isNaN(bb.lower[i]) && c <= bb.lower[i]) longOk = true;
      if (!Number.isNaN(bb.upper[i]) && c >= bb.upper[i]) shortOk = true;
      break;
    }
    case "ts-momentum": {
      const lb = cfg.entry.momentumLookback ?? 90;
      if (i >= lb) {
        const mom = c - bars[i - lb].c;
        const em = s.emaFilter ? s.emaFilter[i] : NaN;
        const trendOk = Number.isNaN(em) ? true : mom > 0 ? c > em : c < em;
        if (mom > 0 && trendOk) longOk = true;
        if (mom < 0 && trendOk) shortOk = true;
      }
      break;
    }
  }

  // EMA trend confirm for breakout entries
  if (longOk && cfg.entry.kind !== "ts-momentum" && s.emaFilter) {
    const em = s.emaFilter[i];
    if (!Number.isNaN(em) && c < em) longOk = false;
  }
  if (shortOk && cfg.entry.kind !== "ts-momentum" && s.emaFilter) {
    const em = s.emaFilter[i];
    if (!Number.isNaN(em) && c > em) shortOk = false;
  }

  if (allowLong && longOk) return 1;
  if (allowShort && shortOk) return -1;
  return 0;
}


/** Canonical entry-rule evaluation used by both backtests and live signals. */
export function evaluateClosedBar(
  bars: Bar[],
  index: number,
  cfg: StrategyConfig
): {
  signal: 0 | 1 | -1;
  atr: number;
  rsi: number | null;
  donchianUpper: number | null;
  donchianLower: number | null;
} {
  if (index < 0 || index >= bars.length) {
    return { signal: 0, atr: Number.NaN, rsi: null, donchianUpper: null, donchianLower: null };
  }
  const series = computeSeries(bars, cfg);
  const rsiValue = series.rsi?.[index];
  const upper = series.dc?.upper[index];
  const lower = series.dc?.lower[index];
  return {
    signal: entrySignalAt(bars, index, cfg, series),
    atr: series.atr[index],
    rsi: rsiValue != null && Number.isFinite(rsiValue) ? rsiValue : null,
    donchianUpper: upper != null && Number.isFinite(upper) ? upper : null,
    donchianLower: lower != null && Number.isFinite(lower) ? lower : null,
  };
}

/** Signal-based exit at bar close i (for an open position with direction dir). */
function signalExitAt(bars: Bar[], i: number, dir: 1 | -1, cfg: StrategyConfig, s: Series): boolean {
  const c = bars[i].c;
  if (cfg.exit.exitOnChannelMid && s.dc) {
    const mid = s.dc.mid[i];
    if (!Number.isNaN(mid)) {
      if (dir === 1 && c < mid) return true;
      if (dir === -1 && c > mid) return true;
    }
  }
  if (cfg.exit.exitOnRsiMid && s.rsi) {
    const r = s.rsi[i];
    if (!Number.isNaN(r)) {
      if (dir === 1 && r > 55) return true;
      if (dir === -1 && r < 45) return true;
    }
  }
  if (cfg.exit.exitOnMomentumFlip) {
    const lb = cfg.entry.momentumLookback ?? 90;
    if (i >= lb) {
      const mom = c - bars[i - lb].c;
      if (dir === 1 && mom < 0) return true;
      if (dir === -1 && mom > 0) return true;
    }
  }
  // opposite entry signal also exits
  const sig = entrySignalAt(bars, i, cfg, s);
  if (dir === 1 && sig === -1) return true;
  if (dir === -1 && sig === 1) return true;
  return false;
}

export function computeWarmup(cfg: StrategyConfig): number {
  let w = cfg.warmupBars;
  w = Math.max(w, cfg.atrPeriod + 1, cfg.entry.lookback + 1);
  if (cfg.entry.emaFilter) w = Math.max(w, cfg.entry.emaFilter + 1);
  if (cfg.entry.bbPeriod) w = Math.max(w, cfg.entry.bbPeriod + 1);
  if (cfg.entry.rsiPeriod) w = Math.max(w, cfg.entry.rsiPeriod + 2);
  if (cfg.entry.momentumLookback) w = Math.max(w, cfg.entry.momentumLookback + 1);
  return w;
}

export function runBacktest(
  symbol: string,
  tf: Timeframe,
  bars: Bar[],
  htfBars: Bar[] | null,
  cfg: StrategyConfig,
  inst: Pick<Instrument, "feeBpsPerSide" | "slipBpsPerSide" | "mmr">,
  startingEquity = 10_000
): BacktestOutput {
  const n = bars.length;
  const warmup = computeWarmup(cfg);
  const feeBps = cfg.costs?.feeBpsPerSide ?? inst.feeBpsPerSide;
  const slipBps = cfg.costs?.slipBpsPerSide ?? inst.slipBpsPerSide;
  const costRate = (feeBps + slipBps) / 10_000;
  const mmr = cfg.risk.maintenanceMargin ?? inst.mmr;

  const trades: Trade[] = [];
  const equityCurve: EquityPoint[] = [];
  const diagnostics: Diagnostics = {
    startingEquity,
    leverageCappedEntries: 0,
    liquidationBoundEntries: 0,
    signalExits: 0,
    barsInMarket: 0,
    totalBars: n,
    warmup,
    insufficientData: n < warmup + 30,
  };
  const htfReady =
    !cfg.htf ||
    (!diagnostics.insufficientData &&
      hasHtfWarmup(htfBars, cfg, bars[warmup]?.ct ?? Number.NEGATIVE_INFINITY));
  if (diagnostics.insufficientData || !htfReady) {
    // A configured HTF gate is mandatory: missing or late history must never
    // silently become a permissive filter.
    diagnostics.insufficientData = true;
    return { trades: [], equityCurve: [{ t: bars[0]?.t ?? Date.now(), eq: startingEquity }], diagnostics };
  }

  const s = computeSeries(bars, cfg);
  const htf = htfBars && htfBars.length > 0 ? buildHtfStates(htfBars, cfg) : null;

  interface OpenPos {
    dir: 1 | -1;
    entryIdx: number;
    entryTs: number;
    entryPrice: number;
    qty: number;
    stop: number;
    target: number | null;
    plannedRisk: number;
    liqPrice: number | null;
    entryLev: number; // implied leverage at entry (for the margin bound)
    mfeR: number;
    maeR: number;
    leverageCapped: boolean;
  }

  let equity = startingEquity;
  let cash = startingEquity;
  let pos: OpenPos | null = null;
  let pendingExit = false; // signal exit fired at previous close → exit at this bar's open
  let pendingEntry: { dir: 1 | -1; signalIdx: number } | null = null;
  let tradeId = 0;
  let halted = false; // account blown (equity ≤ 2% of start) — no further entries

  const costOf = (qty: number, price: number) => qty * price * costRate;
  const rOf = (pnl: number, plannedRisk: number) => (plannedRisk > 1e-12 ? pnl / plannedRisk : 0);

  for (let i = warmup; i < n; i++) {
    const bar = bars[i];

    // ---- 1. fills at this bar's OPEN --------------------------------------
    if (pendingExit && pos) {
      const exitPrice = bar.o;
      const fees = costOf(pos.qty, pos.entryPrice) + costOf(pos.qty, exitPrice);
      const gross = (exitPrice - pos.entryPrice) * pos.qty * pos.dir;
      const pnl = gross - fees;
      equity += pnl;
      trades.push({
        id: tradeId++,
        dir: pos.dir,
        entryTs: pos.entryTs,
        entryPrice: pos.entryPrice,
        exitTs: bar.t,
        exitPrice,
        qty: pos.qty,
        stop: pos.stop,
        target: pos.target,
        exitReason: "signal-exit",
        pnl,
        r: rOf(pnl, pos.plannedRisk),
        fees,
        equityAfter: equity,
        mfeR: pos.mfeR,
        maeR: pos.maeR,
      });
      diagnostics.signalExits++;
      pos = null;
      pendingExit = false;
    }

    if (pendingEntry && !pos && !halted) {
      const { dir, signalIdx } = pendingEntry;
      pendingEntry = null;
      const entryPrice = bar.o;
      const atrAtSignal = s.atr[signalIdx];
      const stopDist = Math.max(atrAtSignal * cfg.risk.stopAtr, entryPrice * 1e-6);
      let qty: number;
      let leverageCapped = false;
      if (cfg.risk.sizeMode === "leverage") {
        // leverage-sized preset: notional = equity × cap (the cautionary path)
        qty = (equity * cfg.risk.leverageCap) / entryPrice;
      } else {
        // size from the stop; the cap only shortens the wick that ends it
        const qtyRisk = (equity * cfg.risk.riskPerTrade) / stopDist;
        const qtyCap = (equity * cfg.risk.leverageCap) / entryPrice;
        qty = Math.min(qtyRisk, qtyCap);
        leverageCapped = qtyCap < qtyRisk;
      }
      if (leverageCapped) diagnostics.leverageCappedEntries++;
      const notional = qty * entryPrice;
      const lev = notional / Math.max(equity, 1e-9);
      // liquidation move as a FRACTION of the entry price: (1/lev) × (1 − mmr)
      // at 300× this is ±0.33% of price — inside the noise of a single 15m candle
      const liqMoveFrac = lev > 1 ? (1 / lev) * (1 - mmr) : Infinity;
      const liqPrice = Number.isFinite(liqMoveFrac)
        ? entryPrice * (1 - dir * liqMoveFrac)
        : null;
      if (liqPrice !== null && Math.abs(entryPrice - liqPrice) < stopDist) {
        diagnostics.liquidationBoundEntries++;
      }
      const stop = entryPrice - dir * stopDist;
      const target = cfg.exit.takeR ? entryPrice + dir * stopDist * cfg.exit.takeR : null;
      pos = {
        dir,
        entryIdx: i,
        entryTs: bar.t,
        entryPrice,
        qty,
        stop,
        target,
        plannedRisk: qty * stopDist,
        liqPrice,
        entryLev: lev,
        mfeR: 0,
        maeR: 0,
        leverageCapped,
      };
    }

    // ---- 2. intrabar management (liquidation → stop → target) -------------
    if (pos) {
      diagnostics.barsInMarket++;
      const { dir } = pos;
      const rUnit = pos.plannedRisk / Math.max(pos.qty, 1e-12); // price distance of 1R

      // 2a. liquidation first — the exchange acts before your stop
      if (pos.liqPrice !== null) {
        const touched = dir === 1 ? bar.l <= pos.liqPrice : bar.h >= pos.liqPrice;
        if (touched) {
          const exitPrice = pos.liqPrice;
          const fees = costOf(pos.qty, pos.entryPrice) + costOf(pos.qty, exitPrice) + pos.qty * exitPrice * 0.0005; // liquidation penalty 5bps
          const gross = (exitPrice - pos.entryPrice) * pos.qty * dir;
          // a liquidation cannot lose more than the margin posted for the
          // position (notional / implied leverage) — the exchange force-closes it
          const margin = pos.qty * pos.entryPrice / Math.max(pos.entryLev, 1.0000001);
          const pnl = Math.max(gross - fees, -margin * 0.995);
          equity += pnl;
          cash += pnl;
          trades.push({
            id: tradeId++,
            dir,
            entryTs: pos.entryTs,
            entryPrice: pos.entryPrice,
            exitTs: bar.t,
            exitPrice,
            qty: pos.qty,
            stop: pos.stop,
            target: pos.target,
            exitReason: "liquidation",
            pnl,
            r: rOf(pnl, pos.plannedRisk),
            fees,
            equityAfter: equity,
            mfeR: pos.mfeR,
            maeR: pos.maeR,
          });
          pos = null;
          if (equity <= startingEquity * 0.02) halted = true;
          equityCurve.push({ t: bar.t, eq: equity });
          continue;
        }
      }

      if (pos) {
        // MFE / MAE in R at bar granularity
        const fav = dir === 1 ? bar.h - pos.entryPrice : pos.entryPrice - bar.l;
        const adv = dir === 1 ? pos.entryPrice - bar.l : bar.h - pos.entryPrice;
        if (rUnit > 0) {
          pos.mfeR = Math.max(pos.mfeR, fav / rUnit);
          pos.maeR = Math.max(pos.maeR, adv / rUnit);
        }

        // 2b. stop (gap-aware: opening beyond the stop fills at the open — worse)
        const stopTouched = dir === 1 ? bar.l <= pos.stop : bar.h >= pos.stop;
        if (stopTouched) {
          const gapThrough = dir === 1 ? bar.o <= pos.stop : bar.o >= pos.stop;
          const exitPrice = gapThrough ? bar.o : pos.stop;
          const fees = costOf(pos.qty, pos.entryPrice) + costOf(pos.qty, exitPrice);
          const gross = (exitPrice - pos.entryPrice) * pos.qty * dir;
          const pnl = gross - fees;
          equity += pnl;
          cash += pnl;
          const reason: ExitReason = cfg.exit.trailAtr ? "trail" : "stop";
          trades.push({
            id: tradeId++,
            dir,
            entryTs: pos.entryTs,
            entryPrice: pos.entryPrice,
            exitTs: bar.t,
            exitPrice,
            qty: pos.qty,
            stop: pos.stop,
            target: pos.target,
            exitReason: reason,
            pnl,
            r: rOf(pnl, pos.plannedRisk),
            fees,
            equityAfter: equity,
            mfeR: pos.mfeR,
            maeR: pos.maeR,
          });
          pos = null;
          equityCurve.push({ t: bar.t, eq: equity });
          continue;
        }

        // 2c. target (gap beyond target fills at the open — better)
        if (pos.target !== null) {
          const targetTouched = dir === 1 ? bar.h >= pos.target : bar.l <= pos.target;
          if (targetTouched) {
            const gapThrough = dir === 1 ? bar.o >= pos.target : bar.o <= pos.target;
            const exitPrice = gapThrough ? bar.o : pos.target;
            const fees = costOf(pos.qty, pos.entryPrice) + costOf(pos.qty, exitPrice);
            const gross = (exitPrice - pos.entryPrice) * pos.qty * dir;
            const pnl = gross - fees;
            equity += pnl;
            cash += pnl;
            trades.push({
              id: tradeId++,
              dir,
              entryTs: pos.entryTs,
              entryPrice: pos.entryPrice,
              exitTs: bar.t,
              exitPrice,
              qty: pos.qty,
              stop: pos.stop,
              target: pos.target,
              exitReason: "target",
              pnl,
              r: rOf(pnl, pos.plannedRisk),
              fees,
              equityAfter: equity,
              mfeR: pos.mfeR,
              maeR: pos.maeR,
            });
            pos = null;
            equityCurve.push({ t: bar.t, eq: equity });
            continue;
          }
        }
      }
    }

    // ---- 3. close-of-bar decisions ----------------------------------------
    if (pos) {
      // trailing stop: tighten only, from closed-bar data
      if (cfg.exit.trailAtr) {
        const a = s.atr[i];
        if (!Number.isNaN(a)) {
          const cand = bar.c - pos.dir * a * cfg.exit.trailAtr;
          pos.stop = pos.dir === 1 ? Math.max(pos.stop, cand) : Math.min(pos.stop, cand);
        }
      }
      // signal exits → exit at NEXT bar open
      if (signalExitAt(bars, i, pos.dir, cfg, s)) {
        pendingExit = true;
      }
    } else if (i < n - 1 && !halted) {
      // new entries → fill at NEXT bar open, gated by the last CLOSED HTF bar
      const sig = entrySignalAt(bars, i, cfg, s);
      if (sig !== 0) {
        const gate = htfStateAt(htf, bar.ct);
        let htfOk = true;
        if (cfg.htf) {
          if (cfg.htf.type === "range-neutral") {
            htfOk = gate >= 1; // 1 = ranging regime (entries allowed)
          } else {
            htfOk = sig === 1 ? gate === 1 : gate === -1; // strict alignment
          }
        }
        if (htfOk) pendingEntry = { dir: sig as 1 | -1, signalIdx: i };
      }
    }

    // mark-to-market equity for drawdown
    if (pos) {
      const mtm = cash + (bar.c - pos.entryPrice) * pos.qty * pos.dir - costOf(pos.qty, pos.entryPrice);
      equityCurve.push({ t: bar.t, eq: mtm });
    } else {
      cash = equity;
      equityCurve.push({ t: bar.t, eq: equity });
    }
  }

  // ---- end of data: force close -------------------------------------------
  if (pos) {
    const lastBar = bars[n - 1];
    const fees = costOf(pos.qty, pos.entryPrice) + costOf(pos.qty, lastBar.c);
    const gross = (lastBar.c - pos.entryPrice) * pos.qty * pos.dir;
    const pnl = gross - fees;
    equity += pnl;
    trades.push({
      id: tradeId++,
      dir: pos.dir,
      entryTs: pos.entryTs,
      entryPrice: pos.entryPrice,
      exitTs: lastBar.ct,
      exitPrice: lastBar.c,
      qty: pos.qty,
      stop: pos.stop,
      target: pos.target,
      exitReason: "end-of-data",
      pnl,
      r: rOf(pnl, pos.plannedRisk),
      fees,
      equityAfter: equity,
      mfeR: pos.mfeR,
      maeR: pos.maeR,
    });
    pos = null;
  }

  return { trades, equityCurve, diagnostics };
}
