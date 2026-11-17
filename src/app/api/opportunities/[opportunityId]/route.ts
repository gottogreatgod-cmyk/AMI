import { NextResponse, type NextRequest } from "next/server";
import { requireSession } from "@/lib/api";
import { getPersistentOpportunity, OpportunityStoreError } from "@/lib/engine/opportunity-store";

export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ opportunityId: string }> }
) {
  const guard = await requireSession();
  if (!guard.ok) return guard.res;

  const { opportunityId } = await ctx.params;
  try {
    const result = await getPersistentOpportunity(guard.userId, opportunityId);
    if (!result) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
    return NextResponse.json(result);
  } catch (error) {
    const status = error instanceof OpportunityStoreError ? 422 : 500;
    return NextResponse.json({
      error: error instanceof OpportunityStoreError ? error.code : "OPPORTUNITY_READ_FAILED",
      message: error instanceof Error ? error.message : String(error),
    }, { status });
  }
}
