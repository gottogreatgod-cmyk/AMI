#!/usr/bin/env bun

import { getRealTimeRates } from "dukascopy-node";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

const instrumentId = process.env.AMI_MONITOR_INSTRUMENT_ID;
const providerInstrument = process.env.AMI_MONITOR_PROVIDER_INSTRUMENT;
const timeframe = process.env.AMI_MONITOR_TIMEFRAME;
const pollSeconds = Number(process.env.AMI_MONITOR_POLL_SECONDS ?? "60");
const outputPath = process.env.AMI_MONITOR_OUTPUT;
const helperPath = process.env.AMI_MONITOR_HELPER;

if (!instrumentId || !providerInstrument || !timeframe || !outputPath || !helperPath) {
  throw new Error("Missing AMI monitor runtime configuration.");
}
if (!Number.isInteger(pollSeconds) || pollSeconds < 30) {
  throw new Error("AMI monitor polling interval must be at least 30 seconds.");
}

const helpers = await import(pathToFileURL(helperPath).href);
const timeframeMs = helpers.MONITOR_TIMEFRAME_MS[timeframe];
if (!timeframeMs) throw new Error("Unsupported AMI monitor timeframe: " + timeframe);

const source = {
  provider: "Dukascopy",
  providerInstrument,
  instrumentId,
  dataClass: instrumentId === "NAS100-DUKA" ? "BROKER_CFD" : "OTC_SPOT_METAL",
  feedMode: "EXPERIMENTAL_POLLING",
  timeframe,
  quoteSides: ["bid", "ask"],
  ordersEnabled: false,
};

let stopping = false;
let lastGoodSnapshot = null;
let pollCount = 0;
let wakeSleep = null;

async function atomicWrite(value) {
  await mkdir(dirname(outputPath), { recursive: true });
  const tempPath = outputPath + ".tmp";
  await writeFile(tempPath, JSON.stringify(value, null, 2) + "\n", "utf8");
  await rename(tempPath, outputPath);
}

async function getPreviousSnapshot() {
  try {
    const parsed = JSON.parse(await readFile(outputPath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed.snapshot ?? null : null;
  } catch {
    return null;
  }
}

async function fetchJson(options) {
  return getRealTimeRates({
    instrument: providerInstrument,
    format: "json",
    requestIntervalMs: 300,
    rateLimitRetryCount: 3,
    ...options,
  });
}

async function pollOnce() {
  const attemptStartedAt = Date.now();
  const ticksRaw = await fetchJson({ timeframe: "tick", last: 1 });
  const bidRaw = await fetchJson({ timeframe, priceType: "bid", volumes: true, last: 8 });
  const askRaw = await fetchJson({ timeframe, priceType: "ask", volumes: true, last: 8 });

  const fetchedAt = Date.now();
  const tick = helpers.normalizeMonitorTick(ticksRaw, fetchedAt);
  const bid = helpers.normalizeMonitorCandles(bidRaw, timeframeMs, fetchedAt);
  const ask = helpers.normalizeMonitorCandles(askRaw, timeframeMs, fetchedAt);
  const freshness = helpers.classifyMonitorFreshness(
    tick,
    fetchedAt,
    Math.max(2 * timeframeMs, 120_000)
  );

  return {
    schemaVersion: 1,
    source,
    fetchedAt,
    requestStartedAt: attemptStartedAt,
    requestDurationMs: fetchedAt - attemptStartedAt,
    tick,
    spread: tick
      ? { absolute: tick.spread, basisPoints: tick.spreadBps, currency: "USD" }
      : null,
    bid: {
      bars: bid.bars,
      closedBars: bid.closedBars,
      formingBar: bid.formingBar,
      latestTimestamp: bid.bars[bid.bars.length - 1]?.t ?? null,
    },
    ask: {
      bars: ask.bars,
      closedBars: ask.closedBars,
      formingBar: ask.formingBar,
      latestTimestamp: ask.bars[ask.bars.length - 1]?.t ?? null,
    },
    freshness,
    marketSession: "UNKNOWN_NOT_CALENDAR_VERIFIED",
    notes: [
      "Experimental polling via dukascopy-node getRealTimeRates; not a persistent WebSocket or exchange-grade feed.",
      "Bid and ask candles are separate. No midpoint OHLC is fabricated from separate side highs/lows.",
      "No trading, order routing, signal execution or position sizing is performed by this monitor.",
      "NO_TICK can mean a quiet/closed market or unavailable provider data; calendar status is not inferred.",
    ],
  };
}

async function run() {
  lastGoodSnapshot = await getPreviousSnapshot();

  while (!stopping) {
    const attemptedAt = Date.now();
    pollCount++;

    try {
      lastGoodSnapshot = await pollOnce();
      await atomicWrite({
        schemaVersion: 1,
        instrumentId,
        poller: {
          state: lastGoodSnapshot.freshness.state,
          pollCount,
          attemptedAt,
          lastSuccessAt: lastGoodSnapshot.fetchedAt,
          lastError: null,
          intervalSeconds: pollSeconds,
          feedMode: "EXPERIMENTAL_POLLING",
        },
        snapshot: lastGoodSnapshot,
      });
      process.stdout.write(JSON.stringify({
        instrumentId,
        state: lastGoodSnapshot.freshness.state,
        bid: lastGoodSnapshot.tick?.bid ?? null,
        ask: lastGoodSnapshot.tick?.ask ?? null,
        spreadBps: lastGoodSnapshot.tick?.spreadBps ?? null,
        bidBars: lastGoodSnapshot.bid.bars.length,
        askBars: lastGoodSnapshot.ask.bars.length,
        fetchedAt: lastGoodSnapshot.fetchedAt,
      }) + "\n");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await atomicWrite({
        schemaVersion: 1,
        instrumentId,
        poller: {
          state: lastGoodSnapshot ? "STALE" : "ERROR",
          pollCount,
          attemptedAt,
          lastSuccessAt: lastGoodSnapshot?.fetchedAt ?? null,
          lastError: message,
          intervalSeconds: pollSeconds,
          feedMode: "EXPERIMENTAL_POLLING",
        },
        snapshot: lastGoodSnapshot,
      });
      process.stderr.write(JSON.stringify({
        instrumentId,
        state: lastGoodSnapshot ? "STALE" : "ERROR",
        error: message,
        lastGoodAt: lastGoodSnapshot?.fetchedAt ?? null,
      }) + "\n");
    }

    if (process.env.AMI_MONITOR_ONCE === "1") break;
    if (!stopping) {
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          wakeSleep = null;
          resolve();
        }, pollSeconds * 1000);
        wakeSleep = () => {
          clearTimeout(timer);
          wakeSleep = null;
          resolve();
        };
      });
    }
  }
}

const stop = () => {
  stopping = true;
  wakeSleep?.();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

await run();
