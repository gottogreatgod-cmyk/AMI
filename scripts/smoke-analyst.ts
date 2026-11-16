// Analyst smoke check: deterministic context + LLM briefing.
import { buildAnalystContext } from "@/lib/analyst";
import { generateBriefing } from "@/lib/briefing";
import { STARTER_STRATEGIES } from "@/lib/engine/strategies";

async function main() {
  const t0 = Date.now();
  const ctx = await buildAnalystContext(
    STARTER_STRATEGIES.slice(0, 3).map((cfg) => ({ cfg, symbols: ["BTCUSDT", "NQ=F", "EURUSD=X"] })),
    120 // Europe/Kiev
  );
  console.log("context built in", Date.now() - t0, "ms");
  console.log("pulses:", ctx.pulses.length, "| confluences:", ctx.confluences.length);
  console.log("sessions forexOpen:", ctx.sessions.forexOpen, "| futuresOpen:", ctx.sessions.futuresOpen);
  console.log("sample pulse BTC:", JSON.stringify(ctx.pulses.find((p) => p.symbol === "BTCUSDT"), null, 0).slice(0, 400));
  console.log("sample confluence NQ:", JSON.stringify(ctx.confluences.find((c) => c.symbol === "NQ=F"), null, 0).slice(0, 500));
  console.log("calendar today:", ctx.calendar.today.length, "| usdWeek:", ctx.calendar.usdThisWeek.length);
  console.log("signals:", ctx.signals.slice(0, 3));
  const b = await generateBriefing(ctx);
  console.log("briefing used:", b.used, "latency:", b.latencyMs, "note:", b.note ?? "-");
  console.log("--- BRIEFING (first 1200 chars) ---");
  console.log(b.text.slice(0, 1200));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
