/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import { classifyLocalSupervisorHealth } from "./local-supervisor-health";

const base = {
  schemaVersion: 1,
  state: "RUNNING",
  pid: 1234,
  startedAt: 1_000,
  heartbeatAt: 100_000,
  feedMode: "EXPERIMENTAL_POLLING",
  ordersEnabled: false,
  workers: [{ state: "RUNNING" }, { state: "RUNNING" }],
};

describe("local supervisor heartbeat health", () => {
  test("classifies a recent supervisor heartbeat as running", () => {
    const health = classifyLocalSupervisorHealth(base, 102_000);
    expect(health.state).toBe("RUNNING");
    expect(health.responsive).toBe(true);
    expect(health.workers).toHaveLength(2);
  });

  test("marks a dead or wedged supervisor stale by heartbeat age", () => {
    const health = classifyLocalSupervisorHealth(base, 120_001);
    expect(health.state).toBe("STALE");
    expect(health.responsive).toBe(false);
  });

  test("surfaces worker restart and fatal states without calling the process healthy", () => {
    expect(classifyLocalSupervisorHealth({
      ...base,
      workers: [{ state: "RUNNING" }, { state: "RESTART_WAIT" }],
    }, 102_000).state).toBe("RESTART_WAIT");

    expect(classifyLocalSupervisorHealth({
      ...base,
      workers: [{ state: "RUNNING" }, { state: "ERROR" }],
    }, 102_000).state).toBe("ERROR");
  });

  test("preserves a deliberate shutdown state", () => {
    const health = classifyLocalSupervisorHealth({
      ...base,
      state: "STOPPED",
      workers: [{ state: "STOPPED" }, { state: "STOPPED" }],
    }, 1_000_000);
    expect(health.state).toBe("STOPPED");
    expect(health.responsive).toBe(false);
  });

  test("rejects malformed or unsafe status payloads", () => {
    expect(classifyLocalSupervisorHealth(null).state).toBe("NOT_STARTED");
    expect(classifyLocalSupervisorHealth({
      ...base,
      ordersEnabled: true,
    }).state).toBe("INVALID");
  });
});
