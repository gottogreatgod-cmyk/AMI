/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test";
import {
  DEFAULT_RESTART_POLICY,
  getRestartDelayMs,
  isRestartAllowed,
} from "./local-supervisor";

describe("AMI local market-data supervisor restart policy", () => {
  test("uses bounded exponential restart delays", () => {
    expect(getRestartDelayMs(1)).toBe(5_000);
    expect(getRestartDelayMs(2)).toBe(10_000);
    expect(getRestartDelayMs(3)).toBe(20_000);
    expect(getRestartDelayMs(20)).toBe(DEFAULT_RESTART_POLICY.maxDelayMs);
  });

  test("allows a restart while fewer than the configured failures are in the window", () => {
    const now = 1_000_000;
    expect(isRestartAllowed([
      now - 60_000,
      now - 30_000,
      now - 10_000,
      now - 5_000,
    ], now)).toBe(true);
  });

  test("stops retrying after the restart budget is exhausted", () => {
    const now = 1_000_000;
    expect(isRestartAllowed([
      now - 60_000,
      now - 30_000,
      now - 10_000,
      now - 5_000,
      now - 1_000,
    ], now)).toBe(false);
  });

  test("drops failures outside the sliding restart window", () => {
    const now = 1_000_000;
    expect(isRestartAllowed([
      now - DEFAULT_RESTART_POLICY.windowMs - 1,
      now - DEFAULT_RESTART_POLICY.windowMs - 10_000,
      now - 1_000,
    ], now)).toBe(true);
  });

  test("does not count future or invalid timestamps against the retry budget", () => {
    const now = 1_000_000;
    expect(isRestartAllowed([
      Number.NaN,
      now + 1,
      now - 1_000,
    ], now)).toBe(true);
  });
});
