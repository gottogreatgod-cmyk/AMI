import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { providerHealth } from "@/lib/data/providers";
import { cacheStats } from "@/lib/data/cache";
import { requireSession, serverError } from "@/lib/api";
import { ENGINE_VERSION } from "@/lib/engine/types";
import { binanceStats } from "@/lib/data/binance";
import { yahooStats } from "@/lib/data/yahoo";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireSession();
  if (!guard.ok) return guard.res;
  try {
    let dbOk = true;
    try {
      await db.$queryRaw`SELECT 1`;
    } catch {
      dbOk = false;
    }
    return NextResponse.json({
      engineVersion: ENGINE_VERSION,
      db: dbOk ? "OK" : "ERROR",
      providers: providerHealth(),
      cache: cacheStats(),
      providersDirect: { binance: binanceStats, yahoo: yahooStats },
      time: new Date().toISOString(),
    });
  } catch (e) {
    return serverError(e);
  }
}
