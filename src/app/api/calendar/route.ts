import { NextResponse, type NextRequest } from "next/server";
import { requireSession, serverError } from "@/lib/api";
import { getCalendar } from "@/lib/data/calendar";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const guard = await requireSession();
  if (!guard.ok) return guard.res;
  try {
    const tzOffsetMin = parseInt(req.nextUrl.searchParams.get("tz") ?? "0", 10) || 0;
    const { events, fetchedAt, source, stale } = await getCalendar();
    return NextResponse.json({
      events: events.map((e) => ({ ...e, localTs: e.ts - tzOffsetMin * 60_000 })),
      fetchedAt,
      source,
      stale: stale ?? false,
    });
  } catch (e) {
    return serverError(e);
  }
}
