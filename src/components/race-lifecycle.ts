import type { AbstractAgent } from "@ag-ui/client";
import type { RaceState } from "../lib/race/types";

const activeLaneStatuses = new Set(["ready", "loading", "thinking"]);

export function isRaceState(value: unknown): value is RaceState {
  return (
    typeof value === "object" &&
    value !== null &&
    "lanes" in value &&
    Array.isArray(value.lanes) &&
    "runId" in value &&
    typeof value.runId === "string"
  );
}

export function isTerminalRace(state: RaceState) {
  return (
    (state.status === "complete" || state.status === "cancelled") &&
    state.lanes.every((lane) => !activeLaneStatuses.has(lane.status))
  );
}

/** Preserve finished lanes while making the remaining lanes safe to reset/retry. */
export function interruptRace(state: RaceState, error?: string): RaceState {
  return {
    ...state,
    status: "cancelled",
    lanes: state.lanes.map((lane) =>
      activeLaneStatuses.has(lane.status)
        ? {
            ...lane,
            status: error ? "error" : "cancelled",
            error: error ?? null,
          }
        : lane,
    ),
  };
}

/** A local stop is immediate; a final same-run snapshot owns the measured totals. */
export function selectRaceState(
  agentState: unknown,
  localFallback: RaceState | null,
  initialState: RaceState,
): RaceState {
  const streamed =
    isRaceState(agentState) && agentState.runId ? agentState : null;
  if (!localFallback) return streamed ?? initialState;
  if (streamed?.runId === localFallback.runId && isTerminalRace(streamed))
    return streamed;
  return localFallback;
}

type RunLifecycleOptions = {
  agent: AbstractAgent;
  initialState: RaceState;
  run: () => Promise<unknown>;
  isCancelled: () => boolean;
  onError: (message: string) => void;
  onFallback: (state: RaceState) => void;
};

/** CopilotKit can resolve after RUN_ERROR or a transport failure; resolution alone is not success. */
export async function runWithRaceLifecycle({
  agent,
  initialState,
  run,
  isCancelled,
  onError,
  onFallback,
}: RunLifecycleOptions): Promise<void> {
  let failure: string | null = null;
  const currentState = () =>
    isRaceState(agent.state) && agent.state.runId === initialState.runId
      ? agent.state
      : initialState;
  const fail = (message: string) => {
    if (isCancelled()) return;
    failure ??= message;
    onError(failure);
    onFallback(interruptRace(currentState(), failure));
  };
  const subscription = agent.subscribe({
    onRunErrorEvent: ({ event, input }) => {
      if (input.runId === initialState.runId) fail(event.message);
    },
    onRunFailed: ({ error, input }) => {
      if (input.runId === initialState.runId) fail(error.message);
    },
  });

  try {
    await run();
  } catch (cause) {
    fail(
      cause instanceof Error
        ? cause.message
        : "The race could not finish. Please try again.",
    );
  } finally {
    subscription.unsubscribe();
    const current = currentState();
    if (!isTerminalRace(current)) {
      if (isCancelled()) onFallback(interruptRace(current));
      else
        fail(
          failure ??
            "The race connection ended before a final result arrived. Please try again.",
        );
    }
  }
}
