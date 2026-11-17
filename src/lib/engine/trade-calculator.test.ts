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
  currencyConversion: {
    status: "VERIFIED",
    accountCurrency: "USD",
    pnlCurrency: "USD",
    quoteCurrency: "USD",
    pnlToAccountRate: 1,
    quoteToAccountRate: 1,
  },
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
  margin: {
    status: "VERIFIED",
    initialMarginRate: 0.1,
    initialMarginPerUnit: null,
  },
};

const defaultInput: TradeSizingInput = {
  accountEquity: 10_000,
  riskPercent: 0.6,
  availableMargin: 1_000,
  maxLeverage: 10,
  direction: "long",
  quotes: {
    entryBid: 99.75,
    entryAsk: 100,
    stopBid: 95,
    stopAsk: 95.25,
    targetBid: 110,
    targetAsk: 110.25,
  },
  minimumNetRewardRisk: 1,
};

describe("verified contract trade calculator", () => {
  test("returns NO_TRADE when currency conversion is not independently verified", () => {
    const economics = {
      ...verifiedSyntheticEconomics,
      currencyConversion: {
        ...verifiedSyntheticEconomics.currencyConversion,
        status: "UNVERIFIED" as const,
      },
    };
    const result = calculateTradeSize(economics, defaultInput);
    expect(result.status).toBe("NO_TRADE");
    if (result.status === "NO_TRADE") {
      expect(result.reasons).toContain("CURRENCY_CONVERSION_UNVERIFIED");
    }
  });

  test("rejects a non-unit conversion rate when account and settlement currencies match", () => {
    const economics = {
      ...verifiedSyntheticEconomics,
      currencyConversion: {
        ...verifiedSyntheticEconomics.currencyConversion,
        pnlToAccountRate: 1.1,
      },
    };
    const result = calculateTradeSize(economics, defaultInput);
    expect(result.status).toBe("NO_TRADE");
    if (result.status === "NO_TRADE") {
      expect(result.reasons).toContain("SAME_CURRENCY_CONVERSION_RATE_MUST_EQUAL_ONE");
    }
  });

  test("converts P&L, costs, notional and margin into the account currency", () => {
    const crossCurrency: InstrumentRiskEconomics = {
      ...verifiedSyntheticEconomics,
      currencyConversion: {
        status: "VERIFIED",
        accountCurrency: "EUR",
        pnlCurrency: "USD",
        quoteCurrency: "USD",
        pnlToAccountRate: 0.9,
        quoteToAccountRate: 0.9,
      },
    };
    const result = calculateTradeSize(crossCurrency, defaultInput);
    expect(result.status).toBe("SIZED");
    if (result.status !== "SIZED") return;

    expect(result.accountCurrency).toBe("EUR");
    expect(result.riskBudget).toBe(60);
    expect(result.estimatedWorstCaseStopLoss).toBeCloseTo(45.26325, 8);
    expect(result.estimatedNetTargetProfit).toBeCloseTo(89.7165, 8);
    expect(result.estimatedNotional).toBeCloseTo(900, 8);
    expect(result.estimatedInitialMargin).toBeCloseTo(90, 8);
    expect(result.estimatedLeverage).toBeCloseTo(0.09, 8);
  });

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

  test("rejects crossed quote pairs instead of accepting a midpoint label", () => {
    const result = calculateTradeSize(verifiedSyntheticEconomics, {
      ...defaultInput,
      quotes: {
        ...defaultInput.quotes,
        entryBid: 100.1,
        entryAsk: 100,
      },
    });
    expect(result.status).toBe("NO_TRADE");
    if (result.status === "NO_TRADE") {
      expect(result.reasons).toContain("EXECUTION_QUOTES_CROSSED");
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
    const result = calculateTradeSize({
      ...verifiedSyntheticEconomics,
      margin: {
        status: "VERIFIED",
        initialMarginRate: 1,
        initialMarginPerUnit: null,
      },
    }, {
      ...defaultInput,
      riskPercent: 5,
      availableMargin: 2_000,
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
      quotes: {
        ...defaultInput.quotes,
        targetBid: 100.25,
        targetAsk: 100.5,
      },
    });
    expect(result.status).toBe("NO_TRADE");
    if (result.status === "NO_TRADE") {
      expect(result.reasons).toContain("NET_REWARD_RISK_BELOW_MINIMUM_AFTER_COSTS");
    }
  });

  test("rejects unaligned prices rather than silently rounding a trigger or stop", () => {
    const result = calculateTradeSize(verifiedSyntheticEconomics, {
      ...defaultInput,
      quotes: {
        ...defaultInput.quotes,
        entryAsk: 100.1,
      },
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
      quotes: {
        entryBid: 100,
        entryAsk: 100.25,
        stopBid: 104.75,
        stopAsk: 105,
        targetBid: 90,
        targetAsk: 90.25,
      },
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

  test("returns NO_TRADE if initial margin requirements are unverified or ambiguous", () => {
    const unverified = {
      ...verifiedSyntheticEconomics,
      margin: {
        status: "UNVERIFIED" as const,
        initialMarginRate: null,
        initialMarginPerUnit: null,
      },
    };
    const ambiguous = {
      ...verifiedSyntheticEconomics,
      margin: {
        status: "VERIFIED" as const,
        initialMarginRate: 0.1,
        initialMarginPerUnit: 100,
      },
    };

    const blocked = calculateTradeSize(unverified, defaultInput);
    const ambiguousResult = calculateTradeSize(ambiguous, defaultInput);
    expect(blocked.status).toBe("NO_TRADE");
    expect(ambiguousResult.status).toBe("NO_TRADE");
    if (blocked.status === "NO_TRADE") {
      expect(blocked.reasons).toContain("INITIAL_MARGIN_REQUIREMENT_UNVERIFIED");
    }
    if (ambiguousResult.status === "NO_TRADE") {
      expect(ambiguousResult.reasons).toContain("INITIAL_MARGIN_MODEL_MISSING_OR_AMBIGUOUS");
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
