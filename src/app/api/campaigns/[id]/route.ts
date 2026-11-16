import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireSession, serverError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireSession();
  if (!guard.ok) return guard.res;
  try {
    const { id } = await ctx.params;
    const campaign = await db.campaign.findFirst({
      where: { id, userId: guard.userId },
    });
    if (!campaign) return NextResponse.json({ error: "not found" }, { status: 404 });

    const runs = await db.run.findMany({
      where: { campaignId: campaign.id },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({
      id: campaign.id,
      label: campaign.label,
      status: campaign.status,
      total: campaign.total,
      done: campaign.done,
      failed: campaign.failed,
      days: campaign.days,
      summary: campaign.summary ? JSON.parse(campaign.summary) : null,
      createdAt: campaign.createdAt,
      finishedAt: campaign.finishedAt,
      runs: runs.map((r) => {
        let m: Record<string, unknown> = {};
        try {
          m = r.metrics ? JSON.parse(r.metrics) : {};
        } catch {
          m = {};
        }
        return {
          id: r.id,
          symbol: r.symbol,
          tf: r.tf,
          status: r.status,
          trades: (m.trades as number) ?? 0,
          profitFactor: (m.profitFactor as number) ?? 0,
          tStat: (m.tStat as number) ?? 0,
          netReturnPct: (m.netReturnPct as number) ?? 0,
          maxDrawdownPct: (m.maxDrawdownPct as number) ?? 0,
          verdict: (m.verdict as string) ?? r.status,
          robustnessScore: ((m.robustness as { score?: number })?.score ?? 0) as number,
          robustnessGrade: ((m.robustness as { grade?: string })?.grade ?? "D") as string,
        };
      }),
    });
  } catch (e) {
    return serverError(e);
  }
}
