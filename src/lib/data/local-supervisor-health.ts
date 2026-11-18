export type LocalSupervisorState =
  | "NOT_STARTED"
  | "STARTING"
  | "RUNNING"
  | "RESTART_WAIT"
  | "STALE"
  | "ERROR"
  | "STOPPING"
  | "STOPPED"
  | "INVALID";

export interface LocalSupervisorHealth {
  state: LocalSupervisorState;
  pid: number | null;
  heartbeatAt: number | null;
  heartbeatAgeMs: number | null;
  responsive: boolean;
  workers: unknown[];
  error: string | null;
}

const VALID_STATES = new Set([
  "RUNNING",
  "STOPPING",
  "STOPPED",
]);

/**
 * Classify a supervisor status snapshot independently from provider tick
 * freshness. A healthy supervisor does not imply that a market feed is fresh.
 */
export function classifyLocalSupervisorHealth(
  input: unknown,
  now = Date.now(),
  staleAfterMs = 15_000
): LocalSupervisorHealth {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      state: "INVALID",
      pid: null,
      heartbeatAt: null,
      heartbeatAgeMs: null,
      responsive: false,
      workers: [],
      error: "Supervisor status is not a JSON object.",
    };
  }

  const value = input as Record<string, unknown>;
  const pid = typeof value.pid === "number" && Number.isInteger(value.pid) && value.pid > 0
    ? value.pid
    : null;
  const heartbeatAt = typeof value.heartbeatAt === "number" &&
    Number.isFinite(value.heartbeatAt) && value.heartbeatAt > 0
    ? value.heartbeatAt
    : null;
  const validState = typeof value.state === "string" && VALID_STATES.has(value.state);
  const workers = Array.isArray(value.workers) ? value.workers : [];

  if (value.schemaVersion !== 1 || value.feedMode !== "EXPERIMENTAL_POLLING" ||
      value.ordersEnabled !== false || pid === null || heartbeatAt === null || !validState ||
      !Number.isFinite(now) || !Number.isFinite(staleAfterMs) || staleAfterMs <= 0) {
    return {
      state: "INVALID",
      pid,
      heartbeatAt,
      heartbeatAgeMs: null,
      responsive: false,
      workers,
      error: "Supervisor status schema or fields are invalid.",
    };
  }

  const heartbeatAgeMs = Math.max(0, now - heartbeatAt);
  if (value.state === "STOPPED") {
    return {
      state: "STOPPED",
      pid,
      heartbeatAt,
      heartbeatAgeMs,
      responsive: false,
      workers,
      error: null,
    };
  }

  if (value.state === "STOPPING") {
    return {
      state: "STOPPING",
      pid,
      heartbeatAt,
      heartbeatAgeMs,
      responsive: heartbeatAgeMs <= staleAfterMs,
      workers,
      error: null,
    };
  }

  if (heartbeatAgeMs > staleAfterMs) {
    return {
      state: "STALE",
      pid,
      heartbeatAt,
      heartbeatAgeMs,
      responsive: false,
      workers,
      error: "Supervisor heartbeat is older than the allowed threshold.",
    };
  }

  const workerStates = workers
    .map((worker) => worker && typeof worker === "object"
      ? (worker as Record<string, unknown>).state
      : null);
  const hasError = workerStates.includes("ERROR");
  const hasRestartWait = workerStates.includes("RESTART_WAIT");
  const hasRunning = workerStates.includes("RUNNING");

  return {
    state: hasError ? "ERROR" : hasRestartWait ? "RESTART_WAIT" : hasRunning ? "RUNNING" : "STARTING",
    pid,
    heartbeatAt,
    heartbeatAgeMs,
    responsive: true,
    workers,
    error: null,
  };
}
