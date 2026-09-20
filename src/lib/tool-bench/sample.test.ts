import { afterEach, describe, expect, it, vi } from "vitest";
import { BENCH_CASES, toCaseInput } from "./cases";
import { createSampleDependencies } from "./sample";
import type { BenchDecision } from "./types";

afterEach(() => vi.useRealTimers());
describe("explicitly simulated benchmark providers", () => {
  it("gives every lane the same 650ms delay and correct authored answers", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const dependencies = createSampleDependencies({
      mode: "sample",
      caseCount: 1,
    });
    const results: BenchDecision[] = [];
    const pending = Promise.all(
      Object.values(dependencies.providers).map((provider) =>
        provider(
          toCaseInput(BENCH_CASES[0]),
          new AbortController().signal,
        ).then((result) => results.push(result)),
      ),
    );
    await vi.advanceTimersByTimeAsync(649);
    expect(results).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(results).toHaveLength(4);
    for (const result of results)
      expect(result).toMatchObject({
        ...BENCH_CASES[0].expected,
        modelMs: 650,
        inputTokens: null,
        outputTokens: null,
        confidence: null,
      });
  });
  it("stops promptly and never falls back for unknown cases", async () => {
    const provider = createSampleDependencies({ mode: "sample", caseCount: 1 })
      .providers.jev;
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
