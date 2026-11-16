import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireSession, serverError } from "@/lib/api";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireSession();
  if (!guard.ok) return guard.res;
  try {
    const { id } = await ctx.params;
    const run = await db.run.findFirst({
      where: { id, userId: guard.userId },
      include: { strategy: { select: { key: true, name: true, family: true, config: true } } },
    });
    if (!run) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({
      id: run.id,
      symbol: run.symbol,
      tf: run.tf,
      status: run.status,
      error: run.error,
      daysRequested: run.daysRequested,
      fromTs: run.fromTs,
      toTs: run.toTs,
      barsTested: run.barsTested,
      createdAt: run.createdAt,
      campaignId: run.campaignId,
      strategy: run.strategy ? { key: run.strategy.key, name: run.strategy.name, family: run.strategy.family, config: JSON.parse(run.strategy.config) } : null,
      metrics: run.metrics ? JSON.parse(run.metrics) : null,
      trades: run.trades ? JSON.parse(run.trades) : [],
      equity: run.equity ? JSON.parse(run.equity) : [],
      review: run.review ? JSON.parse(run.review) : null,
      dataQuality: run.dataQuality ? JSON.parse(run.dataQuality) : null,
    });
  } catch (e) {
    return serverError(e);
  }
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireSession();
  if (!guard.ok) return guard.res;
  try {
    const { id } = await ctx.params;
    await db.run.deleteMany({ where: { id, userId: guard.userId } });
    return NextResponse.json({ deleted: true });
  } catch (e) {
    return serverError(e);
  }
}
