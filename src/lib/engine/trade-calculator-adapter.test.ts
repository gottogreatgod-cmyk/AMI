/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import { getInstrumentRiskEconomics } from "./trade-calculator-adapter";

describe("canonical instrument risk economics adapter", () => {
  test("XAUUSD spot and NAS100 CFD remain unverified and cannot be sized", () => {
    for (const instrumentId of ["XAUUSD-DUKA", "NAS100-DUKA"]) {
      const economics = getInstrumentRiskEconomics(instrumentId);
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
    const economics = getInstrumentRiskEconomics("NQ=F");
    expect(economics?.dataClass).toBe("CONTINUOUS_FUTURES");
    expect(economics?.contract.status).toBe("UNVERIFIED");
  });

  test("unknown instrument IDs return no economics rather than a similar fallback", () => {
    expect(getInstrumentRiskEconomics("NAS100")).toBeNull();
    expect(getInstrumentRiskEconomics("XAUUSD")).toBeNull();
  });
});
