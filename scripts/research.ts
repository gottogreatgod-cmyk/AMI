// ---------------------------------------------------------------------------
// AMI research campaign runner — Phase 1 (100-day monitor sweep) and
// Phase 2 (3-year deep rerun of qualifying strategies).
//
//   bun scripts/research.ts phase1
//   bun scripts/research.ts phase2
//   bun scripts/research.ts phase2 <strategyKey,..>   (explicit selection)
//
// Runs the SAME engine + providers as the app (no test harness, no mocks),
// persists every run to SQLite scoped to the demo analyst account, and dumps
// aggregates to docs/research-data-<phase>.json for the written report.
// ---------------------------------------------------------------------------

import { db } from "@/lib/db";
import { randomBytes, scryptSync } from "crypto";
import { startCampaign } from "@/lib/campaign";
import { STARTER_STRATEGIES } from "@/lib/engine/strategies";
import { writeFileSync, readFileSync, existsSync } from "fs";

const DEMO_EMAIL = "demo@ami.local";
const ALL_SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT",
  "AVAXUSDT", "LINKUSDT", "SUIUSDT", "PAXGUSDT",
  "NQ=F", "GC=F", "^VIX", "EURUSD=X", "USDJPY=X",
];
const ALL_TFS = ["15m", "45m", "1h", "3h", "4h", "1d", "1w"] as const;

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

async function ensureDemo() {
  let user = await db.user.findUnique({ where: { email: DEMO_EMAIL } });
  if (!user) {
    user = await db.user.create({
      data: {
        email: DEMO_EMAIL,
        name: "Demo Analyst",
        passwordHash: hashPassword("ami-demo-2026"),
        isDemo: true,
      },
    });
    console.log("created demo user", user.id);
  }
  // seed starters
  const existing = await db.strategy.findMany({ where: { userId: user.id } });
  const existingKeys = new Set(existing.map((s) => s.key));
  const missing = STARTER_STRATEGIES.filter((s) => !existingKeys.has(s.key));
  if (missing.length > 0) {
    await db.strategy.createMany({
      data: missing.map((s) => ({
        userId: user!.id,
        key: s.key,
        name: s.name,
        description: s.description,
        family: s.family,
        config: JSON.stringify(s),
        isStarter: true,
      })),
    });
    console.log(`seeded ${missing.length} starter strategies`);
  }
  return user;
}

