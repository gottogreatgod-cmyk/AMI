/// <reference types="bun-types" />

import { afterEach, describe, expect, test } from "bun:test";
import { db } from "@/lib/db";
import type { Bar } from "../../types";
import {
  getPersistentReplay,
  listPersistentReplays,
  persistHistoricalReplay,
} from "./replay-store";
import { runHistoricalReplay, type ReplayMachine } from "./replay-engine";

const users: string[] = [];

async function createTestUser(): Promise<string> {
  const suffix = crypto.randomUUID();
  const user = await db.user.create({
    data: {
      email: "replay-test-" + suffix + "@ami.invalid",
      passwordHash: "test-only",
      name: "Replay integration test",
    },
  });
  users.push(user.id);
  return user.id;
}

function buildResult() {
  const start = Date.parse("2026-11-18T09:00:00.000Z");
  const bars: Bar[] = [0, 1].map((index) => {
    const t = start + index * 60_000;
    return {
      t,
      ct: t + 59_999,
      o: 2600 + index,
      h: 2601 + index,
      l: 2599 + index,
      c: 2600.5 + index,
      v: 1,
    };
  });

  const machine: ReplayMachine<number> = {
    detectorId: "store-fixture",
    detectorVersion: "1",
    createInitialState: () => 0,
    onClosedBar: (state, context) => ({
      state: state + 1,
      events: [{
        setupKey: "same-setup",
        eventKey: context.barIndex === 0 ? "FORMING" : "ARMED",
        type: context.barIndex === 0 ? "FORMING" : "ARMED",
        reason: context.barIndex === 0 ? "Forming fixture." : "Armed fixture.",
        evidence: [{
          code: "fixture-close",
          value: context.bar.c,
          sourceBarTs: context.bar.t,
        }],
      }],
    }),
  };

  return runHistoricalReplay({
    instrumentId: "XAUUSD-DUKA",
    timeframe: "m1",
    source: {
      provider: "fixture",
      sourceId: "xauusd-bid-fixture",
      dataClass: "OTC_SPOT_METAL",
      revisionId: "fixture-revision-1",
      revisionHash: "sha256:fixture-revision-1",
    },
    interval: { fromTs: bars[0].t, toTs: bars[1].t },
    warmupBars: 0,
    paramsHash: "fixture-params",
    engineVersion: "ami-replay-test",
    bars,
    machine,
  });
}

afterEach(async () => {
  const ids = users.splice(0);
  if (ids.length > 0) await db.user.deleteMany({ where: { id: { in: ids } } });
});

describe("persistent historical replay store", () => {
  test("stores exact source revision and ordered append-only events; retries are idempotent", async () => {
    const userId = await createTestUser();
    const result = buildResult();

    const first = await persistHistoricalReplay(userId, result);
    const retry = await persistHistoricalReplay(userId, result);

    expect(first.created).toBe(true);
    expect(first.conflict).toBe(false);
    expect(first.replay.events.map((event) => event.eventKey)).toEqual(["FORMING", "ARMED"]);
    expect(retry.created).toBe(false);
    expect(retry.conflict).toBe(false);
    expect(retry.replay.id).toBe(first.replay.id);

    const runs = await db.replayRun.findMany({ where: { userId } });
    const events = await db.replayEvent.findMany({
      where: { replayRunId: first.replay.id },
      orderBy: { sequence: "asc" },
    });
    expect(runs).toHaveLength(1);
    expect(events).toHaveLength(2);
    expect(events.map((event) => event.sequence)).toEqual([0, 1]);
  });

  test("same deterministic run key with changed output is a conflict, not an overwrite", async () => {
    const userId = await createTestUser();
    const result = buildResult();
    const first = await persistHistoricalReplay(userId, result);
    const changed = {
      ...result,
      events: result.events.map((event, index) => index === 0
        ? { ...event, reason: "Changed replay output must never overwrite history." }
        : event),
    };

    const retry = await persistHistoricalReplay(userId, changed);
    expect(first.created).toBe(true);
    expect(retry.created).toBe(false);
    expect(retry.conflict).toBe(true);
    expect(retry.replay.events[0].reason).toBe("Forming fixture.");
  });

  test("replay reads are scoped to the signed-in user", async () => {
    const ownerId = await createTestUser();
    const otherUserId = await createTestUser();
    const result = buildResult();
    const stored = await persistHistoricalReplay(ownerId, result);

    expect(await getPersistentReplay(otherUserId, stored.replay.id)).toBeNull();
    expect(await listPersistentReplays(otherUserId)).toHaveLength(0);
    expect(await listPersistentReplays(ownerId)).toHaveLength(1);
    expect(await getPersistentReplay(ownerId, result.runId)).not.toBeNull();
  });
});
