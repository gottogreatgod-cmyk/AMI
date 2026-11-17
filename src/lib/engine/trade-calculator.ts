export interface InstrumentRiskEconomics {
  instrumentId: string;
  dataClass: string;
  contract: {
    status: "VERIFIED" | "UNVERIFIED";
    tickSize: number | null;
    quantityIncrement: number | null;
    /** Account-currency P&L for a 1.0 price move per 1 quantity unit. */
    pnlCurrencyPerPointPerUnit: number | null;
    /** Notional currency multiplier per price unit and quantity unit. */
    notionalMultiplier: number | null;
  };
  costs: {
    status: "VERIFIED" | "UNVERIFIED";
    commissionBpsPerSide: number | null;
    slippageBpsPerSide: number | null;
  };
  margin: {
    status: "VERIFIED" | "UNVERIFIED";
    /** Exactly one margin model must be supplied when status is VERIFIED. */
    initialMarginRate: number | null;
    initialMarginPerUnit: number | null;
  };
}

export interface TradeSizingInput {
  accountEquity: number;
  riskPercent: number;
  availableMargin: number;
  maxLeverage: number;
  direction: "long" | "short";
  /** Already side-adjusted: long entry at ask / exits at bid; short inverse. */
  entryExecutionPrice: number;
  stopExecutionPrice: number;
  targetExecutionPrice: number;
  executionPriceBasis: "SIDE_AWARE_EXECUTABLE" | "MID_OR_UNKNOWN";
  minimumNetRewardRisk?: number;
}

export interface NoTradeResult {
  status: "NO_TRADE";
  instrumentId: string;
  reasons: string[];
}

export interface SizedTradeResult {
  status: "SIZED";
  instrumentId: string;
  direction: "long" | "short";
  quantity: number;
  riskBudget: number;
  estimatedWorstCaseStopLoss: number;
  estimatedNetTargetProfit: number;
  estimatedCostsAtStop: number;
  estimatedCostsAtTarget: number;
  estimatedNotional: number;
  estimatedInitialMargin: number;
  estimatedLeverage: number;
  grossRewardRisk: number;
  netRewardRisk: number;
  effectiveRiskPercent: number;
  executionPriceBasis: "SIDE_AWARE_EXECUTABLE";
  assumptions: string[];
}

export type TradeSizingResult = NoTradeResult | SizedTradeResult;

function noTrade(instrumentId: string, reasons: string[]): NoTradeResult {
  return {
    status: "NO_TRADE",
    instrumentId,
    reasons: [...new Set(reasons)],
  };
}

function tickAligned(price: number, tickSize: number): boolean {
  const ticks = price / tickSize;
  return Math.abs(ticks - Math.round(ticks)) <= 1e-8 * Math.max(1, Math.abs(ticks));
}

function decimalPlaces(value: number): number {
  const text = value.toString().toLowerCase();
  if (text.includes("e-")) return Number(text.split("e-")[1]) || 0;
  const point = text.indexOf(".");
  return point < 0 ? 0 : text.length - point - 1;
}

function floorToIncrement(value: number, increment: number): number {
  const steps = Math.floor(value / increment + 1e-10);
  return Number((steps * increment).toFixed(Math.min(12, decimalPlaces(increment))));
}

/**
 * Contract-aware sizing calculator. It never invents a multiplier, tick/lot
 * size, fee or slippage assumption. Prices must already be side-aware
 * executable estimates; a mid-price-only input is explicitly rejected.
 *
 * SIZED means a theoretical paper/research quantity has been calculated. It
 * does not place an order and does not certify that a strategy has an edge.
 */
