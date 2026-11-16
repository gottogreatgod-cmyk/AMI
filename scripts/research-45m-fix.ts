// Re-run only the failed 45m crypto slice after the Binance 45m fix.
import { db } from "@/lib/db";
import { startCampaign } from "@/lib/campaign";

const SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT",
  "AVAXUSDT", "LINKUSDT", "SUIUSDT", "PAXGUSDT",
];

async function main() {
  const del = await db.run.deleteMany({ where: { status: "ERROR" } });
  console.log("deleted errored runs:", del.count);
  const user = await db.user.findUnique({ where: { email: "demo@ami.local" } });
  if (!user) throw new Error("demo user missing");
  const strategies = await db.strategy.findMany({ where: { userId: user.id, isStarter: true } });
  const id = await startCampaign({
    userId: user.id,
    label: "Phase 1b — 45m re-run (Binance aggregation fix)",
    strategyKeys: strategies.map((s) => s.key),
    symbols: SYMBOLS,
    tfs: ["45m"],
    days: 100,
  });
  console.log("campaign", id);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
