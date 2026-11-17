import { getMarketInstrumentMetadata, hasVerifiedContractEconomics } from "@/lib/data/market-instrument-contract";
import type { InstrumentRiskEconomics } from "./trade-calculator";

/**
 * Adapts canonical registry facts into the calculator contract. This function
 * never fills missing economics with defaults or derives multipliers from
 * asset class, symbol naming or another instrument.
 */
export function getInstrumentRiskEconomics(
  instrumentId: string
): InstrumentRiskEconomics | null {
  const instrument = getMarketInstrumentMetadata(instrumentId);
  if (!instrument) return null;

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
      // Spread is expected to be represented in the executable bid/ask quotes
      // supplied for entry, stop and target; this is not inferred from a default.
      slippageBpsPerSide: instrument.costs.slippageBpsPerSide,
    },
    margin: {
      status: marginVerified ? "VERIFIED" : "UNVERIFIED",
      initialMarginRate: instrument.contract.initialMarginRate,
      initialMarginPerUnit: instrument.contract.initialMarginPerUnit,
    },
  };
}
