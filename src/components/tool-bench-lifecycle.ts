import type { AbstractAgent } from "@ag-ui/client";
import type { BenchState } from "../lib/tool-bench/types";
import { runWithAgentLifecycle } from "./agent-run-lifecycle";

const activeStatuses = new Set(["ready", "running"]);

export function isBenchState(value: unknown): value is BenchState {
  return (
    typeof value === "object" &&
    value !== null &&
    "lanes" in value &&
    Array.isArray(value.lanes) &&
    "runId" in value &&
    typeof value.runId === "string" &&
    "datasetVersion" in value &&
    typeof value.datasetVersion === "string"
  );
}

export function isTerminalBench(state: BenchState) {
  return (
    (state.status === "complete" || state.status === "cancelled") &&
    state.lanes.every((lane) => !activeStatuses.has(lane.status))
  );
}

export function interruptBench(state: BenchState, error?: string): BenchState {
  return {
    ...state,
    status: "cancelled",
    lanes: state.lanes.map((lane) =>
      activeStatuses.has(lane.status)
        ? {
            ...lane,
            status: error ? "error" : "cancelled",
            error: error ?? null,
          }
        : lane,
    ),
  };
}

/** A final same-run server snapshot owns completed results and measured totals. */
export function selectBenchState(
  agentState: unknown,
  fallback: BenchState | null,
  initial: BenchState,
): BenchState {
  const streamed =
    isBenchState(agentState) && agentState.runId ? agentState : null;
  if (!fallback) return streamed ?? initial;
  return streamed?.runId === fallback.runId && isTerminalBench(streamed)
    ? streamed
    : fallback;
}

export async function runWithBenchLifecycle({
  agent,
  initialState,
  run,
  isCancelled,
  onError,
  onFallback,
}: {
  agent: AbstractAgent;
  initialState: BenchState;
  run: () => Promise<unknown>;
  isCancelled: () => boolean;
  onError: (message: string) => void;
  onFallback: (state: BenchState) => void;
}): Promise<void> {
  const currentState = () =>
    isBenchState(agent.state) && agent.state.runId === initialState.runId
      ? agent.state
      : initialState;
  return runWithAgentLifecycle({
    agent,
    runId: initialState.runId,
    currentState,
    isTerminal: isTerminalBench,
    interrupt: interruptBench,
    run,
    isCancelled,
    onError,
    onFallback,
    failureMessage: "The benchmark connection failed.",
    incompleteMessage:
      "The connection ended before a final result arrived. Run again to retry.",
  });
}
