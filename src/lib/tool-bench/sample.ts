import { DEFAULT_LANES } from "../race/types";
import { BENCH_CASES } from "./cases";
import { abortableDelay } from "./executor";
import { TOOL_REGISTRY } from "./tools";
import type { BenchProvider } from "./types";

/** Authored lane order only; it staggers the demo, it is not a measurement. */
export function sampleLaneIndex(laneId: string) {
  const index = DEFAULT_LANES.findIndex((lane) => lane.id === laneId);
  return index < 0 ? 0 : index;
}

/** Synthetic ranked choices so the Jev evidence surface has something to show. */
export function sampleRankedChoices(selected: string) {
  const others = TOOL_REGISTRY.map((tool) => tool.name).filter(
    (name) => name !== selected,
  );
  return [
    { tool: selected, probability: 0.94 },
    { tool: others[0], probability: 0.04 },
    { tool: others[1], probability: 0.02 },
  ];
}

/**
 * Sample mode replays the authored answer after a controlled per-lane delay.
 * Every result is synthetic: the staggered delays demonstrate the race, they are
 * not provider latency and never support a benchmark claim.
 */
export function createSampleProvider(laneId: string): BenchProvider {
  const modelMs = 350 + sampleLaneIndex(laneId) * 140;
  return async (input, signal) => {
    const authored = BENCH_CASES.find((item) => item.id === input.id);
    if (!authored) throw new Error("Unknown sample case.");
    await abortableDelay(modelMs, signal);
    return {
      ...structuredClone(authored.expected),
      modelMs,
      inputTokens: null,
      outputTokens: null,
      confidence: laneId === "jev" ? 0.94 : null,
      choices:
        laneId === "jev" ? sampleRankedChoices(authored.expected.tool) : [],
    };
  };
}
