import { z } from "zod";
import { DEFAULT_LANES, type LaneDefinition } from "../race/types";
import type { scoreCall } from "./scoring";

export const benchConfigSchema = z.object({
  mode: z.enum(["sample", "live"]),
  caseCount: z.number().int().min(1).max(12).default(6),
});
export type BenchConfig = z.infer<typeof benchConfigSchema>;
export const DEFAULT_BENCH_CONFIG: BenchConfig = {
  mode: "sample",
  caseCount: 6,
};
export const DATASET_VERSION = "support-v1";
export type ToolCall = { tool: string; arguments: Record<string, unknown> };
export type BenchCaseInput = {
  id: string;
  prompt: string;
  entities: Record<string, string[]>;
};
export type BenchCase = BenchCaseInput & { expected: ToolCall };
export type BenchDecision = ToolCall & {
  modelMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  confidence: number | null;
  choices: { tool: string; probability: number }[];
};
export type BenchResult = {
  caseId: string;
  prompt: string;
  expected: ToolCall;
  actual: ToolCall | null;
  toolCorrect: boolean;
  argumentsCorrect: boolean;
  correct: boolean;
  modelMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  confidence: number | null;
  choices: { tool: string; probability: number }[];
  error: string | null;
};
export type BenchLane = LaneDefinition & {
  status:
    "ready" | "running" | "complete" | "cancelled" | "error" | "unavailable";
  currentCase: BenchCaseInput | null;
  results: BenchResult[];
  elapsedMs: number;
  startedAt: number | null;
  modelMs: number;
  error: string | null;
};
export type BenchState = {
  config: BenchConfig;
  status: "idle" | "running" | "complete" | "cancelled";
  lanes: BenchLane[];
  runId: string;
  datasetVersion: string;
  totalCases: number;
};
export type BenchProvider = (
  input: BenchCaseInput,
  signal: AbortSignal,
) => Promise<BenchDecision>;
export type BenchDependencies = {
  cases: BenchCase[];
  providers: Record<string, BenchProvider>;
  durationMs?: number;
};
/** One synchronized race sends the same single case to every agent lane. */
export const arenaConfigSchema = z.object({
  mode: z.enum(["sample", "live"]),
  caseId: z.string().min(1),
});
export type ArenaConfig = z.infer<typeof arenaConfigSchema>;
export type ArenaPhase = "decision" | "tool" | "render";
export type ArenaEvent = {
  phase: ArenaPhase;
  status: "started" | "finished" | "error" | "cancelled";
  atMs: number;
  durationMs: number | null;
  message: string | null;
};
export type ToolExecution = {
  tool: string;
  arguments: Record<string, unknown>;
  result: Record<string, unknown>;
};
export type LaneTimings = {
  decisionMs: number;
  toolMs: number;
  renderMs: number;
  totalMs: number;
};
export type ArenaLaneStatus =
  "idle" | "running" | "complete" | "cancelled" | "error" | "unavailable";
export type ArenaLaneState = LaneDefinition & {
  status: ArenaLaneStatus;
  runId: string;
  caseId: string | null;
  prompt: string;
  expected: ToolCall | null;
  decision: BenchDecision | null;
  execution: ToolExecution | null;
  score: ReturnType<typeof scoreCall> | null;
  timings: LaneTimings;
  events: ArenaEvent[];
  error: string | null;
};
/** Names the required server variable without ever revealing its value. */
export function missingKeyMessage(lane: LaneDefinition) {
  return lane.provider === "jev"
    ? "Configure TYPESAFE_API_KEY to enable live Jev."
    : "Configure OPENROUTER_API_KEY to enable this comparison model.";
}
export function initialLaneState(lane: LaneDefinition): ArenaLaneState {
  return {
    ...lane,
    status: lane.available ? "idle" : "unavailable",
    runId: "",
    caseId: null,
    prompt: "",
    expected: null,
    decision: null,
    execution: null,
    score: null,
    timings: { decisionMs: 0, toolMs: 0, renderMs: 0, totalMs: 0 },
    events: [],
    error: null,
  };
}

export function initialBench(
  config = DEFAULT_BENCH_CONFIG,
  definitions = DEFAULT_LANES,
): BenchState {
  return {
    config,
    status: "idle",
    runId: "",
    datasetVersion: DATASET_VERSION,
    totalCases: config.caseCount,
    lanes: definitions.map((lane) => ({
      ...lane,
      status: "ready",
      currentCase: null,
      results: [],
      elapsedMs: 0,
      startedAt: null,
      modelMs: 0,
      error: null,
    })),
  };
}
