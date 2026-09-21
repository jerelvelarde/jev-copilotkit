import type { AbstractAgent } from "@ag-ui/client";
import type { LaneDefinition } from "../lib/race/types";
import {
  arenaConfigSchema,
  initialLaneState,
  missingKeyMessage,
  type ArenaConfig,
  type ArenaLaneState,
} from "../lib/tool-bench/types";
import { runWithAgentLifecycle } from "./agent-run-lifecycle";

export type ArenaLaneDefinition = LaneDefinition & { agentId: string };
export type ArenaLane = ArenaLaneState & { agentId: string };
export type ArenaRun = {
  runId: string;
  config: ArenaConfig;
  lanes: ArenaLane[];
};
/** `prompt` is local presentation only; the agents receive `config` and `runId`. */
export type ArenaRunProps = {
  config: ArenaConfig;
  runId: string;
  prompt?: string;
};
export type ArenaController = {
  definition: ArenaLaneDefinition;
  run: (props: ArenaRunProps) => Promise<void>;
  stop: () => void;
  isRunning: () => boolean;
};

const activeStatuses = new Set<ArenaLaneState["status"]>(["idle", "running"]);

/** One CopilotKit agent is registered per lane under this stable id. */
export const laneAgentId = (lane: LaneDefinition) => `tool_bench_${lane.id}`;

export function withAgentIds(
  definitions: LaneDefinition[],
): ArenaLaneDefinition[] {
  return definitions.map((lane) => ({ ...lane, agentId: laneAgentId(lane) }));
}

export function isArenaLaneState(value: unknown): value is ArenaLaneState {
  return (
    typeof value === "object" &&
    value !== null &&
    "runId" in value &&
    typeof value.runId === "string" &&
    "timings" in value &&
    typeof value.timings === "object" &&
    "events" in value &&
    Array.isArray(value.events)
  );
}

export function isTerminalLane(state: ArenaLaneState) {
  return !activeStatuses.has(state.status);
}

export function isArenaComplete(states: ArenaLaneState[]) {
  return states.length > 0 && states.every(isTerminalLane);
}

export function interruptLane<State extends ArenaLaneState>(
  state: State,
  error?: string,
): State {
  return activeStatuses.has(state.status)
    ? {
        ...state,
        status: error ? "error" : "cancelled",
        error: error ?? state.error,
      }
    : state;
}

/** A final same-run server snapshot owns the measured decision and tool times. */
export function selectLaneState<State extends ArenaLaneState>(
  agentState: unknown,
  fallback: State | null,
  initial: State,
): State {
  const streamed =
    isArenaLaneState(agentState) && agentState.runId
      ? (agentState as State)
      : null;
  if (!fallback) return streamed ?? initial;
  return streamed?.runId === fallback.runId && isTerminalLane(streamed)
    ? streamed
    : fallback;
}

export type RenderOverlay = { runId: string; renderMs: number };

/**
 * UI commit time is measured in the browser, so it is merged into the server's
 * lane state instead of living in it. A later AG-UI snapshot for the same run
 * therefore cannot erase the client measurement, and it is only ever added once.
 */
export function withRenderCommit<State extends ArenaLaneState>(
  state: State,
  overlay: RenderOverlay | null,
): State {
  if (
    !overlay ||
    overlay.runId !== state.runId ||
    state.status !== "complete" ||
    state.events.some((event) => event.phase === "render")
  )
    return state;
  return {
    ...state,
    timings: {
      ...state.timings,
      renderMs: overlay.renderMs,
      totalMs: state.timings.totalMs + overlay.renderMs,
    },
    events: [
      ...state.events,
      {
        phase: "render",
        status: "finished",
        atMs: state.timings.totalMs,
        durationMs: overlay.renderMs,
        message: null,
      },
    ],
  };
}

/** One immutable specification shared by every agent in the race. */
export function createArenaRun(
  mode: ArenaConfig["mode"],
  caseId: string,
  definitions: ArenaLaneDefinition[],
  options: { prompt?: string; runId?: string } = {},
): ArenaRun {
  const config = arenaConfigSchema.parse({ mode, caseId });
  const runId = options.runId ?? crypto.randomUUID();
  return {
    runId,
    config,
    lanes: definitions.map((definition) => {
      const joins = config.mode === "sample" || definition.available;
      return {
        ...initialLaneState(definition),
        agentId: definition.agentId,
        runId,
        caseId: config.caseId,
        prompt: options.prompt ?? "",
        status: joins ? "running" : "unavailable",
        error: joins ? null : missingKeyMessage(definition),
      };
    }),
  };
}

/**
 * Launches every participating lane at once. A rejected lane is reported in its
 * own result and never cancels the agents racing beside it.
 */
export function launchArena(
  controllers: ArenaController[],
  props: ArenaRunProps,
): Promise<PromiseSettledResult<void>[]> {
  return Promise.allSettled(
    controllers
      .filter(
        ({ definition }) =>
          props.config.mode === "sample" || definition.available,
      )
      .map((controller) => controller.run(props)),
  );
}

export function stopArena(controllers: ArenaController[]): void {
  for (const controller of controllers)
    if (controller.isRunning()) controller.stop();
}

export async function runWithLaneLifecycle<State extends ArenaLaneState>({
  agent,
  initialState,
  run,
  isCancelled,
  onError,
  onFallback,
}: {
  agent: AbstractAgent;
  initialState: State;
  run: () => Promise<unknown>;
  isCancelled: () => boolean;
  onError: (message: string) => void;
  onFallback: (state: State) => void;
}): Promise<void> {
  const currentState = () =>
    isArenaLaneState(agent.state) && agent.state.runId === initialState.runId
      ? (agent.state as State)
      : initialState;
  return runWithAgentLifecycle({
    agent,
    runId: initialState.runId,
    currentState,
    isTerminal: isTerminalLane,
    interrupt: interruptLane,
    run,
    isCancelled,
    onError,
    onFallback,
    failureMessage: "This lane's connection failed.",
    incompleteMessage:
      "The connection ended before a final result arrived. Run again to retry.",
  });
}
