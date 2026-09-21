import { abortable } from "../cancellation";
import type { LaneDefinition } from "../race/types";
import { BENCH_CASES, toCaseInput } from "./cases";
import { executeToolCall } from "./executor";
import { BenchOutputError } from "./providers";
import { scoreCall } from "./scoring";
import {
  initialLaneState,
  missingKeyMessage,
  type ArenaConfig,
  type ArenaEvent,
  type ArenaLaneState,
  type BenchProvider,
} from "./types";

export type LaneDependencies = {
  provider: BenchProvider;
  execute: typeof executeToolCall;
  now?: () => number;
  timeoutMs?: number;
};

/**
 * Runs one provider decision and one local tool execution for a single case,
 * publishing a cloned snapshot at every phase boundary. The lane always reaches
 * a terminal state; it never throws for a provider, tool, or stop outcome, so a
 * failing lane cannot end the other agents in the race.
 */
export async function runArenaLane(
  lane: LaneDefinition,
  config: ArenaConfig,
  runId: string,
  dependencies: LaneDependencies,
  parentSignal: AbortSignal,
  publish: (state: ArenaLaneState) => void,
): Promise<ArenaLaneState> {
  const authored = BENCH_CASES.find((item) => item.id === config.caseId);
  if (!authored)
    throw new Error(`Unknown benchmark case: ${config.caseId}.`);

  const now = dependencies.now ?? (() => performance.now());
  const state: ArenaLaneState = {
    ...initialLaneState(lane),
    runId,
    caseId: authored.id,
    prompt: authored.prompt,
  };
  const emit = () => publish(structuredClone(state));

  if (config.mode === "live" && !lane.available) {
    state.status = "unavailable";
    state.error = missingKeyMessage(lane);
    emit();
    return structuredClone(state);
  }

  state.status = "running";
  emit();

  const deadline = AbortSignal.timeout(
    Math.min(60_000, Math.max(1, dependencies.timeoutMs ?? 25_000)),
  );
  const signal = AbortSignal.any([parentSignal, deadline]);
  const began = now();
  const record = (event: Omit<ArenaEvent, "message"> & { message?: string }) => {
    state.events.push({ message: null, ...event });
    emit();
  };
  const finish = (
    phase: ArenaEvent["phase"],
    atMs: number,
    durationMs: number,
    error: unknown,
  ) => {
    const cancelled = parentSignal.aborted;
    const message = cancelled
      ? error instanceof Error
        ? error.message
        : "Stopped by you."
      : deadline.aborted
        ? "This lane exceeded its time limit."
        : error instanceof Error
          ? error.message
          : "The lane failed.";
    state.status = cancelled ? "cancelled" : "error";
    state.error = message;
    state.timings.totalMs = atMs - began;
    record({
      phase,
      status: cancelled ? "cancelled" : "error",
      atMs: atMs - began,
      durationMs,
      message,
    });
  };

  record({ phase: "decision", status: "started", atMs: 0, durationMs: null });
  let decisionEnd = began;
  try {
    const decision = await abortable(
      dependencies.provider(toCaseInput(authored), signal),
      signal,
    );
    decisionEnd = now();
    state.decision = structuredClone(decision);
    state.expected = structuredClone(authored.expected);
    state.score = scoreCall(authored.expected, {
      tool: decision.tool,
      arguments: decision.arguments,
    });
    state.timings.decisionMs = decisionEnd - began;
    record({
      phase: "decision",
      status: "finished",
      atMs: decisionEnd - began,
      durationMs: decisionEnd - began,
    });
  } catch (error) {
    decisionEnd = now();
    // A model that answered without a usable call still selected something;
    // keep that visible instead of discarding the attempt.
    if (!signal.aborted && error instanceof BenchOutputError) {
      state.expected = structuredClone(authored.expected);
      state.score = {
        toolCorrect: error.selectedTool === authored.expected.tool,
        argumentsCorrect: false,
        correct: false,
      };
    }
    state.timings.decisionMs = decisionEnd - began;
    finish("decision", decisionEnd, decisionEnd - began, error);
    return structuredClone(state);
  }

  record({
    phase: "tool",
    status: "started",
    atMs: decisionEnd - began,
    durationMs: null,
  });
  try {
    const execution = await abortable(
      dependencies.execute(
        { tool: state.decision.tool, arguments: state.decision.arguments },
        signal,
      ),
      signal,
    );
    const toolEnd = now();
    state.execution = structuredClone(execution);
    state.status = "complete";
    state.timings.toolMs = toolEnd - decisionEnd;
    state.timings.totalMs = toolEnd - began;
    record({
      phase: "tool",
      status: "finished",
      atMs: toolEnd - began,
      durationMs: toolEnd - decisionEnd,
    });
  } catch (error) {
    const toolEnd = now();
    state.timings.toolMs = toolEnd - decisionEnd;
    finish("tool", toolEnd, toolEnd - decisionEnd, error);
  }
  return structuredClone(state);
}
