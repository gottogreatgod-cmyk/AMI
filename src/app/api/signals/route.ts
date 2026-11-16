import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireSession, badRequest, serverError } from "@/lib/api";
import { currentSignalState } from "@/lib/engine/runner";
import { getInstrument } from "@/lib/data/instruments";
import { cacheGet, cacheSet } from "@/lib/data/cache";
import type { StrategyConfig } from "@/lib/engine/types";

export const dynamic = "force-dynamic";

/** Current signal states of all the user's strategies for one symbol. */
export async function GET(req: NextRequest) {
  const guard = await requireSession();
  if (!guard.ok) return guard.res;
  try {
    const symbol = req.nextUrl.searchParams.get("symbol") ?? "BTCUSDT";
    if (!getInstrument(symbol)) return badRequest(`unknown symbol ${symbol}`);
    const cacheKey = `signals|${guard.userId}|${symbol}`;
    const cached = cacheGet<unknown>(cacheKey);
    if (cached) return NextResponse.json(cached);

    const strategies = await db.strategy.findMany({ where: { userId: guard.userId } });
    const states = await Promise.all(
      strategies.slice(0, 12).map(async (s) => {
        try {
          const cfg = JSON.parse(s.config) as StrategyConfig;
          const st = await currentSignalState(symbol, cfg.timeframe, cfg);
          return { ...st, strategyId: s.id, isStarter: s.isStarter };
        } catch {
          return null;
        }
      })
    );
    const payload = {
      symbol,
      states: states.filter(Boolean),
      generatedAt: Date.now(),
    };
    cacheSet(cacheKey, payload, 60_000);
    return NextResponse.json(payload);
  } catch (e) {
    return serverError(e);
  }
}
