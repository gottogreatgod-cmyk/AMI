import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession, serverError } from "@/lib/api";

export const dynamic = "force-dynamic";

/**
 * Leaderboard — best run per (strategy × symbol × tf), ranked by robustness
 * score, not by return. Verdict badges come from the engine's split-sample
 * check, so a lucky single half cannot rank at the top.
 */
export async function GET() {
  const guard = await requireSession();
  if (!guard.ok) return guard.res;
  try {
    const runs = await db.run.findMany({
      where: { userId: guard.userId, status: "DONE" },
      orderBy: { createdAt: "desc" },
      take: 2500,
      include: { strategy: { select: { key: true, name: true, family: true } } },
    });

    const best = new Map<
      string,
      {
        id: string;
        strategyKey: string;
        strategyName: string;
        family: string;
        symbol: string;
        tf: string;
        trades: number;
        pf: number;
        tStat: number;
        netReturnPct: number;
        maxDrawdownPct: number;
        expectancyR: number;
        winRate: number;
        verdict: string;
        score: number;
        grade: string;
        splitNote: string;
        days: number;
        createdAt: string;
        liquidations: number;
        costDragPct: number;
      }
    >();

    for (const r of runs) {
      if (!r.metrics) continue;
      let m: Record<string, unknown>;
      try {
        m = JSON.parse(r.metrics);
      } catch {
        continue;
      }
      const key = `${r.strategy?.key ?? "?"}|${r.symbol}|${r.tf}`;
      const score = ((m.robustness as { score?: number })?.score ?? 0) as number;
      const existing = best.get(key);
      if (existing && existing.score >= score) continue;
      best.set(key, {
        id: r.id,
        strategyKey: r.strategy?.key ?? "?",
        strategyName: r.strategy?.name ?? "?",
        family: r.strategy?.family ?? "?",
        symbol: r.symbol,
        tf: r.tf,
        trades: (m.trades as number) ?? 0,
        pf: (m.profitFactor as number) ?? 0,
        tStat: (m.tStat as number) ?? 0,
        netReturnPct: (m.netReturnPct as number) ?? 0,
        maxDrawdownPct: (m.maxDrawdownPct as number) ?? 0,
        expectancyR: (m.expectancyR as number) ?? 0,
        winRate: (m.winRate as number) ?? 0,
        verdict: (m.verdict as string) ?? "UNKNOWN",
        score,
        grade: ((m.robustness as { grade?: string })?.grade ?? "D") as string,
        splitNote: ((m.split as { note?: string })?.note ?? "") as string,
        days: r.daysRequested,
        createdAt: r.createdAt.toISOString(),
        liquidations: (m.liquidations as number) ?? 0,
        costDragPct: (m.costDragPct as number) ?? 0,
      });
    }

    const rows = [...best.values()].sort((a, b) => b.score - a.score).slice(0, 60);
    return NextResponse.json({ leaderboard: rows, generatedAt: Date.now() });
  } catch (e) {
    return serverError(e);
  }
}
