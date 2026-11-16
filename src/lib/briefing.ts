import type { AnalystContext } from "@/lib/analyst";

// ---------------------------------------------------------------------------
// Grok-style desk briefing — the LLM writes FROM the deterministic analyst
// context. It never invents numbers: every figure it cites is in the JSON.
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are AMI's market analyst — a direct, data-dense quant desk briefing writer in the style of a sharp macro research bot.

RULES:
- Use ONLY the data provided in the user message. Never invent prices, events, or numbers.
- Be specific and numeric. No filler, no generic disclaimers except one final line.
- Write in Markdown with these exact H2 sections, in order:
  ## Market pulse
  ## Today & tomorrow — event risk
  ## US focus — what's moving USD
  ## FX sessions & data days
  ## Confluence board
  ## Desk notes
- In "Confluence board", go market by market (at least the 8 most interesting) with bias, strength, vol regime, nearest event risk, and one line on what would invalidate the bias.
- In "Desk notes", give actionable cautions: leverage guidance around event windows, which markets lack confluence, weekend/rollover notes if relevant.
- End with exactly: "*Simulation research from live public exchange data. Not investment advice.*"
- Keep total length 350-650 words. Dense, confident, zero fluff.`;

export async function generateBriefing(ctx: AnalystContext): Promise<{ text: string; used: boolean; latencyMs: number; note?: string }> {
  const started = Date.now();
  const compact = {
    nowUtc: new Date(ctx.generatedAt).toISOString(),
    sessions: {
      forexOpen: ctx.sessions.forexOpen,
      futuresOpen: ctx.sessions.futuresOpen,
      forexNote: ctx.sessions.forexNote,
      futuresNote: ctx.sessions.futuresNote,
      open: ctx.sessions.sessions.filter((s) => s.open).map((s) => s.name),
      dataDays: ctx.sessions.dataDays.map((d) => ({ day: d.dayName, forex: d.forex, futures: d.futures })),
    },
    marketPulse: ctx.pulses.map((p) => ({
      sym: p.symbol,
      px: p.price,
      chg1d: p.changePct != null ? +p.changePct.toFixed(2) : null,
      rv14Ann: p.rv14,
      vol: p.volRegime,
      trend: p.trend.map((t) => `${t.tf}:${t.state[0]}`).join(" "),
      score: p.trendScore,
      atrPct1d: p.atrPct1d,
    })),
    vix: ctx.pulses.find((p) => p.symbol === "^VIX")?.price ?? null,
    calendarNext48h: [
      ...ctx.calendar.today,
      ...ctx.calendar.tomorrow,
    ]
      .filter((e) => e.impact !== "Low")
      .slice(0, 14)
      .map((e) => ({
        t: new Date(e.ts).toISOString().slice(5, 16).replace("T", " "),
        ccy: e.country,
        impact: e.impact,
        title: e.title,
        f: e.forecast || "-",
        p: e.previous || "-",
      })),
    usdWeekCount: ctx.calendar.usdThisWeek.length,
    usdHighWeek: ctx.calendar.usdThisWeek.filter((e) => e.impact === "High").slice(0, 8).map((e) => `${e.title} @ ${new Date(e.ts).toISOString().slice(5, 16).replace("T", " ")}`),
    confluences: ctx.confluences.map((c) => ({
      sym: c.symbol,
      bias: c.bias,
      strength: c.strength,
      vol: c.volRegime,
      eventRisk: c.eventRisk.level,
      nextEvent: c.eventRisk.events[0] ? `${c.eventRisk.events[0].title} (${c.eventRisk.events[0].country}) in ${c.eventRisk.events[0].inHours}h` : null,
    })),
    engineSignals: ctx.signals.map((s) => `${s.symbol} ${s.strategy} [${s.tf}]: ${s.bias ?? "flat"} (htf ${s.htfState})`),
  };

  try {
    const { default: ZAI } = await import("z-ai-web-dev-sdk");
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: `Write today's AMI desk briefing from this data (JSON):\n\n${JSON.stringify(compact)}`,
        },
      ],
      thinking: { type: "disabled" },
    });
    const text = completion.choices[0]?.message?.content?.trim();
    if (!text) throw new Error("empty completion");
    return { text, used: true, latencyMs: Date.now() - started };
  } catch (e) {
    return {
      text: fallbackBriefing(ctx),
      used: false,
      latencyMs: Date.now() - started,
      note: e instanceof Error ? e.message : String(e),
    };
  }
}

function fallbackBriefing(ctx: AnalystContext): string {
  const movers = [...ctx.pulses]
    .filter((p) => p.changePct != null)
    .sort((a, b) => Math.abs(b.changePct!) - Math.abs(a.changePct!))
    .slice(0, 4)
    .map((p) => `${p.symbol} ${p.changePct! > 0 ? "+" : ""}${p.changePct!.toFixed(2)}%`)
    .join(", ");
  const highs = ctx.calendar.nextHighImpact.slice(0, 4).map((e) => `${e.title} (${e.country})`);
  const strong = ctx.confluences.filter((c) => c.strength === "STRONG");
  const lines = [
    `## Market pulse`,
    `Biggest 1-day moves: ${movers || "n/a"}. ${ctx.sessions.forexOpen ? "FX is trading." : "FX is closed for the weekend."} ${ctx.sessions.futuresOpen ? "Globex is open." : "Globex is closed."}`,
    ``,
    `## Today & tomorrow — event risk`,
    highs.length ? `Next high-impact releases: ${highs.join("; ")}.` : `No high-impact releases in the feed window.`,
    ``,
    `## US focus — what's moving USD`,
    `${ctx.calendar.usdThisWeek.length} USD releases this week (${ctx.calendar.usdThisWeek.filter((e) => e.impact === "High").length} high-impact).`,
    ``,
    `## FX sessions & data days`,
    ctx.sessions.forexNote,
    ``,
    `## Confluence board`,
    ...ctx.confluences.slice(0, 10).map(
      (c) => `- **${c.symbol}** — ${c.bias.toUpperCase()} (${c.strength}), vol ${c.volRegime}, event risk ${c.eventRisk.level}. ${c.implication}`
    ),
    ``,
    `## Desk notes`,
    strong.length
      ? `Strongest confluences: ${strong.map((c) => c.symbol).join(", ")}. Size from the stop; the leverage cap never binds until it shortens the wick that ends you.`
      : `No strong multi-timeframe confluences right now — the honest position is smaller or none.`,
    ``,
    `*Simulation research from live public exchange data. Not investment advice.* (Deterministic fallback — the analyst model was unreachable.)`,
  ];
  return lines.join("\n");
}
