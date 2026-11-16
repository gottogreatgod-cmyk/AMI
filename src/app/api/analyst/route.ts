import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireSession, serverError } from "@/lib/api";
import { buildAnalystContext } from "@/lib/analyst";
import { generateBriefing } from "@/lib/briefing";
import { cacheGet, cacheSet } from "@/lib/data/cache";
import { STARTER_STRATEGIES } from "@/lib/engine/strategies";
import type { StrategyConfig } from "@/lib/engine/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const guard = await requireSession();
  if (!guard.ok) return guard.res;
  try {
    const tzOffsetMin = parseInt(req.nextUrl.searchParams.get("tz") ?? "0", 10) || 0;
    const cacheKey = `analyst-full|${guard.userId}|${tzOffsetMin}`;
    const cached = cacheGet<unknown>(cacheKey);
    if (cached) return NextResponse.json(cached);

    // user's strategies (or the starter defaults) feed the engine-signal strip
    const userStrategies = await db.strategy.findMany({
      where: { userId: guard.userId },
      take: 5,
      orderBy: [{ isStarter: "desc" }, { createdAt: "asc" }],
    });
    const signalConfigs =
      userStrategies.length > 0
        ? userStrategies.map((s) => {
            const cfg = JSON.parse(s.config) as StrategyConfig;
            return { cfg, symbols: ["BTCUSDT", "NQ=F", "EURUSD=X"] };
          })
        : STARTER_STRATEGIES.slice(0, 5).map((cfg) => ({ cfg, symbols: ["BTCUSDT", "NQ=F", "EURUSD=X"] }));

    const ctx = await buildAnalystContext(signalConfigs, tzOffsetMin);
    const briefing = await generateBriefing(ctx);
    const payload = {
      ...ctx,
      briefing: briefing.text,
      llm: { used: briefing.used, latencyMs: briefing.latencyMs, note: briefing.note ?? null },
    };
    cacheSet(cacheKey, payload, 300_000);
    return NextResponse.json(payload);
  } catch (e) {
    return serverError(e);
  }
}