export function calculateTradeSize(
  economics: InstrumentRiskEconomics,
  input: TradeSizingInput
): TradeSizingResult {
  const reasons: string[] = [];
  const instrumentId = economics.instrumentId || "UNKNOWN";

  if (!economics.instrumentId.trim()) reasons.push("INSTRUMENT_ID_MISSING");
  if (economics.contract.status !== "VERIFIED") {
    reasons.push("CONTRACT_ECONOMICS_UNVERIFIED");
  }
  if (economics.costs.status !== "VERIFIED") {
    reasons.push("EXECUTION_COSTS_UNVERIFIED");
  }
  if (economics.margin.status !== "VERIFIED") {
    reasons.push("INITIAL_MARGIN_REQUIREMENT_UNVERIFIED");
  }
  if (input.executionPriceBasis !== "SIDE_AWARE_EXECUTABLE") {
    reasons.push("SIDE_AWARE_EXECUTABLE_PRICES_REQUIRED");
  }

  const { tickSize, quantityIncrement, pnlCurrencyPerPointPerUnit, notionalMultiplier } =
    economics.contract;
  const { commissionBpsPerSide, slippageBpsPerSide } = economics.costs;

  if (
    tickSize === null || !Number.isFinite(tickSize) || tickSize <= 0 ||
    quantityIncrement === null || !Number.isFinite(quantityIncrement) || quantityIncrement <= 0 ||
    pnlCurrencyPerPointPerUnit === null ||
    !Number.isFinite(pnlCurrencyPerPointPerUnit) || pnlCurrencyPerPointPerUnit <= 0 ||
    notionalMultiplier === null || !Number.isFinite(notionalMultiplier) || notionalMultiplier <= 0
  ) {
    reasons.push("CONTRACT_SPEC_FIELDS_MISSING_OR_INVALID");
  }
  if (
    commissionBpsPerSide === null || !Number.isFinite(commissionBpsPerSide) || commissionBpsPerSide < 0 ||
    slippageBpsPerSide === null || !Number.isFinite(slippageBpsPerSide) || slippageBpsPerSide < 0
  ) {
    reasons.push("COST_SPEC_FIELDS_MISSING_OR_INVALID");
  }
  const marginRate = economics.margin.initialMarginRate;
  const marginPerUnit = economics.margin.initialMarginPerUnit;
  const hasMarginRate = marginRate !== null && Number.isFinite(marginRate) && marginRate > 0;
  const hasMarginPerUnit = marginPerUnit !== null && Number.isFinite(marginPerUnit) && marginPerUnit > 0;
  if (hasMarginRate === hasMarginPerUnit) {
    reasons.push("INITIAL_MARGIN_MODEL_MISSING_OR_AMBIGUOUS");
  }

  const prices = [
    input.entryExecutionPrice,
    input.stopExecutionPrice,
    input.targetExecutionPrice,
  ];
  if (!prices.every((price) => Number.isFinite(price) && price > 0)) {
    reasons.push("EXECUTION_PRICES_INVALID");
  }

  if (
    !Number.isFinite(input.accountEquity) || input.accountEquity <= 0 ||
    !Number.isFinite(input.riskPercent) || input.riskPercent <= 0 || input.riskPercent > 100 ||
    !Number.isFinite(input.availableMargin) || input.availableMargin <= 0 ||
    !Number.isFinite(input.maxLeverage) || input.maxLeverage <= 0
  ) {
    reasons.push("ACCOUNT_OR_RISK_INPUT_INVALID");
  }

  if (
    !Number.isFinite(input.minimumNetRewardRisk ?? 1) ||
    (input.minimumNetRewardRisk ?? 1) < 0
  ) {
    reasons.push("MINIMUM_NET_REWARD_RISK_INVALID");
  }

  if (reasons.length > 0) return noTrade(instrumentId, reasons);

  // The early return above narrows nullable contract/cost fields to their
  // valid path only through runtime validation; retain local numeric guards.
  const tick = tickSize as number;
  const quantityStep = quantityIncrement as number;
  const pointValue = pnlCurrencyPerPointPerUnit as number;
  const multiplier = notionalMultiplier as number;
  const costBps = (commissionBpsPerSide as number) + (slippageBpsPerSide as number);
  const verifiedMarginRate = hasMarginRate ? marginRate as number : null;
  const verifiedMarginPerUnit = hasMarginPerUnit ? marginPerUnit as number : null;
  const entry = input.entryExecutionPrice;
  const stop = input.stopExecutionPrice;
  const target = input.targetExecutionPrice;

  if (
    !tickAligned(entry, tick) ||
    !tickAligned(stop, tick) ||
    !tickAligned(target, tick)
  ) {
    reasons.push("PRICE_NOT_ALIGNED_TO_VERIFIED_TICK_SIZE");
  }

  const directionValid = input.direction === "long"
    ? stop < entry && target > entry
    : target < entry && stop > entry;
  if (!directionValid) reasons.push("STOP_OR_TARGET_DIRECTION_INVALID");
  if (reasons.length > 0) return noTrade(instrumentId, reasons);

  const grossLossPerUnit = Math.abs(entry - stop) * pointValue;
  const grossRewardPerUnit = Math.abs(target - entry) * pointValue;
  const entryCostPerUnit = entry * multiplier * costBps / 10_000;
  const stopCostPerUnit = stop * multiplier * costBps / 10_000;
  const targetCostPerUnit = target * multiplier * costBps / 10_000;
  const worstCaseStopLossPerUnit = grossLossPerUnit + entryCostPerUnit + stopCostPerUnit;
  const netTargetProfitPerUnit = grossRewardPerUnit - entryCostPerUnit - targetCostPerUnit;

  if (
    !Number.isFinite(worstCaseStopLossPerUnit) ||
    worstCaseStopLossPerUnit <= 0 ||
    !Number.isFinite(netTargetProfitPerUnit)
  ) {
    return noTrade(instrumentId, ["RISK_OR_REWARD_CALCULATION_INVALID"]);
  }

  const riskBudget = input.accountEquity * input.riskPercent / 100;
  const rawRiskQuantity = riskBudget / worstCaseStopLossPerUnit;
  const notionalPerUnit = entry * multiplier;
  const maxQuantityByLeverage = input.accountEquity * input.maxLeverage / notionalPerUnit;
  const marginPerQuantityUnit = verifiedMarginRate !== null
    ? notionalPerUnit * verifiedMarginRate
    : verifiedMarginPerUnit as number;
  const maxQuantityByMargin = input.availableMargin / marginPerQuantityUnit;
  const quantity = floorToIncrement(
    Math.min(rawRiskQuantity, maxQuantityByLeverage, maxQuantityByMargin),
    quantityStep
  );

  if (!Number.isFinite(quantity) || quantity <= 0) {
    return noTrade(instrumentId, [
      "MINIMUM_QUANTITY_EXCEEDS_RISK_BUDGET_OR_MARGIN_CAP",
    ]);
  }

  const estimatedWorstCaseStopLoss = quantity * worstCaseStopLossPerUnit;
  const estimatedNetTargetProfit = quantity * netTargetProfitPerUnit;
  const estimatedCostsAtStop = quantity * (entryCostPerUnit + stopCostPerUnit);
  const estimatedCostsAtTarget = quantity * (entryCostPerUnit + targetCostPerUnit);
  const estimatedNotional = quantity * notionalPerUnit;
  const estimatedInitialMargin = quantity * marginPerQuantityUnit;
  const grossRewardRisk = grossRewardPerUnit / grossLossPerUnit;
  const netRewardRisk = netTargetProfitPerUnit / worstCaseStopLossPerUnit;
  const minimumNetRewardRisk = input.minimumNetRewardRisk ?? 1;

  if (estimatedWorstCaseStopLoss > riskBudget + 1e-8) {
    return noTrade(instrumentId, ["ROUNDED_QUANTITY_EXCEEDS_RISK_BUDGET"]);
  }
  if (estimatedInitialMargin > input.availableMargin + 1e-8) {
    return noTrade(instrumentId, ["REQUIRED_MARGIN_EXCEEDS_AVAILABLE_MARGIN"]);
  }
  if (estimatedNetTargetProfit <= 0 || netRewardRisk < minimumNetRewardRisk) {
    return noTrade(instrumentId, ["NET_REWARD_RISK_BELOW_MINIMUM_AFTER_COSTS"]);
  }

  return {
    status: "SIZED",
    instrumentId,
    direction: input.direction,
    quantity,
    riskBudget,
    estimatedWorstCaseStopLoss,
    estimatedNetTargetProfit,
    estimatedCostsAtStop,
    estimatedCostsAtTarget,
    estimatedNotional,
    estimatedInitialMargin,
    estimatedLeverage: estimatedNotional / input.accountEquity,
    grossRewardRisk,
    netRewardRisk,
    effectiveRiskPercent: estimatedWorstCaseStopLoss / input.accountEquity * 100,
    executionPriceBasis: "SIDE_AWARE_EXECUTABLE",
    assumptions: [
      "Instrument contract economics and cost fields were supplied with VERIFIED status.",
      "Entry, stop and target are side-aware executable price estimates; spread is expected to be embedded in those prices.",
      "Commission and slippage are charged on both entry and exit legs.",
      "Quantity is rounded down to the verified quantity increment.",
      "Initial margin uses the verified instrument margin rate or per-unit requirement supplied with the contract economics.",
      "SIZED is a calculation result only; it does not submit or simulate an order fill.",
    ],
  };
}
