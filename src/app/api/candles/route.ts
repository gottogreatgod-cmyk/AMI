import { NextResponse, type NextRequest } from "next/server";
import { getBars } from "@/lib/data/providers";
import { getInstrument } from "@/lib/data/instruments";
import { requireSession, badRequest, serverError } from "@/lib/api";
import { TIMEFRAMES, type Timeframe } from "@/lib/engine/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = await requireSession();
  if (!guard.ok) return guard.res;
  try {
    const sp = req.nextUrl.searchParams;
    const symbol = sp.get("symbol") ?? "";
    const tf = (sp.get("tf") ?? "1h") as Timeframe;
    const limit = Math.min(parseInt(sp.get("limit") ?? "500", 10) || 500, 2000);
    const days = Math.min(parseInt(sp.get("days") ?? "30", 10) || 30, 400);

    const inst = getInstrument(symbol);
    if (!inst) return badRequest(`unknown symbol ${symbol}`);
    if (!TIMEFRAMES.includes(tf)) return badRequest(`unknown timeframe ${tf}`);

    const { bars, quality } = await getBars(symbol, tf, { days });
    const sliced = bars.length > limit ? bars.slice(bars.length - limit) : bars;
    return NextResponse.json({
      symbol,
      tf,
      bars: sliced,
      quality: { ...quality, bars: sliced.length },
    });
  } catch (e) {
    return serverError(e);
  }
}
