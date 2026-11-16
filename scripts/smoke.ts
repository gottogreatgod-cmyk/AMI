// Engine smoke check — runs each starter strategy once on BTC 1d and prints
// the shape of the result. Usage: bun scripts/smoke.ts
import { executeRun } from "@/lib/engine/runner";
import { STARTER_STRATEGIES } from "@/lib/engine/strategies";

async function main() {
  for (const cfg of STARTER_STRATEGIES.slice(0, 1)) {
    const res = await executeRun("BTCUSDT", "1d", cfg, { days: 220 });
    console.log("=== strategy:", cfg.key, "===");
    console.log({
      verdict: res.verdict,
      trades: res.metrics.trades,
      pf: +res.metrics.profitFactor.toFixed(2),
      tStat: +res.metrics.tStat.toFixed(2),
      dd: +res.metrics.maxDrawdownPct.toFixed(1),
      net: +res.metrics.netReturnPct.toFixed(1),
      liqs: res.metrics.liquidations,
      bars: res.dataQuality.bars,
      splitNote: res.split.note,
      reviewVerdict: res.review.verdict,
      firstFinding: res.review.findings[0]?.message,
      firstSuggestion: res.review.suggestions[0]?.title,
    });
  }
  // leverage cautionary case on 15m — expect liquidations
  const res = await executeRun("BTCUSDT", "15m", STARTER_STRATEGIES[1], { days: 100 });
  console.log("=== 300x cautionary (BTC 15m) ===");
  console.log({
    verdict: res.verdict,
    trades: res.metrics.trades,
    net: +res.metrics.netReturnPct.toFixed(1),
    liqs: res.metrics.liquidations,
    wickouts: res.metrics.leverageWickouts,
    reviewVerdict: res.review.verdict,
    findings: res.review.findings.map((f) => f.message),
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
