/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import {
  getInstrumentRiskEconomics,
  type VerifiedAccountCurrencyConversion,
} from "./trade-calculator-adapter";
import { calculateTradeSize } from "./trade-calculator";
import { MARKET_INSTRUMENTS } from "@/lib/data/market-instrument-contract";

describe("canonical instrument risk economics adapter", () => {
  test("XAUUSD spot and NAS100 CFD remain unverified and cannot be sized", () => {
    for (const instrumentId of ["XAUUSD-DUKA", "NAS100-DUKA"]) {
      const economics = getInstrumentRiskEconomics(instrumentId, "USD");
      expect(economics).not.toBeNull();
      expect(economics?.contract.status).toBe("UNVERIFIED");
      expect(economics?.costs.status).toBe("UNVERIFIED");
      expect(economics?.margin.status).toBe("UNVERIFIED");
      expect(economics?.contract.notionalMultiplier).toBeNull();
      expect(economics?.margin.initialMarginRate).toBeNull();
      expect(economics?.margin.initialMarginPerUnit).toBeNull();
    }
  });

  test("continuous Nasdaq futures are not converted into dated futures economics", () => {
    const economics = getInstrumentRiskEconomics("NQ=F", "USD");
    expect(economics?.dataClass).toBe("CONTINUOUS_FUTURES");
    expect(economics?.contract.status).toBe("UNVERIFIED");
  });

  test("NQZ6 static contract economics are verified but unknown costs and margin still block sizing", () => {
    const economics = getInstrumentRiskEconomics("NQZ6", "USD");
    expect(economics?.contract.status).toBe("VERIFIED");
    expect(economics?.contract.tickSize).toBe(0.25);
    expect(economics?.contract.quantityIncrement).toBe(1);
    expect(economics?.contract.pnlCurrencyPerPointPerUnit).toBe(20);
    expect(economics?.contract.notionalMultiplier).toBe(20);
    expect(economics?.costs.status).toBe("UNVERIFIED");
    expect(economics?.margin.status).toBe("UNVERIFIED");
  });

  test("same-currency account conversion is explicitly one-to-one", () => {
    const economics = getInstrumentRiskEconomics("XAUUSD-DUKA", "USD");
    expect(economics?.currencyConversion).toEqual({
      status: "VERIFIED",
      accountCurrency: "USD",
      pnlCurrency: "USD",
      quoteCurrency: "USD",
      pnlToAccountRate: 1,
      quoteToAccountRate: 1,
    });
  });

  test("foreign account currency remains unverified without a matching verified FX pair", () => {
    const economics = getInstrumentRiskEconomics("XAUUSD-DUKA", "EUR");
    expect(economics?.currencyConversion.status).toBe("UNVERIFIED");
    const sizing = calculateTradeSize(economics!, {
      accountEquity: 10_000,
      riskPercent: 0.5,
      availableMargin: 1_000,
      maxLeverage: 5,
      direction: "long",
      quotes: {
        entryBid: 2049.9,
        entryAsk: 2050,
        stopBid: 2040,
        stopAsk: 2040.1,
        targetBid: 2070,
        targetAsk: 2070.1,
      },
    });
    expect(sizing.status).toBe("NO_TRADE");
    if (sizing.status === "NO_TRADE") {
      expect(sizing.reasons).toContain("CURRENCY_CONVERSION_UNVERIFIED");
    }
  });

  test("accepts only verified FX rates labelled for the exact account and settlement currencies", () => {
    const validFx: VerifiedAccountCurrencyConversion = {
      status: "VERIFIED",
      accountCurrency: "EUR",
      pnlCurrency: "USD",
      quoteCurrency: "USD",
      pnlToAccountRate: 0.92,
      quoteToAccountRate: 0.92,
    };
    const valid = getInstrumentRiskEconomics("XAUUSD-DUKA", "EUR", validFx);
    expect(valid?.currencyConversion.status).toBe("VERIFIED");
    expect(valid?.currencyConversion.pnlToAccountRate).toBe(0.92);
    expect(valid?.currencyConversion.quoteToAccountRate).toBe(0.92);

    const wrongPair = getInstrumentRiskEconomics("XAUUSD-DUKA", "EUR", {
      ...validFx,
      accountCurrency: "GBP",
    });
    expect(wrongPair?.currencyConversion.status).toBe("UNVERIFIED");
    expect(wrongPair?.currencyConversion.pnlToAccountRate).toBeNull();
  });

  test("canonical metadata declares P&L settlement currency instead of assuming it in the calculator", () => {
    expect(MARKET_INSTRUMENTS["XAUUSD-DUKA"].pnlCurrency).toBe("USD");
    expect(MARKET_INSTRUMENTS["NAS100-DUKA"].pnlCurrency).toBe("USD");
    expect(MARKET_INSTRUMENTS.PAXGUSDT.pnlCurrency).toBe("USDT");
  });

  test("unknown instrument IDs return no economics rather than a similar fallback", () => {
    expect(getInstrumentRiskEconomics("NAS100", "USD")).toBeNull();
    expect(getInstrumentRiskEconomics("XAUUSD", "USD")).toBeNull();
  });
});
