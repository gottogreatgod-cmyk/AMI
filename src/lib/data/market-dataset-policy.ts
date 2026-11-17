import type { MarketDatasetManifest } from "./market-dataset";
import {
  getMarketInstrumentMetadata,
  hasVerifiedContractEconomics,
} from "./market-instrument-contract";

export interface CapabilityDecision {
  allowed: boolean;
  reasons: string[];
}

export interface DatasetUsePolicy {
  datasetId: string;
  qualityStatus: "PASS" | "REVIEW" | "REJECTED";
  chart: CapabilityDecision;
  signalResearch: CapabilityDecision;
  strategyBacktest: CapabilityDecision;
  paperExecution: CapabilityDecision;
  liveOrderRouting: CapabilityDecision;
}

/**
 * Keep file integrity, signal research and execution eligibility separate.
 * A chart-readable bid/ask export is not automatically a tradable midpoint
 * series or a valid contract-sizing input.
 */
export function assessMarketDatasetUse(
  manifest: MarketDatasetManifest,
  options: { allowReview?: boolean } = {}
): DatasetUsePolicy {
  const metadata = getMarketInstrumentMetadata(manifest.instrument.id);
  const qualityStatus = manifest.quality.qualityStatus;
  const qualityAllowed = qualityStatus === "PASS" ||
    (qualityStatus === "REVIEW" && options.allowReview === true);

  const qualityReasons =
    qualityStatus === "REJECTED"
      ? ["Dataset quality is REJECTED; rejected revisions are never eligible."]
      : qualityStatus === "REVIEW" && !options.allowReview
        ? ["Dataset quality is REVIEW; explicit exploratory opt-in is required."]
        : [];

  const chart: CapabilityDecision = {
    allowed: qualityAllowed,
    reasons: qualityAllowed ? [] : qualityReasons,
  };

  const signalResearch: CapabilityDecision = {
    allowed: qualityAllowed,
    reasons: qualityAllowed
      ? [
          "Signals are derived from the selected quote side only; this is not a paired midpoint or execution-price series.",
        ]
      : qualityReasons,
  };

  const backtestReasons: string[] = [];
  if (manifest.pricing.datasetPriceSide !== "paired-mid") {
    backtestReasons.push(
      "This revision contains only " + manifest.pricing.datasetPriceSide.toUpperCase() +
      " candles. Backtest execution requires a verified bid/ask-paired dataset."
    );
  }
  if (!metadata || metadata.costs.status !== "VERIFIED") {
    backtestReasons.push("Instrument-specific spread, fees, slippage and financing costs are not verified.");
  }
  if (!metadata || !hasVerifiedContractEconomics(metadata)) {
    backtestReasons.push("Instrument contract economics are not verified for quantity/risk calculations.");
  }
  if (qualityStatus === "REJECTED") {
    backtestReasons.push("Rejected datasets cannot be used for strategy backtests.");
  } else if (qualityStatus === "REVIEW" && !options.allowReview) {
    backtestReasons.push("REVIEW datasets require explicit exploratory opt-in before research use.");
  }

  const paperExecution: CapabilityDecision = {
    allowed: false,
    reasons: [
      "The paper order-management and forward-audit workflow has not yet been certified.",
      ...backtestReasons,
    ],
  };

  return {
    datasetId: manifest.datasetId,
    qualityStatus,
    chart,
    signalResearch,
    strategyBacktest: {
      allowed: backtestReasons.length === 0,
      reasons: backtestReasons,
    },
    paperExecution,
    liveOrderRouting: {
      allowed: false,
      reasons: ["Live order routing is disabled by the AMI FTC operating policy."],
    },
  };
}
