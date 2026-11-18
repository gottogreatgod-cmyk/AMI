/**
 * Canonical market identity and contract-economics metadata.
 *
 * This catalogue is intentionally separate from the currently active feed
 * registry: Dukascopy instruments are research/import candidates until their
 * importer has been implemented and provider coverage has been verified.
 * Never infer a futures multiplier from an index/CFD/continuous-series label.
 */

export type MarketDataClass =
  | "BROKER_CFD"
  | "OTC_SPOT_METAL"
  | "EXCHANGE_FUTURES"
  | "CONTINUOUS_FUTURES"
  | "ETF"
  | "CASH_INDEX"
  | "SPOT_CRYPTO"
  | "TOKENIZED_METAL"
  | "OTC_FX_SPOT";

export type MarketQuoteSide = "BID_ASK" | "LAST" | "TRADE";
export type MarketVolumeSemantics =
  | "TICK_COUNT"
  | "EXCHANGE_TRADED_VOLUME"
  | "PROVIDER_REPORTED"
  | "UNAVAILABLE";
export type ContractSpecStatus = "VERIFIED" | "UNVERIFIED" | "NOT_APPLICABLE";
export type ProviderReadiness = "ACTIVE" | "HISTORICAL_CANDIDATE" | "REFERENCE_ONLY";

export interface CanonicalInstrumentMetadata {
  readonly id: string;
  readonly displayName: string;
  readonly assetClass: "index" | "futures" | "metals" | "crypto";
  readonly dataClass: MarketDataClass;
  readonly provider: "Dukascopy" | "Yahoo Finance" | "CME" | "Binance" | "HistoricalFuturesData" | null;
  readonly providerInstrument: string | null;
  readonly providerReadiness: ProviderReadiness;
  readonly quoteCurrency: "USD" | "USDT";
  /** Currency in which contract P&L is settled; never inferred by the risk calculator. */
  readonly pnlCurrency: "USD" | "USDT";
  readonly quoteSide: MarketQuoteSide;
  readonly analysisPriceSide: "MID" | "LAST" | "TRADE";
  readonly volumeSemantics: MarketVolumeSemantics;
  readonly session: {
    readonly calendar: string;
    readonly timezone: string | null;
    readonly hoursVerified: boolean;
  };
  readonly contract: {
    readonly status: ContractSpecStatus;
    readonly tickSize: number | null;
    readonly quantityIncrement: number | null;
    readonly pointValue: number | null;
    /** Contract notional multiplier per unit; never inferred from another instrument. */
    readonly notionalMultiplier: number | null;
    /** Exactly one verified model may be populated when margin is sourced. */
    readonly initialMarginRate: number | null;
    readonly initialMarginPerUnit: number | null;
    readonly expiry: string | null;
    readonly verificationSource: string | null;
  };
  readonly costs: {
    readonly status: "UNVERIFIED" | "ESTIMATE" | "VERIFIED";
    readonly feeBpsPerSide: number | null;
    readonly spreadBps: number | null;
    readonly slippageBpsPerSide: number | null;
    readonly note: string;
  };
  readonly dataUse: {
    readonly classification: "LOCAL_RESEARCH_ONLY" | "SUBJECT_TO_PROVIDER_TERMS" | "PUBLIC_REFERENCE_ONLY";
    readonly note: string;
  };
  readonly metadataVersion: 3;
}

const unavailableContract = {
  status: "UNVERIFIED",
  tickSize: null,
  quantityIncrement: null,
  pointValue: null,
  notionalMultiplier: null,
  initialMarginRate: null,
  initialMarginPerUnit: null,
  expiry: null,
  verificationSource: null,
} as const;

const unverifiedCosts = {
  status: "UNVERIFIED",
  feeBpsPerSide: null,
  spreadBps: null,
  slippageBpsPerSide: null,
  note: "Execution costs must be measured or sourced for the selected provider/account; no default is inferred.",
} as const;

/**
 * Research-first catalog for AMI's two primary markets and their comparison
 * series. This metadata does not itself enable execution or market downloads.
 */
