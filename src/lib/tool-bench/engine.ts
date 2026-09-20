import type { LaneDefinition } from "../race/types";
import { abortable } from "../cancellation";
import { toCaseInput } from "./cases";
import { BenchOutputError } from "./providers";
import { scoreCall } from "./scoring";
import {
  benchConfigSchema,
  initialBench,
  type BenchConfig,
  type BenchDependencies,
  type BenchResult,
  type BenchState,
} from "./types";

export async function runBenchmark(
  configInput: BenchConfig,
  definitions: LaneDefinition[],
  dependencies: BenchDependencies,
  parentSignal: AbortSignal,
  publish: (state: BenchState) => void,
): Promise<void> {
  const config = benchConfigSchema.parse(configInput);
  const cases = structuredClone(dependencies.cases.slice(0, config.caseCount));
  if (cases.length !== config.caseCount)
    throw new Error(
      "The benchmark dataset does not contain the requested number of cases.",
    );
  const deadline = AbortSignal.timeout(
    Math.min(90_000, Math.max(1, dependencies.durationMs ?? 90_000)),
  );
  const signal = AbortSignal.any([parentSignal, deadline]);
  const state = initialBench(config, definitions);
  state.runId = crypto.randomUUID();
  state.status = "running";
  const emit = () => publish(structuredClone(state));
  for (const lane of state.lanes) {
    lane.status = dependencies.providers[lane.id] ? "ready" : "unavailable";
    if (lane.status === "unavailable")
      lane.error =
        lane.provider === "jev"
          ? "Configure TYPESAFE_API_KEY to enable live Jev."
          : "Configure OPENROUTER_API_KEY to enable this comparison model.";
  }
  emit();
  const began = performance.now();
  const wallStart = Date.now();
  await Promise.all(
    state.lanes.map(async (lane) => {
      if (lane.status === "unavailable") return;
      lane.startedAt = wallStart;
      try {
        for (const item of cases) {
          signal.throwIfAborted();
          lane.status = "running";
          lane.currentCase = toCaseInput(item);
          lane.elapsedMs = performance.now() - began;
          emit();
          const requestSignal = AbortSignal.any([
            signal,
            AbortSignal.timeout(lane.provider === "jev" ? 15_000 : 20_000),
          ]);
          const requestStart = performance.now();
          const base: BenchResult = {
            caseId: item.id,
            prompt: item.prompt,
            expected: structuredClone(item.expected),
            actual: null,
            toolCorrect: false,
            argumentsCorrect: false,
            correct: false,
            modelMs: 0,
            inputTokens: null,
            outputTokens: null,
            confidence: null,
            choices: [],
            error: null,
          };
          try {
            const selected = await abortable(
              dependencies.providers[lane.id](toCaseInput(item), requestSignal),
              requestSignal,
            );
            signal.throwIfAborted();
            const actual = {
              tool: selected.tool,
              arguments: selected.arguments,
            };
            lane.results.push({
              ...base,
              actual: structuredClone(actual),
              ...scoreCall(item.expected, actual),
              modelMs: selected.modelMs,
              inputTokens: selected.inputTokens,
              outputTokens: selected.outputTokens,
              confidence: selected.confidence,
              choices: structuredClone(selected.choices),
            });
            lane.modelMs += selected.modelMs;
          } catch (error) {
            const waited = performance.now() - requestStart;
            lane.modelMs += waited;
            // Stops/deadlines preserve only completed decisions. An actual provider
            // failure is a visible failed case and ends just this lane.
            if (signal.aborted) throw error;
            if (error instanceof BenchOutputError) {
              lane.results.push({
                ...base,
                actual: error.actual,
                toolCorrect: error.selectedTool === item.expected.tool,
                modelMs: error.modelMs,
                inputTokens: error.inputTokens,
                outputTokens: error.outputTokens,
                error: error.message,
              });
            } else {
              const message = requestSignal.aborted
                ? "Model request exceeded its time limit."
                : error instanceof Error
                  ? error.message
                  : "Model request failed.";
              lane.results.push({ ...base, modelMs: waited, error: message });
              throw new Error(message);
            }
          }
          lane.elapsedMs = performance.now() - began;
          emit();
        }
        lane.status = "complete";
        lane.currentCase = null;
      } catch (error) {
        lane.status = parentSignal.aborted ? "cancelled" : "error";
        lane.error = parentSignal.aborted
          ? "Stopped by you."
          : deadline.aborted
            ? "Benchmark exceeded its time budget."
            : error instanceof Error
              ? error.message
              : "Benchmark lane failed.";
      }
      lane.elapsedMs = performance.now() - began;
      emit();
    }),
  );
  state.status = parentSignal.aborted ? "cancelled" : "complete";
  emit();
}
