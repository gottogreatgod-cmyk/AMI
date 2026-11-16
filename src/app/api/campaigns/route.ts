import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireSession, badRequest, serverError } from "@/lib/api";
import { startCampaign } from "@/lib/campaign";
import { TIMEFRAMES, type Timeframe } from "@/lib/engine/types";
import { INSTRUMENT_MAP } from "@/lib/data/instruments";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = await requireSession();
  if (!guard.ok) return guard.res;
  try {
    const limit = Math.min(parseInt(req.nextUrl.searchParams.get("limit") ?? "10", 10) || 10, 50);
    const campaigns = await db.campaign.findMany({
      where: { userId: guard.userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    });
    return NextResponse.json({
      campaigns: campaigns.map((c) => ({
        id: c.id,
        label: c.label,
        status: c.status,
        total: c.total,
        done: c.done,
        failed: c.failed,
        days: c.days,
        symbols: JSON.parse(c.symbols),
        tfs: JSON.parse(c.tfs),
        summary: c.summary ? JSON.parse(c.summary) : null,
        createdAt: c.createdAt,
        finishedAt: c.finishedAt,
      })),
    });
  } catch (e) {
    return serverError(e);
  }
}

interface CampaignBody {
  label?: string;
  strategyKeys: string[];
  symbols: string[];
  tfs: string[];
  days?: number;
}

export async function POST(req: NextRequest) {
  const guard = await requireSession();
  if (!guard.ok) return guard.res;
  try {
    const body = (await req.json()) as CampaignBody;
    if (!Array.isArray(body.strategyKeys) || body.strategyKeys.length === 0) {
      return badRequest("strategyKeys[] required");
    }
    if (!Array.isArray(body.symbols) || body.symbols.length === 0) return badRequest("symbols[] required");
    if (!Array.isArray(body.tfs) || body.tfs.length === 0) return badRequest("tfs[] required");
    const symbols = body.symbols.filter((s) => INSTRUMENT_MAP[s]);
    if (symbols.length === 0) return badRequest("no valid symbols");
    const tfs = body.tfs.filter((t): t is Timeframe => TIMEFRAMES.includes(t as Timeframe));
    if (tfs.length === 0) return badRequest("no valid timeframes");
    const days = Math.min(Math.max(body.days ?? 100, 10), 1200);

    const id = await startCampaign({
      userId: guard.userId,
      label: body.label?.slice(0, 80) || `Lab sweep ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
      strategyKeys: body.strategyKeys.slice(0, 8),
      symbols: symbols.slice(0, 15),
      tfs,
      days,
    });
    return NextResponse.json({ campaignId: id });
  } catch (e) {
    return serverError(e);
  }
}
// cache-bust v2
