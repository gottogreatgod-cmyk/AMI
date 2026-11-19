import { getMarketInstrumentMetadata, hasVerifiedContractEconomics } from "@/lib/data/market-instrument-contract";
import type { InstrumentRiskEconomics } from "./trade-calculator";

export interface VerifiedAccountCurrencyConversion {
  status: "VERIFIED" | "UNVERIFIED";
  accountCurrency: string;
  pnlCurrency: string;
  quoteCurrency: string;
  pnlToAccountRate: number | null;
  quoteToAccountRate: number | null;
}

/**
 * Adapts canonical registry facts into the calculator contract. This function
 * never fills missing contract, cost, margin or FX facts with defaults.
 *
 * If both settlement currencies already equal the account currency, the
 * conversion is exactly 1. Otherwise the caller must supply independently
 * verified conversion rates whose currency pair labels match this request.
 */
export function getInstrumentRiskEconomics(
  instrumentId: string,
  accountCurrency: string,
  conversion?: VerifiedAccountCurrencyConversion
): InstrumentRiskEconomics | null {
  const instrument = getMarketInstrumentMetadata(instrumentId);
  if (!instrument) return null;

  const normalizedAccountCurrency = accountCurrency.trim().toUpperCase();
  const sameCurrency =
    normalizedAccountCurrency === instrument.pnlCurrency &&
    normalizedAccountCurrency === instrument.quoteCurrency;

  const conversionMatches =
    conversion?.accountCurrency.trim().toUpperCase() === normalizedAccountCurrency &&
    conversion?.pnlCurrency === instrument.pnlCurrency &&
    conversion?.quoteCurrency === instrument.quoteCurrency;

  const currencyConversion = sameCurrency
    ? {
        status: "VERIFIED" as const,
        accountCurrency: normalizedAccountCurrency,
        pnlCurrency: instrument.pnlCurrency,
        quoteCurrency: instrument.quoteCurrency,
        pnlToAccountRate: 1,
        quoteToAccountRate: 1,
      }
    : {
        status: conversion?.status === "VERIFIED" && conversionMatches
          ? "VERIFIED" as const
          : "UNVERIFIED" as const,
        accountCurrency: normalizedAccountCurrency,
        pnlCurrency: instrument.pnlCurrency,
        quoteCurrency: instrument.quoteCurrency,
        pnlToAccountRate: conversionMatches ? conversion?.pnlToAccountRate ?? null : null,
        quoteToAccountRate: conversionMatches ? conversion?.quoteToAccountRate ?? null : null,
      };

  const marginRate = instrument.contract.initialMarginRate;
  const marginPerUnit = instrument.contract.initialMarginPerUnit;
  const hasMarginRate = marginRate !== null && Number.isFinite(marginRate) && marginRate > 0;
  const hasMarginPerUnit = marginPerUnit !== null && Number.isFinite(marginPerUnit) && marginPerUnit > 0;
  const marginVerified =
    instrument.contract.status === "VERIFIED" &&
    hasMarginRate !== hasMarginPerUnit;

  return {
    instrumentId: instrument.id,
    dataClass: instrument.dataClass,
    currencyConversion,
    contract: {
      status: hasVerifiedContractEconomics(instrument) ? "VERIFIED" : "UNVERIFIED",
      tickSize: instrument.contract.tickSize,
      quantityIncrement: instrument.contract.quantityIncrement,
      pnlCurrencyPerPointPerUnit: instrument.contract.pointValue,
      notionalMultiplier: instrument.contract.notionalMultiplier,
    },
    costs: {
      status: instrument.costs.status === "VERIFIED" ? "VERIFIED" : "UNVERIFIED",
      commissionBpsPerSide: instrument.costs.feeBpsPerSide,
      // Spread is represented by the executable bid/ask quotes supplied
      // for entry, stop and target; do not add it again as a percentage cost.
      slippageBpsPerSide: instrument.costs.slippageBpsPerSide,
    },
    margin: {
      status: marginVerified ? "VERIFIED" : "UNVERIFIED",
      initialMarginRate: instrument.contract.initialMarginRate,
      initialMarginPerUnit: instrument.contract.initialMarginPerUnit,
    },
  };
}
