import { z } from "zod";
import { DEFAULT_LANES, type LaneDefinition } from "../race/types";

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