async function waitForCampaign(campaignId: string, label: string) {
  const t0 = Date.now();
  for (;;) {
    const c = await db.campaign.findUnique({ where: { id: campaignId } });
    if (!c) throw new Error("campaign vanished");
    const elapsed = Math.round((Date.now() - t0) / 1000);
    process.stdout.write(`\r[${label}] ${c.done}/${c.total} done, ${c.failed} failed, ${elapsed}s   `);
    if (c.status === "DONE" || c.status === "ERROR") {
      console.log("");
      if (c.status === "ERROR") throw new Error(`campaign error: ${c.summary}`);
      return c;
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
}

interface MetricsBlob {
  trades: number;
  profitFactor: number;
  tStat: number;
  netReturnPct: number;
  maxDrawdownPct: number;
  expectancyR: number;
  winRate: number;
  costDragPct: number;
  liquidations: number;
  exposurePct: number;
  cagrPct: number | null;
  verdict: string;
  robustness: { score: number; grade: string };
  split: { consistent: boolean; decayed: boolean; note: string; first: { pf: number; trades: number }; second: { pf: number; trades: number } };
}

async function campaignReport(campaignId: string) {
  const runs = await db.run.findMany({
    where: { campaignId },
    include: { strategy: { select: { key: true, name: true } } },
  });
  const rows = runs.map((r) => {
    const m = r.metrics ? (JSON.parse(r.metrics) as MetricsBlob) : null;
    return {
      strategy: r.strategy.key,
      strategyName: r.strategy.name,
      symbol: r.symbol,
      tf: r.tf,
      status: r.status,
      error: r.error ?? null,
      days: r.daysRequested,
      bars: r.barsTested,
      trades: m?.trades ?? 0,
      pf: m?.profitFactor ?? 0,
      tStat: m?.tStat ?? 0,
      netPct: m?.netReturnPct ?? 0,
      ddPct: m?.maxDrawdownPct ?? 0,
      expR: m?.expectancyR ?? 0,
      winRate: m?.winRate ?? 0,
      costDrag: m?.costDragPct ?? 0,
      exposure: m?.exposurePct ?? 0,
      cagr: m?.cagrPct ?? null,
      liquidations: m?.liquidations ?? 0,
      score: m?.robustness.score ?? 0,
      grade: m?.robustness.grade ?? "D",
      verdict: m?.verdict ?? r.status,
      consistent: m?.split.consistent ?? false,
      decayed: m?.split.decayed ?? false,
      splitNote: m?.split.note ?? "",
    };
  });
  return rows;
}

function printTop(rows: Awaited<ReturnType<typeof campaignReport>>, n = 15) {
  const done = rows.filter((r) => r.status === "DONE" && r.trades > 0);
  const top = [...done].sort((a, b) => b.score - a.score).slice(0, n);
  console.log("\nTOP " + n + " by robustness:");
  for (const r of top) {
    console.log(
      `  ${String(r.score).padStart(3)} [${r.grade}] ${r.verdict.padEnd(11)} ${r.strategy.padEnd(24)} ${r.symbol.padEnd(10)} ${r.tf.padEnd(3)} n=${String(r.trades).padStart(4)} PF=${r.pf.toFixed(2).padStart(5)} t=${r.tStat.toFixed(1).padStart(4)} net=${r.netPct.toFixed(1).padStart(6)}% dd=${r.ddPct.toFixed(1).padStart(5)}% liq=${r.liquidations}`
    );
  }
}

function writeJson(path: string, data: unknown) {
  writeFileSync(path, JSON.stringify(data, null, 1));
  console.log(`wrote ${path}`);
}

async function phase1() {
  const user = await ensureDemo();
  const strategies = await db.strategy.findMany({ where: { userId: user.id, isStarter: true } });
  const keys = strategies.map((s) => s.key);
  console.log(`\n=== PHASE 1: 100-day monitor sweep — ${keys.length} strategies x ${ALL_SYMBOLS.length} markets x ${ALL_TFS.length} timeframes = ${keys.length * ALL_SYMBOLS.length * ALL_TFS.length} runs ===`);
  const id = await startCampaign({
    userId: user.id,
    label: "Phase 1 — 100-day monitor sweep (all strategies, all markets, all TFs)",
    strategyKeys: keys,
    symbols: [...ALL_SYMBOLS],
    tfs: [...ALL_TFS],
    days: 100,
  });
  await waitForCampaign(id, "phase1");
  const rows = await campaignReport(id);
  printTop(rows, 20);

  const verdicts: Record<string, number> = {};
  for (const r of rows) verdicts[r.verdict] = (verdicts[r.verdict] ?? 0) + 1;
  console.log("\nverdict counts:", verdicts);

  // winners: strategies with at least one stable profitable run
  const winners = new Set<string>();
  for (const r of rows) {
    if (r.status === "DONE" && r.verdict === "PASS") winners.add(r.strategy);
    if (r.status === "DONE" && r.verdict === "WATCH" && r.pf >= 1.25 && r.consistent && r.trades >= 8) winners.add(r.strategy);
  }
  // always include the known survivor for the 3y verification
  winners.add("donchian-1d-trail-3x");
  console.log("\nqualifying strategies for phase 2:", [...winners]);
  writeJson("/home/z/my-project/docs/research-data-phase1.json", { campaignId: id, rows, winners: [...winners] });
}

async function phase2(explicit?: string[]) {
  const user = await ensureDemo();
  let keys = explicit;
  if ((!keys || keys.length === 0) && existsSync("/home/z/my-project/docs/research-data-phase1.json")) {
    try {
      const data = JSON.parse(
        readFileSync("/home/z/my-project/docs/research-data-phase1.json", "utf8") as string
      ) as { winners: string[] };
      keys = data.winners;
    } catch {
      keys = undefined;
    }
  }
  if (!keys || keys.length === 0) keys = ["donchian-1d-trail-3x"];
  console.log(`\n=== PHASE 2: 3-year deep rerun — ${keys.length} strategies x ${ALL_SYMBOLS.length} markets x ${ALL_TFS.length} timeframes = ${keys.length * ALL_SYMBOLS.length * ALL_TFS.length} runs ===`);
  console.log("strategies:", keys);
  const id = await startCampaign({
    userId: user.id,
    label: `Phase 2 — 3-year deep rerun (${keys.length} qualifying strategies)`,
    strategyKeys: keys,
    symbols: [...ALL_SYMBOLS],
    tfs: [...ALL_TFS],
    days: 1095,
  });
  await waitForCampaign(id, "phase2");
  const rows = await campaignReport(id);
  printTop(rows, 25);
  writeJson("/home/z/my-project/docs/research-data-phase2.json", { campaignId: id, rows });
}

const arg = process.argv[2] ?? "phase1";
if (arg === "phase1") {
  phase1().catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else if (arg === "phase2") {
  const explicit = process.argv[3]?.split(",").map((s) => s.trim()).filter(Boolean);
  phase2(explicit).catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else {
  console.log("usage: bun scripts/research.ts phase1|phase2 [keys]");
}