export const MARKET_INSTRUMENTS = {
  "NAS100-DUKA": {
    id: "NAS100-DUKA",
    displayName: "USA 100 Technical Index CFD",
    assetClass: "index",
    dataClass: "BROKER_CFD",
    provider: "Dukascopy",
    providerInstrument: "usatechidxusd",
    providerReadiness: "HISTORICAL_CANDIDATE",
    quoteCurrency: "USD",
    pnlCurrency: "USD",
    quoteSide: "BID_ASK",
    analysisPriceSide: "MID",
    volumeSemantics: "PROVIDER_REPORTED",
    session: {
      calendar: "Dukascopy CFD provider calendar",
      timezone: "UTC",
      hoursVerified: false,
    },
    contract: unavailableContract,
    costs: {
      ...unverifiedCosts,
      note: "CFD spread, financing, contract value and execution costs are not yet verified.",
    },
    dataUse: {
      classification: "LOCAL_RESEARCH_ONLY",
      note: "Keep provider data private unless Dukascopy/data-provider terms explicitly permit redistribution.",
    },
    metadataVersion: 3,
  },
  "XAUUSD-DUKA": {
    id: "XAUUSD-DUKA",
    displayName: "Gold / US Dollar spot",
    assetClass: "metals",
    dataClass: "OTC_SPOT_METAL",
    provider: "Dukascopy",
    providerInstrument: "xauusd",
    providerReadiness: "HISTORICAL_CANDIDATE",
    quoteCurrency: "USD",
    pnlCurrency: "USD",
    quoteSide: "BID_ASK",
    analysisPriceSide: "MID",
    volumeSemantics: "PROVIDER_REPORTED",
    session: {
      calendar: "Dukascopy OTC metals calendar",
      timezone: "UTC",
      hoursVerified: false,
    },
    contract: unavailableContract,
    costs: {
      ...unverifiedCosts,
      note: "Use bid/ask spread and provider/account conditions; no generic spot-metal lot value is assumed.",
    },
    dataUse: {
      classification: "LOCAL_RESEARCH_ONLY",
      note: "OTC provider quotes are not a consolidated exchange tape; verify redistribution terms before sharing data.",
    },
    metadataVersion: 3,
  },
  NQ: {
    id: "NQ",
    displayName: "CME E-mini Nasdaq-100 dated futures",
    assetClass: "futures",
    dataClass: "EXCHANGE_FUTURES",
    provider: "CME",
    providerInstrument: null,
    providerReadiness: "REFERENCE_ONLY",
    quoteCurrency: "USD",
    pnlCurrency: "USD",
    quoteSide: "LAST",
    analysisPriceSide: "LAST",
    volumeSemantics: "EXCHANGE_TRADED_VOLUME",
    session: {
      calendar: "CME equity index futures calendar",
      timezone: "America/Chicago",
      hoursVerified: false,
    },
    contract: unavailableContract,
    costs: {
      ...unverifiedCosts,
      note: "Dated contract, fees, tick value and margin schedule must be sourced before paper sizing.",
    },
    dataUse: {
      classification: "SUBJECT_TO_PROVIDER_TERMS",
      note: "No full free official intraday history is assumed; use only provenance-verified sample/reference data.",
    },
    metadataVersion: 3,
  },
  NQZ6: {
    id: "NQZ6",
    displayName: "CME E-mini Nasdaq-100 dated futures · Dec 2026 sample",
    assetClass: "futures",
    dataClass: "EXCHANGE_FUTURES",
    provider: "HistoricalFuturesData",
    providerInstrument: "NQZ6",
    providerReadiness: "HISTORICAL_CANDIDATE",
    quoteCurrency: "USD",
    pnlCurrency: "USD",
    quoteSide: "TRADE",
    analysisPriceSide: "LAST",
    volumeSemantics: "EXCHANGE_TRADED_VOLUME",
    session: {
      calendar: "CME equity index futures calendar",
      timezone: "America/Chicago",
      hoursVerified: false,
    },
    contract: {
      status: "VERIFIED",
      tickSize: 0.25,
      quantityIncrement: 1,
      pointValue: 20,
      notionalMultiplier: 20,
      initialMarginRate: null,
      initialMarginPerUnit: null,
      expiry: null,
      verificationSource: "CME E-mini Nasdaq-100 futures contract specifications: https://www.cmegroup.com/markets/equities/nasdaq/e-mini-nasdaq-100.contractSpecs.html",
    },
    costs: {
      ...unverifiedCosts,
      note: "CME static tick and multiplier are verified, but commissions, spread, slippage, exchange/broker fees and current initial margin remain unverified.",
    },
    dataUse: {
      classification: "LOCAL_RESEARCH_ONLY",
      note: "Historical Futures Data sample pack is restricted to private/internal evaluation, research and backtesting; redistribution, resale, commercial use and shared access are not included.",
    },
    metadataVersion: 3,
  },
  "NQ=F": {
    id: "NQ=F",
    displayName: "Yahoo continuous Nasdaq futures reference",
    assetClass: "futures",
    dataClass: "CONTINUOUS_FUTURES",
    provider: "Yahoo Finance",
    providerInstrument: "NQ=F",
    providerReadiness: "ACTIVE",
    quoteCurrency: "USD",
    pnlCurrency: "USD",
    quoteSide: "LAST",
    analysisPriceSide: "LAST",
    volumeSemantics: "PROVIDER_REPORTED",
    session: {
      calendar: "Yahoo provider calendar for continuous futures",
      timezone: null,
      hoursVerified: false,
    },
    contract: unavailableContract,
    costs: {
      ...unverifiedCosts,
      note: "Continuous-series history is a research reference; dated-contract execution costs do not apply.",
    },
    dataUse: {
      classification: "PUBLIC_REFERENCE_ONLY",
      note: "Not a dated tradable contract; record provider/roll methodology and respect source terms.",
    },
    metadataVersion: 3,
  },
  "GC=F": {
    id: "GC=F",
    displayName: "Yahoo continuous COMEX gold futures reference",
    assetClass: "futures",
    dataClass: "CONTINUOUS_FUTURES",
    provider: "Yahoo Finance",
    providerInstrument: "GC=F",
    providerReadiness: "ACTIVE",
    quoteCurrency: "USD",
    pnlCurrency: "USD",
    quoteSide: "LAST",
    analysisPriceSide: "LAST",
    volumeSemantics: "PROVIDER_REPORTED",
    session: {
      calendar: "Yahoo provider calendar for continuous futures",
      timezone: null,
      hoursVerified: false,
    },
    contract: unavailableContract,
    costs: {
      ...unverifiedCosts,
      note: "Continuous-series history is a research reference; dated-contract execution costs do not apply.",
    },
    dataUse: {
      classification: "PUBLIC_REFERENCE_ONLY",
      note: "Not spot XAU/USD and not a dated tradable contract; record roll methodology and respect source terms.",
    },
    metadataVersion: 3,
  },
  PAXGUSDT: {
    id: "PAXGUSDT",
    displayName: "PAX Gold token / USDT",
    assetClass: "crypto",
    dataClass: "TOKENIZED_METAL",
    provider: "Binance",
    providerInstrument: "PAXGUSDT",
    providerReadiness: "ACTIVE",
    quoteCurrency: "USDT",
    pnlCurrency: "USDT",
    quoteSide: "TRADE",
    analysisPriceSide: "TRADE",
    volumeSemantics: "EXCHANGE_TRADED_VOLUME",
    session: {
      calendar: "Binance spot 24/7",
      timezone: "UTC",
      hoursVerified: true,
    },
    contract: {
      status: "NOT_APPLICABLE",
      tickSize: null,
      quantityIncrement: null,
      pointValue: null,
      notionalMultiplier: null,
      initialMarginRate: null,
      initialMarginPerUnit: null,
      expiry: null,
      verificationSource: null,
    },
    costs: unverifiedCosts,
    dataUse: {
      classification: "SUBJECT_TO_PROVIDER_TERMS",
      note: "A gold-backed crypto token; not OTC XAU/USD spot or COMEX GC futures.",
    },
    metadataVersion: 3,
  },
} as const satisfies Record<string, CanonicalInstrumentMetadata>;

export type CanonicalInstrumentId = keyof typeof MARKET_INSTRUMENTS;

/** True only when the instrument's actual contract economics are verified. */
export function hasVerifiedContractEconomics(
  instrument: CanonicalInstrumentMetadata
): boolean {
  const { contract, dataClass } = instrument;
  if (dataClass === "CONTINUOUS_FUTURES" || dataClass === "CASH_INDEX") return false;
  if (contract.status !== "VERIFIED") return false;
  return (
    contract.tickSize !== null &&
    contract.tickSize > 0 &&
    contract.quantityIncrement !== null &&
    contract.quantityIncrement > 0 &&
    contract.pointValue !== null &&
    contract.pointValue > 0
  );
}

export function isDataClass(
  instrument: CanonicalInstrumentMetadata,
  expected: MarketDataClass
): boolean {
  return instrument.dataClass === expected;
}

export function getMarketInstrumentMetadata(id: string): CanonicalInstrumentMetadata | null {
  return MARKET_INSTRUMENTS[id as CanonicalInstrumentId] ?? null;
}
