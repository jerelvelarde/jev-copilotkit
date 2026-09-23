import { afterEach, describe, expect, it, vi } from "vitest";
import { ARENA_LANES } from "./lanes";
import { BENCH_CASES, toCaseInput } from "./cases";
import { createSampleProvider, sampleRankedChoices } from "./sample";
import type { BenchDecision } from "./types";

afterEach(() => vi.useRealTimers());
describe("explicitly simulated arena providers", () => {
  it("staggers the authored answer by lane so the race is visible", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const results: { id: string; decision: BenchDecision }[] = [];
    const pending = Promise.all(
      ARENA_LANES.map((lane) =>
        createSampleProvider(lane.id)(
          toCaseInput(BENCH_CASES[0]),
          new AbortController().signal,
        ).then((decision) => results.push({ id: lane.id, decision })),
      ),
    );
    await vi.advanceTimersByTimeAsync(349);
    expect(results).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(results.map((entry) => entry.id)).toEqual(["jev"]);
    await vi.advanceTimersByTimeAsync(420);
    await pending;
    expect(results.map((entry) => entry.decision.modelMs)).toEqual([
      350, 490, 630, 770,
    ]);
    for (const { decision } of results)
      expect(decision).toMatchObject({
        ...BENCH_CASES[0].expected,
        inputTokens: null,
        outputTokens: null,
      });
  });

  it("returns ranked choices and confidence only for the Jev lane", async () => {
    const jev = await createSampleProvider("jev")(
      toCaseInput(BENCH_CASES[0]),
      new AbortController().signal,
    );
    expect(jev.confidence).toBe(0.94);
    expect(jev.choices).toEqual(
      sampleRankedChoices(BENCH_CASES[0].expected.tool),
    );
    expect(jev.choices[0].tool).toBe(BENCH_CASES[0].expected.tool);
    const gpt = await createSampleProvider("gpt")(
      toCaseInput(BENCH_CASES[0]),
      new AbortController().signal,
    );
    expect(gpt.confidence).toBeNull();
    expect(gpt.choices).toEqual([]);
  });

  it("stops promptly and never falls back for unknown cases", async () => {
    const provider = createSampleProvider("jev");
    const controller = new AbortController();
    const pending = provider(toCaseInput(BENCH_CASES[0]), controller.signal);
    controller.abort(new Error("Stopped"));
    await expect(pending).rejects.toThrow("Stopped");
    await expect(
      provider(
        { id: "unknown", prompt: "", entities: {} },
        new AbortController().signal,
      ),
    ).rejects.toThrow("Unknown sample case");
  });
});
