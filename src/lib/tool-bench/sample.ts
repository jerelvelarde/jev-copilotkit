import { DEFAULT_LANES, type LaneDefinition } from "../race/types";
import { BENCH_CASES } from "./cases";
import type { BenchConfig, BenchDependencies, BenchProvider } from "./types";

export function createSampleDependencies(
  _config: BenchConfig,
  definitions: LaneDefinition[] = DEFAULT_LANES,
): BenchDependencies {
  const sample: BenchProvider = async (input, signal) => {
    const began = performance.now();
    const authored = BENCH_CASES.find((item) => item.id === input.id);
    if (!authored) throw new Error("Unknown sample case.");
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      }, 650);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
    return {
      ...structuredClone(authored.expected),
      modelMs: performance.now() - began,
      inputTokens: null,
      outputTokens: null,
      confidence: null,
      choices: [],
    };
  };
  return {
    cases: BENCH_CASES,
    providers: Object.fromEntries(definitions.map((lane) => [lane.id, sample])),
  };
}
