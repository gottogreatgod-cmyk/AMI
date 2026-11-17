/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import {
  calculateTradeSize,
  type InstrumentRiskEconomics,
  type TradeSizingInput,
} from "./trade-calculator";

const verifiedSyntheticEconomics: InstrumentRiskEconomics = {
  instrumentId: "SYNTHETIC-TEST-CONTRACT",
  dataClass: "EXCHANGE_FUTURES",
  contract: {
    status: "VERIFIED",
    tickSize: 0.25,
    quantityIncrement: 1,
    pnlCurrencyPerPointPerUnit: 10,
    notionalMultiplier: 10,
  },
  costs: {
    status: "VERIFIED",
    commissionBpsPerSide: 1,
    slippageBpsPerSide: 0.5,
  },
};

const defaultInput: TradeSizingInput = {
  accountEquity: 10_000,
  riskPercent: 0.6,
  availableMargin: 1_000,
  maxLeverage: 10,
  direction: "long",
  entryExecutionPrice: 100,
  stopExecutionPrice: 95,
  targetExecutionPrice: 110,
  executionPriceBasis: "SIDE_AWARE_EXECUTABLE",
  minimumNetRewardRisk: 1,
};

describe("verified contract trade calculator", () => {
  test("returns NO_TRADE for current unverified contract economics", () => {
    const economics = {
      ...verifiedSyntheticEconomics,
      instrumentId: "XAUUSD-DUKA",
      contract: { ...verifiedSyntheticEconomics.contract, status: "UNVERIFIED" as const },
    };
    const result = calculateTradeSize(economics, defaultInput);
    expect(result.status).toBe("NO_TRADE");
    if (result.status === "NO_TRADE") {
      expect(result.reasons).toContain("CONTRACT_ECONOMICS_UNVERIFIED");
    }
  });

  test("returns NO_TRADE when spread-aware executable prices are unavailable", () => {
    const result = calculateTradeSize(verifiedSyntheticEconomics, {
      ...defaultInput,
      executionPriceBasis: "MID_OR_UNKNOWN",
    });
    expect(result.status).toBe("NO_TRADE");
    if (result.status === "NO_TRADE") {
      expect(result.reasons).toContain("SIDE_AWARE_EXECUTABLE_PRICES_REQUIRED");
    }
  });

  test("sizes quantity from worst-case stop loss including two-sided costs", () => {
    const result = calculateTradeSize(verifiedSyntheticEconomics, defaultInput);
    expect(result.status).toBe("SIZED");
    if (result.status !== "SIZED") return;

    expect(result.quantity).toBe(1);
    expect(result.riskBudget).toBe(60);
    expect(result.estimatedWorstCaseStopLoss).toBeCloseTo(50.2925, 8);
    expect(result.estimatedNetTargetProfit).toBeCloseTo(99.685, 8);
    expect(result.estimatedInitialMargin).toBeCloseTo(100, 8);
    expect(result.grossRewardRisk).toBe(2);
    expect(result.netRewardRisk).toBeGreaterThan(1.9);
    expect(result.effectiveRiskPercent).toBeLessThan(defaultInput.riskPercent);
  });

  test("caps quantity by both leverage and available margin", () => {
    const result = calculateTradeSize(verifiedSyntheticEconomics, {
      ...defaultInput,
      riskPercent: 5,
      availableMargin: 200,
      maxLeverage: 1,
    });
    expect(result.status).toBe("SIZED");
    if (result.status === "SIZED") {
      expect(result.quantity).toBe(2);
      expect(result.estimatedNotional).toBe(2_000);
      expect(result.estimatedInitialMargin).toBe(2_000);
    }
  });

  test("returns NO_TRADE when costs consume the target or net R:R is too low", () => {
    const expensive: InstrumentRiskEconomics = {
      ...verifiedSyntheticEconomics,
      costs: {
        status: "VERIFIED",
        commissionBpsPerSide: 100,
        slippageBpsPerSide: 50,
      },
    };
    const result = calculateTradeSize(expensive, {
      ...defaultInput,
      targetExecutionPrice: 100.25,
    });
    expect(result.status).toBe("NO_TRADE");
    if (result.status === "NO_TRADE") {
      expect(result.reasons).toContain("NET_REWARD_RISK_BELOW_MINIMUM_AFTER_COSTS");
    }
  });

  test("rejects unaligned prices rather than silently rounding a trigger or stop", () => {
    const result = calculateTradeSize(verifiedSyntheticEconomics, {
      ...defaultInput,
      entryExecutionPrice: 100.1,
    });
    expect(result.status).toBe("NO_TRADE");
    if (result.status === "NO_TRADE") {
      expect(result.reasons).toContain("PRICE_NOT_ALIGNED_TO_VERIFIED_TICK_SIZE");
    }
  });

  test("supports correctly oriented short trade plans", () => {
    const result = calculateTradeSize(verifiedSyntheticEconomics, {
      ...defaultInput,
      direction: "short",
      entryExecutionPrice: 100,
      stopExecutionPrice: 105,
      targetExecutionPrice: 90,
    });
    expect(result.status).toBe("SIZED");
    if (result.status === "SIZED") expect(result.direction).toBe("short");
  });

  test("returns NO_TRADE when the minimum quantity exceeds the risk budget", () => {
    const result = calculateTradeSize(verifiedSyntheticEconomics, {
      ...defaultInput,
      riskPercent: 0.1,
    });
    expect(result.status).toBe("NO_TRADE");
    if (result.status === "NO_TRADE") {
      expect(result.reasons).toContain("MINIMUM_QUANTITY_EXCEEDS_RISK_BUDGET_OR_MARGIN_CAP");
    }
  });

  test("requires fully verified costs as well as verified contract values", () => {
    const economics = {
      ...verifiedSyntheticEconomics,
      costs: { ...verifiedSyntheticEconomics.costs, status: "UNVERIFIED" as const },
    };
    const result = calculateTradeSize(economics, defaultInput);
    expect(result.status).toBe("NO_TRADE");
    if (result.status === "NO_TRADE") {
      expect(result.reasons).toContain("EXECUTION_COSTS_UNVERIFIED");
    }
  });
});
