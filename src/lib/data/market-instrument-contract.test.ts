/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import {
  getMarketInstrumentMetadata,
  hasVerifiedContractEconomics,
  isDataClass,
  MARKET_INSTRUMENTS,
} from "./market-instrument-contract";

describe("canonical market instrument metadata", () => {
  test("Nasdaq-style Dukascopy index remains a CFD, never an NQ futures contract", () => {
    const nas100 = MARKET_INSTRUMENTS["NAS100-DUKA"];

    expect(nas100.dataClass).toBe("BROKER_CFD");
    expect(nas100.providerInstrument).toBe("usatechidxusd");
    expect(nas100.contract.pointValue).toBeNull();
    expect(isDataClass(nas100, "EXCHANGE_FUTURES")).toBe(false);
    expect(hasVerifiedContractEconomics(nas100)).toBe(false);
  });

  test("Dukascopy XAU/USD preserves OTC bid/ask and tick-volume semantics", () => {
    const gold = MARKET_INSTRUMENTS["XAUUSD-DUKA"];

    expect(gold.dataClass).toBe("OTC_SPOT_METAL");
    expect(gold.quoteSide).toBe("BID_ASK");
    expect(gold.analysisPriceSide).toBe("MID");
    expect(gold.volumeSemantics).toBe("PROVIDER_REPORTED");
    expect(hasVerifiedContractEconomics(gold)).toBe(false);
  });

  test("NQZ6 is a dated CME futures sample, separate from CFD and continuous references", () => {
    const nqDated = MARKET_INSTRUMENTS.NQZ6;
    expect(nqDated.dataClass).toBe("EXCHANGE_FUTURES");
    expect(nqDated.provider).toBe("HistoricalFuturesData");
    expect(nqDated.providerInstrument).toBe("NQZ6");
    expect(nqDated.quoteSide).toBe("TRADE");
    expect(nqDated.volumeSemantics).toBe("EXCHANGE_TRADED_VOLUME");
    expect(nqDated.contract.status).toBe("UNVERIFIED");
    expect(nqDated.contract.pointValue).toBeNull();
    expect(hasVerifiedContractEconomics(nqDated)).toBe(false);
    expect(isDataClass(nqDated, "BROKER_CFD")).toBe(false);
    expect(nqDated.id).not.toBe(MARKET_INSTRUMENTS["NAS100-DUKA"].id);
    expect(nqDated.id).not.toBe(MARKET_INSTRUMENTS["NQ=F"].id);
  });

  test("continuous futures cannot be treated as dated contracts for sizing", () => {
    expect(MARKET_INSTRUMENTS["NQ=F"].dataClass).toBe("CONTINUOUS_FUTURES");
    expect(MARKET_INSTRUMENTS["GC=F"].dataClass).toBe("CONTINUOUS_FUTURES");
    expect(hasVerifiedContractEconomics(MARKET_INSTRUMENTS["NQ=F"])).toBe(false);
    expect(hasVerifiedContractEconomics(MARKET_INSTRUMENTS["GC=F"])).toBe(false);
  });

  test("PAXG is kept distinct from OTC XAU/USD and COMEX gold futures", () => {
    expect(MARKET_INSTRUMENTS.PAXGUSDT.dataClass).toBe("TOKENIZED_METAL");
    expect(MARKET_INSTRUMENTS.PAXGUSDT.id).not.toBe("XAUUSD-DUKA");
    expect(MARKET_INSTRUMENTS.PAXGUSDT.id).not.toBe("GC=F");
  });

  test("unknown canonical IDs do not silently fall back to a similar market", () => {
    expect(getMarketInstrumentMetadata("NAS100")).toBeNull();
    expect(getMarketInstrumentMetadata("XAUUSD")).toBeNull();
  });
});
