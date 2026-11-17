// ---------------------------------------------------------------------------
// AMI Unified Quant Engine — canonical type contracts
// One engine, one set of contracts. Every strategy, every market, every
// timeframe. Signals fire on closed bars; fills happen at the next bar's
// open; fees and slippage are charged both directions; stops are checked
// before targets; liquidation is modelled against leverage.
// ---------------------------------------------------------------------------

export const TIMEFRAMES = ["15m", "45m", "1h", "3h", "4h", "1d", "1w"] as const;
export type Timeframe = (typeof TIMEFRAMES)[number];

export const TF_MS: Record<Timeframe, number> = {
  "15m": 15 * 60_000,
  "45m": 45 * 60_000,
  "1h": 60 * 60_000,
  "3h": 3 * 60 * 60_000,
  "4h": 4 * 60 * 60_000,
  "1d": 24 * 60 * 60_000,
  "1w": 7 * 24 * 60 * 60_000,
};

export const TF_RANK: Record<Timeframe, number> = {
  "15m": 1,
  "45m": 2,
  "1h": 3,
  "3h": 4,
  "4h": 5,
  "1d": 6,
  "1w": 7,
};

/** A closed OHLCV bar. `t` is open time (ms epoch UTC), `ct` close time. */
export interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
  ct: number;
}

// ---------------------------------------------------------------------------
// Strategy configuration — declarative rule sets evaluated by one engine
// ---------------------------------------------------------------------------

export type Direction = "long" | "short" | "both";

export interface EntryRule {
  kind: "donchian-break" | "rsi-extreme" | "ts-momentum" | "bb-extreme";
  /** lookback in bars of the trading timeframe */
  lookback: number;
  /** extra params by kind */
  rsiPeriod?: number;
  rsiLongBelow?: number; // enter long when RSI < this
  rsiShortAbove?: number;
  bbPeriod?: number;
  bbStd?: number;
  momentumLookback?: number; // ts-momentum: sign of return over N bars
  emaFilter?: number; // require close vs EMA(n) alignment
}

export interface ExitRule {
  /** fixed profit target in R multiples (null = none) */
  takeR?: number | null;
  /** trailing stop: ATR multiple trail (0/null = disabled) */
  trailAtr?: number | null;
  /** exit when close crosses back over the mid of the entry Donchian channel */
  exitOnChannelMid?: boolean;
  /** exit when RSI recovers past its mid (mean reversion) */
  exitOnRsiMid?: boolean;
  /** exit when momentum sign flips (ts-momentum) */
  exitOnMomentumFlip?: boolean;
}

export interface HtfFilter {
  /** higher timeframe whose closed bars gate entries */
  tf: Timeframe;
  type: "ema-trend" | "donchian-mid" | "momentum-sign" | "range-neutral";
  fast: number;
  slow: number;
  /** range-neutral: require ADX below this on the HTF */
  adxMax?: number;
}

export interface RiskConfig {
  /** fraction of equity risked per trade (0.01 = 1%) */
  riskPerTrade: number;
  /** hard leverage cap; sizing is from the stop, the cap only shortens the wick that ends the position */
  leverageCap: number;
  /** stop distance in ATR multiples */
  stopAtr: number;
  /**
   * "risk" (recommended): size from the stop distance, leverage cap is a safety.
   * "leverage" (cautionary presets): notional = equity × cap — reproduces how
   * a 300× preset is wiped out by a single 0.33% wick.
   */
  sizeMode: "risk" | "leverage";
  /** maintenance margin ratio used by the liquidation model */
  maintenanceMargin?: number;
}

export interface CostConfig {
  /** taker fee in bps of notional, per side */
  feeBpsPerSide: number;
  /** slippage in bps of notional, per side */
  slipBpsPerSide: number;
}

export interface StrategyConfig {
  key: string;
  name: string;
  description: string;
  family: string;
  timeframe: Timeframe;
  direction: Direction;
  entry: EntryRule;
  exit: ExitRule;
  risk: RiskConfig;
  /** default per-instrument costs; providers may override with realistic venue costs */
  costs?: Partial<CostConfig>;
  /** higher-timeframe confluence gate — every run is backed by a higher TF */
  htf?: HtfFilter | null;
  atrPeriod: number;
  /** warmup bars reserved before the first possible signal */
  warmupBars: number;
}

