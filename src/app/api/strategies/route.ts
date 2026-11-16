import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireSession, badRequest, serverError } from "@/lib/api";
import { STARTER_STRATEGIES, validateConfig } from "@/lib/engine/strategies";
import type { StrategyConfig } from "@/lib/engine/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireSession();
  if (!guard.ok) return guard.res;
  try {
    const strategies = await db.strategy.findMany({
      where: { userId: guard.userId },
      orderBy: [{ isStarter: "desc" }, { createdAt: "asc" }],
    });
    return NextResponse.json({
      strategies: strategies.map((s) => ({
        id: s.id,
        key: s.key,
        name: s.name,
        description: s.description,
        family: s.family,
        isStarter: s.isStarter,
        parentKey: s.parentKey,
        version: s.version,
        config: JSON.parse(s.config),
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
      starterCount: STARTER_STRATEGIES.length,
    });
  } catch (e) {
    return serverError(e);
  }
}

interface PostBody {
  action: "seed-starters" | "create" | "fork" | "delete";
  config?: StrategyConfig;
  key?: string; // for fork/delete
  name?: string; // optional rename on fork
  patch?: Partial<StrategyConfig>; // applied on fork
}

export async function POST(req: NextRequest) {
  const guard = await requireSession();
  if (!guard.ok) return guard.res;
  try {
    const body = (await req.json()) as PostBody;
    const userId = guard.userId;

    if (body.action === "seed-starters") {
      const existing = await db.strategy.findMany({ where: { userId } });
      const existingKeys = new Set(existing.map((s) => s.key));
      const toCreate = STARTER_STRATEGIES.filter((s) => !existingKeys.has(s.key));
      if (toCreate.length > 0) {
        await db.strategy.createMany({
          data: toCreate.map((s) => ({
            userId,
            key: s.key,
            name: s.name,
            description: s.description,
            family: s.family,
            config: JSON.stringify(s),
            isStarter: true,
          })),
        });
      }
      return NextResponse.json({ created: toCreate.length, skipped: STARTER_STRATEGIES.length - toCreate.length });
    }

    if (body.action === "create") {
      const cfg = body.config;
      if (!cfg) return badRequest("config required");
      const errs = validateConfig(cfg);
      if (errs.length > 0) return badRequest(errs.join("; "));
      const key = cfg.key || `${cfg.family}-${Date.now().toString(36)}`;
      const created = await db.strategy.create({
        data: {
          userId,
          key,
          name: cfg.name,
          description: cfg.description ?? "",
          family: cfg.family ?? "custom",
          config: JSON.stringify({ ...cfg, key }),
          isStarter: false,
        },
      });
      return NextResponse.json({ id: created.id, key: created.key });
    }

    if (body.action === "fork") {
      const key = body.key;
      if (!key) return badRequest("key required");
      const parent = await db.strategy.findFirst({ where: { userId, key } });
      if (!parent) return badRequest(`no strategy ${key}`);
      const parentCfg = JSON.parse(parent.config) as StrategyConfig;
      const merged: StrategyConfig = {
        ...parentCfg,
        ...(body.patch ?? {}),
        risk: { ...parentCfg.risk, ...(body.patch?.risk ?? {}) },
        exit: { ...parentCfg.exit, ...(body.patch?.exit ?? {}) },
        entry: { ...parentCfg.entry, ...(body.patch?.entry ?? {}) },
      };
      // regenerate name if params changed meaningfully
      const detail = patchLabel(body.patch ?? {});
      const forkKey = `${parent.key}-f${Date.now().toString(36).slice(-5)}`;
      const created = await db.strategy.create({
        data: {
          userId,
          key: forkKey,
          name: body.name ?? `${parent.name} — ${detail}`,
          description: `Forked from ${parent.key}${detail ? ` (${detail})` : ""}. ${parentCfg.description ?? ""}`.slice(0, 500),
          family: parent.family,
          config: JSON.stringify({ ...merged, key: forkKey }),
          isStarter: false,
          parentKey: parent.key,
          version: parent.version + 1,
        },
      });
      return NextResponse.json({ id: created.id, key: created.key, config: merged });
    }

    if (body.action === "delete") {
      const key = body.key;
      if (!key) return badRequest("key required");
      await db.strategy.deleteMany({ where: { userId, key, isStarter: false } });
      return NextResponse.json({ deleted: true });
    }

    return badRequest("unknown action");
  } catch (e) {
    return serverError(e);
  }
}

function patchLabel(patch: Record<string, unknown>): string {
  const parts: string[] = [];
  if (patch.timeframe) parts.push(`tf→${patch.timeframe}`);
  if (patch.risk && typeof patch.risk === "object") {
    const r = patch.risk as Record<string, unknown>;
    if (r.stopAtr != null) parts.push(`stop ${r.stopAtr}×ATR`);
    if (r.leverageCap != null) parts.push(`cap ${r.leverageCap}×`);
    if (r.riskPerTrade != null) parts.push(`risk ${(r.riskPerTrade as number) * 100}%`);
    if (r.sizeMode) parts.push(`${r.sizeMode} sizing`);
  }
  if (patch.htf) parts.push("htf gate");
  if (patch.exit && typeof patch.exit === "object") {
    const x = patch.exit as Record<string, unknown>;
    if (x.trailAtr != null) parts.push(`trail ${x.trailAtr}×ATR`);
    if (x.takeR != null) parts.push(`target ${x.takeR}R`);
  }
  return parts.join(", ") || "copy";
}
