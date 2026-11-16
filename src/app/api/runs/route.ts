import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireSession, badRequest, serverError } from "@/lib/api";
import { executeRun } from "@/lib/engine/runner";
import { persistRun } from "@/lib/campaign";
import { TIMEFRAMES, type Timeframe } from "@/lib/engine/types";
import { getInstrument } from "@/lib/data/instruments";

export const dynamic = "force-dynamic";

/** List recent runs (light rows). */
export async function GET(req: NextRequest) {
  const guard = await requireSession();
  if (!guard.ok) return guard.res;
  try {
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "40", 10) || 40, 200);
    const runs = await db.run.findMany({
      where: { userId: guard.userId },
      orderBy: { createdAt: "desc" },
      take: limit,
      include: { strategy: { select: { key: true, name: true, family: true, isStarter: true } } },
    });
    return NextResponse.json({
      runs: runs.map((r) => ({
        id: r.id,
        symbol: r.symbol,
        tf: r.tf,
        status: r.status,
        strategyKey: r.strategy?.key ?? "?",
        strategyName: r.strategy?.name ?? "?",
        family: r.strategy?.family ?? "?",
        daysRequested: r.daysRequested,
        barsTested: r.barsTested,
        createdAt: r.createdAt,
        campaignId: r.campaignId,
        ...(r.metrics
          ? (() => {
              const m = JSON.parse(r.metrics) as {
                trades?: number;
                profitFactor?: number;
                tStat?: number;
                netReturnPct?: number;
                maxDrawdownPct?: number;
                verdict?: string;
                robustness?: { score?: number; grade?: string };
              };
              return {
                trades: m.trades ?? 0,
                profitFactor: m.profitFactor ?? 0,
                tStat: m.tStat ?? 0,
                netReturnPct: m.netReturnPct ?? 0,
                maxDrawdownPct: m.maxDrawdownPct ?? 0,
                verdict: m.verdict ?? "UNKNOWN",
                robustnessScore: m.robustness?.score ?? 0,
                robustnessGrade: m.robustness?.grade ?? "D",
              };
            })()
          : {}),
      })),
    });
  } catch (e) {
    return serverError(e);
  }
}

interface RunBody {
  strategyKey: string;
  symbol: string;
  tf?: Timeframe;
  days?: number;
  startingEquity?: number;
}

/** Single synchronous backtest run. */
export async function POST(req: NextRequest) {
  const guard = await requireSession();
  if (!guard.ok) return guard.res;
  try {
    const body = (await req.json()) as RunBody;
    if (!body.strategyKey || !body.symbol) return badRequest("strategyKey and symbol required");
    if (!getInstrument(body.symbol)) return badRequest(`unknown symbol ${body.symbol}`);

    const strategy = await db.strategy.findFirst({
      where: { userId: guard.userId, key: body.strategyKey },
    });
    if (!strategy) return badRequest(`no strategy ${body.strategyKey}`);

    const cfg = JSON.parse(strategy.config) as { timeframe: Timeframe } & Record<string, unknown>;
    const tf = (body.tf && TIMEFRAMES.includes(body.tf) ? body.tf : cfg.timeframe) as Timeframe;
    const days = Math.min(Math.max(body.days ?? 100, 10), 1200);

    const payload = await executeRun(body.symbol, tf, cfg as never, {
      days,
      startingEquity: body.startingEquity ?? 10_000,
    });
    const run = await persistRun(guard.userId, strategy.id, null, payload, days, "DONE");
    return NextResponse.json({ runId: run.id, ...payload });
  } catch (e) {
    return serverError(e);
  }
}