// ---------------------------------------------------------------------------
// Trades & results
// ---------------------------------------------------------------------------

export type ExitReason = "stop" | "trail" | "target" | "signal-exit" | "liquidation" | "end-of-data";

export interface Trade {
  id: number;
  dir: 1 | -1;
  entryTs: number;
  entryPrice: number;
  exitTs: number;
  exitPrice: number;
  qty: number;
  stop: number;
  target: number | null;
  exitReason: ExitReason;
  /** net P&L in account currency after fees + slippage */
  pnl: number;
  /** net P&L in R (R = planned risk at entry) */
  r: number;
  fees: number;
  /** equity after the trade closed */
  equityAfter: number;
  /** MFE/MAE in R at bar granularity */
  mfeR: number;
  maeR: number;
}

export interface EquityPoint {
  t: number;
  eq: number;
}

export interface SplitHalf {
  trades: number;
  pf: number;
  expectancyR: number;
  net: number;
}

export interface RunMetrics {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  netProfit: number;
  netReturnPct: number;
  /** net profit factor (after costs); Infinity guarded to 99 when no losses */
  profitFactor: number;
  grossProfit: number;
  grossLoss: number;
  totalCosts: number;
  /** costs as fraction of gross profit */
  costDragPct: number;
  expectancyR: number;
  avgWinR: number;
  avgLossR: number;
  tStat: number;
  maxDrawdownPct: number;
  maxDrawdownAbs: number;
  exposurePct: number;
  liquidations: number;
  /** stopouts that were within the noise of a single bar of the TF */
  leverageWickouts: number;
  cagrPct: number | null;
  barsInMarket: number;
  finalEquity: number;
}

export interface RobustnessSplit {
  first: SplitHalf;
  second: SplitHalf;
  consistent: boolean;
  decayed: boolean;
  note: string;
}

export interface RunResult {
  symbol: string;
  tf: Timeframe;
  metrics: RunMetrics;
  split: RobustnessSplit;
  robustness: RobustnessScore;
  equity: EquityPoint[];
  trades: Trade[];
  verdict: "PASS" | "WATCH" | "FAIL" | "INSUFFICIENT";
}

export interface RobustnessScore {
  score: number; // 0..100
  grade: "A" | "B" | "C" | "D";
  components: {
    edge: number; // profit factor component
    significance: number; // t-stat component
    sample: number; // trade count sufficiency
    stability: number; // split-sample consistency
    risk: number; // drawdown / liquidation penalty
  };
}

// ---------------------------------------------------------------------------
// Data quality provenance (no dataset is silently trusted)
// ---------------------------------------------------------------------------

export interface DataQuality {
  provider: string;
  providerSymbol: string;
  bars: number;
  fromTs: number;
  toTs: number;
  requestedDays: number;
  coveredDays: number;
  /** the signal test window (warmup history is fetched on top of this) */
  testWindowDays?: number;
  warmupDaysConsumed?: number;
  coverage: "FULL" | "PARTIAL" | "PROVIDER_LIMIT" | "INSUFFICIENT";
  session: "24/7" | "futures" | "forex" | "index" | "metals";
  resampledFrom?: Timeframe | null;
  gapsDetected: number;
  fetchedAt: number;
  note?: string;
}

// ---------------------------------------------------------------------------
// Auto-review — findings and up to four concrete, measurable changes
// ---------------------------------------------------------------------------

export interface ReviewFinding {
  severity: "info" | "warn" | "critical";
  message: string;
}

export interface ReviewSuggestion {
  title: string;
  detail: string;
  /** JSON patch applied to StrategyConfig when the suggestion is forked */
  patch: Partial<StrategyConfig> & { risk?: Partial<RiskConfig>; exit?: Partial<ExitRule> };
  expectedEffect: string;
}

export interface AutoReview {
  verdict: string;
  findings: ReviewFinding[];
  suggestions: ReviewSuggestion[];
  generatedAt: number;
}

// ---------------------------------------------------------------------------
// Engine version — pinned for reproducibility
// ---------------------------------------------------------------------------

export const ENGINE_VERSION = "ami-engine-1.0.1";
