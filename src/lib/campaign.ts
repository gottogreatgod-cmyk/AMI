// ---------------------------------------------------------------------------
// Campaign engine — one rule set across many markets at once, with progress
// per market, stored runs, and a leaderboard ranked by robustness.
// Campaigns execute in-process with bounded concurrency; every run persists.
// ---------------------------------------------------------------------------

import { db } from "@/lib/db";
import { executeRun, type RunPayload } from "@/lib/engine/runner";
import type { StrategyConfig, Timeframe } from "@/lib/engine/types";
import { TIMEFRAMES } from "@/lib/engine/types";
import { getInstrument } from "@/lib/data/instruments";
import { EXTENDED_MAX_BARS } from "@/lib/data/instruments";

export interface CampaignSpec {
  userId: string;
  label: string;
  strategyKeys: string[];
  symbols: string[];
  tfs: Timeframe[];
  days: number;
  maxBars?: number;
}

export async function startCampaign(spec: CampaignSpec): Promise<string> {
  const strategies = await db.strategy.findMany({
    where: { userId: spec.userId, key: { in: spec.strategyKeys } },
  });
  if (strategies.length === 0) throw new Error("no matching strategies");

  const campaign = await db.campaign.create({
    data: {
      userId: spec.userId,
      label: spec.label,
      strategyIds: JSON.stringify(strategies.map((s) => s.id)),
      symbols: JSON.stringify(spec.symbols),
      tfs: JSON.stringify(spec.tfs.filter((t) => TIMEFRAMES.includes(t))),
      days: spec.days,
      total: strategies.length * spec.symbols.length * spec.tfs.length,
      status: "RUNNING",
    },
  });

  // fire-and-forget in-process job (dev server lifetime = job lifetime) — v2 invalidate
  void executeCampaignJob(campaign.id).catch(async (e) => {
    await db.campaign.update({
      where: { id: campaign.id },
      data: { status: "ERROR", finishedAt: new Date(), summary: JSON.stringify({ error: String(e) }) },
    });
  });

  return campaign.id;
}

export async function executeCampaignJob(campaignId: string): Promise<void> {
  const campaignRow = await db.campaign.findUnique({ where: { id: campaignId } });
  if (!campaignRow) throw new Error("campaign not found");
  const campaign = campaignRow;
  const strategies = await db.strategy.findMany({
    where: { id: { in: JSON.parse(campaign.strategyIds) as string[] } },
  });
  const symbolList = JSON.parse(campaign.symbols) as string[];
  const tfList = JSON.parse(campaign.tfs) as Timeframe[];

  const jobs: Array<{ strategyId: string; cfg: StrategyConfig; symbol: string; tf: Timeframe }> = [];
  for (const s of strategies) {
    const cfg = JSON.parse(s.config) as StrategyConfig;
    for (const symbol of symbolList) {
      if (!getInstrument(symbol)) continue;
      for (const tf of tfList) {
        jobs.push({ strategyId: s.id, cfg, symbol, tf });
      }
    }
  }

  let done = 0;
  let failed = 0;
  const CONCURRENCY = 2; // bounded to protect the dev-server memory budget
  // deep-history campaigns (3-year reruns) need the extended bar budget
  const maxBars = campaign.days >= 1000 ? EXTENDED_MAX_BARS : undefined;
  const verdictCounts: Record<string, number> = {};
  let best: Array<{ symbol: string; tf: string; strategyKey: string; score: number; pf: number }> = [];

  let idx = 0;
  async function worker() {
    while (idx < jobs.length) {
      const job = jobs[idx++];
      try {
        const payload = await executeRun(job.symbol, job.tf, job.cfg, {
          days: campaign.days,
          maxBars,
        });
        await persistRun(campaign.userId, job.strategyId, campaign.id, payload, campaign.days, "DONE");
        verdictCounts[payload.verdict] = (verdictCounts[payload.verdict] ?? 0) + 1;
        best.push({
          symbol: job.symbol,
          tf: job.tf,
          strategyKey: job.cfg.key,
          score: payload.robustness.score,
          pf: +payload.metrics.profitFactor.toFixed(2),
        });
      } catch (e) {
        failed++;
        await persistRunError(campaign.userId, job.strategyId, campaign.id, job.symbol, job.tf, campaign.days, String(e));
      }
      done++;
      if (done % 5 === 0 || done === jobs.length) {
        await db.campaign.update({ where: { id: campaign.id }, data: { done, failed } });
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));

  const summary = {
    verdictCounts,
    passed: verdictCounts.PASS ?? 0,
    watch: verdictCounts.WATCH ?? 0,
    failed: verdictCounts.FAIL ?? 0,
    insufficient: verdictCounts.INSUFFICIENT ?? 0,
    top: best.sort((a, b) => b.score - a.score).slice(0, 10),
  };
  await db.campaign.update({
    where: { id: campaign.id },
    data: { done, failed, status: "DONE", finishedAt: new Date(), summary: JSON.stringify(summary) },
  });
}

// ---------------------------------------------------------------------------
// Run persistence
// ---------------------------------------------------------------------------

export async function persistRun(
  userId: string,
  strategyId: string,
  campaignId: string | null,
  payload: RunPayload,
  daysRequested: number,
  status: "DONE" | "SKIPPED" = "DONE"
) {
  return db.run.create({
    data: {
      userId,
      strategyId,
      campaignId,
      symbol: payload.symbol,
      tf: payload.tf,
      status,
      daysRequested,
      fromTs: payload.fromTs ? new Date(payload.fromTs) : null,
      toTs: payload.toTs ? new Date(payload.toTs) : null,
      barsTested: payload.diagnosticsSummary.barsTested,
      metrics: JSON.stringify({
        ...payload.metrics,
        robustness: payload.robustness,
        verdict: payload.verdict,
        split: payload.split,
        engineVersion: payload.engineVersion,
      }),
      trades: JSON.stringify(payload.trades),
      equity: JSON.stringify(payload.equity),
      review: JSON.stringify(payload.review),
      dataQuality: JSON.stringify(payload.dataQuality),
    },
  });
}

export async function persistRunError(
  userId: string,
  strategyId: string,
  campaignId: string | null,
  symbol: string,
  tf: string,
  daysRequested: number,
  error: string
) {
  return db.run.create({
    data: {
      userId,
      strategyId,
      campaignId,
      symbol,
      tf,
      status: "ERROR",
      error: error.slice(0, 500),
      daysRequested,
    },
  });
}
