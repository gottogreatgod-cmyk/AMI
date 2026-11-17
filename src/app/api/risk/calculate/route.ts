import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/api";
import { getMarketInstrumentMetadata } from "@/lib/data/market-instrument-contract";
import { getInstrumentRiskEconomics } from "@/lib/engine/trade-calculator-adapter";
import { calculateTradeSize } from "@/lib/engine/trade-calculator";

export const dynamic = "force-dynamic";

const quotePairSchema = z.object({
  bid: z.number().finite().positive(),
  ask: z.number().finite().positive(),
}).strict();

const requestSchema = z.object({
  instrumentId: z.string().min(1).max(80),
  accountCurrency: z.string().regex(/^[A-Z]{3}$/),
  accountEquity: z.number().finite().positive(),
  riskPercent: z.number().finite().positive().max(100),
  availableMargin: z.number().finite().positive(),
  maxLeverage: z.number().finite().positive(),
  direction: z.enum(["long", "short"]),
  quotes: z.object({
    entry: quotePairSchema,
    stop: quotePairSchema,
    target: quotePairSchema,
  }).strict(),
  minimumNetRewardRisk: z.number().finite().nonnegative().optional(),
}).strict();

export async function POST(req: NextRequest) {
  const guard = await requireSession();
  if (!guard.ok) return guard.res;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({
      error: "INVALID_RISK_INPUT",
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path,
        code: issue.code,
        message: issue.message,
      })),
    }, { status: 400 });
  }

  const input = parsed.data;
  const instrument = getMarketInstrumentMetadata(input.instrumentId);
  if (!instrument) {
    return NextResponse.json({ error: "UNKNOWN_INSTRUMENT" }, { status: 404 });
  }

  const economics = getInstrumentRiskEconomics(input.instrumentId, input.accountCurrency);
  if (!economics) {
    return NextResponse.json({ error: "RISK_ECONOMICS_UNAVAILABLE" }, { status: 422 });
  }

  const result = calculateTradeSize(economics, {
    accountEquity: input.accountEquity,
    riskPercent: input.riskPercent,
    availableMargin: input.availableMargin,
    maxLeverage: input.maxLeverage,
    direction: input.direction,
    quotes: {
      entryBid: input.quotes.entry.bid,
      entryAsk: input.quotes.entry.ask,
      stopBid: input.quotes.stop.bid,
      stopAsk: input.quotes.stop.ask,
      targetBid: input.quotes.target.bid,
      targetAsk: input.quotes.target.ask,
    },
    minimumNetRewardRisk: input.minimumNetRewardRisk,
  });

  return NextResponse.json({
    instrument: {
      id: instrument.id,
      displayName: instrument.displayName,
      dataClass: instrument.dataClass,
      quoteCurrency: instrument.quoteCurrency,
      pnlCurrency: instrument.pnlCurrency,
      accountCurrency: input.accountCurrency,
      metadataVersion: instrument.metadataVersion,
    },
    operation: "CALCULATION_ONLY",
    liveOrdersEnabled: false,
    result,
  });
}
