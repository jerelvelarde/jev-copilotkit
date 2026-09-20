import { describe, expect, it, vi } from "vitest";
import { DEFAULT_LANES } from "../race/types";
import { BENCH_CASES } from "./cases";
import { runBenchmark } from "./engine";
import { BenchOutputError } from "./providers";
import type { BenchDecision, BenchDependencies, BenchState } from "./types";

const config = { mode: "live" as const, caseCount: 2 };
const definitions = DEFAULT_LANES.slice(0, 2);
const decision = (index = 0): BenchDecision => ({
  ...BENCH_CASES[index].expected,
  modelMs: 1,
  inputTokens: null,
  outputTokens: null,
  confidence: null,
  choices: [],
});
const dependencies = (): BenchDependencies => ({
  cases: BENCH_CASES,
  providers: {
    jev: async (input) =>
      decision(BENCH_CASES.findIndex((c) => c.id === input.id)),
  },
});
async function bench(
  deps = dependencies(),
  signal = new AbortController().signal,
) {
  const snapshots: BenchState[] = [];
  await runBenchmark(config, definitions, deps, signal, (state) =>
    snapshots.push(state),
  );
  return { result: snapshots.at(-1)!, snapshots };
}
describe("tool benchmark engine", () => {
  it("strips labels, streams cloned progress and scores sequential cases", async () => {
    const deps = dependencies();
    const provider = vi.fn(deps.providers.jev);
    deps.providers.jev = provider;
    const { snapshots, result } = await bench(deps);
    expect(provider.mock.calls.map(([input]) => input.id)).toEqual(
      BENCH_CASES.slice(0, 2).map((c) => c.id),
    );
    for (const [input] of provider.mock.calls)
      expect(input).not.toHaveProperty("expected");
    expect(result.lanes[0].results.every((r) => r.correct)).toBe(true);
    expect(result.lanes[0].status).toBe("complete");
    expect(result.lanes[1].status).toBe("unavailable");
    expect(snapshots[0].lanes[0].results).toHaveLength(0);
    result.lanes[0].results[0].expected.arguments.order_id = "changed";
    expect(BENCH_CASES[0].expected.arguments.order_id).not.toBe("changed");
  });
  it("counts invalid calls and malformed output then continues the lane", async () => {
    const deps = dependencies();
    deps.providers.jev = vi
      .fn()
      .mockResolvedValueOnce({ ...decision(), tool: "invented" })
      .mockRejectedValueOnce(
        new BenchOutputError("Malformed tool arguments", 5),
      );
    const { result } = await bench(deps);
    expect(result.lanes[0].status).toBe("complete");
    expect(result.lanes[0].results).toHaveLength(2);
    expect(result.lanes[0].results.every((r) => !r.correct)).toBe(true);
    expect(result.lanes[0].results[1].error).toContain("Malformed");
  });
  it("isolates fatal provider errors and records their failed case", async () => {
    const deps = dependencies();
    deps.providers.gpt = async () => {
      throw new Error("Provider HTTP 401");
    };
    const { result } = await bench(deps);
    expect(result.lanes[0].results).toHaveLength(2);
    expect(result.lanes[1].status).toBe("error");
    expect(result.lanes[1].results[0].error).toContain("401");
  });
  it("retains a readable tool selection when its argument JSON is malformed", async () => {
    const deps = dependencies();
    deps.providers.jev = async (input) => {
      throw new BenchOutputError(
        "Malformed arguments",
        2,
        10,
        3,
        null,
        BENCH_CASES.find((item) => item.id === input.id)!.expected.tool,
      );
    };
    const { result } = await bench(deps);
    expect(
      result.lanes[0].results.every(
        (item) => item.toolCorrect && !item.argumentsCorrect && !item.correct,
      ),
    ).toBe(true);
  });
  it("cancels a noncooperative provider and preserves completed results and wait time", async () => {
    const controller = new AbortController();
    const deps = dependencies();
    deps.providers.jev = vi
      .fn()
      .mockResolvedValueOnce(decision())
      .mockImplementationOnce(() => new Promise(() => {}));
    const pending = bench(deps, controller.signal);
    const timer = setTimeout(() => controller.abort(), 20);
    const { result } = await pending;
    clearTimeout(timer);
    expect(result.status).toBe("cancelled");
    expect(result.lanes[0].status).toBe("cancelled");
    expect(result.lanes[0].results).toHaveLength(1);
    expect(result.lanes[0].elapsedMs).toBeGreaterThan(0);
    expect(result.lanes[0].modelMs).toBeGreaterThan(1);
  });
  it("bounds a noncooperative provider by the run deadline", async () => {
    const deps = dependencies();
    deps.durationMs = 15;
    deps.providers.jev = () => new Promise(() => {});
    const { result } = await bench(deps);
    expect(result.lanes[0].status).toBe("error");
    expect(result.lanes[0].error).toContain("time budget");
    expect(result.lanes[0].results).toHaveLength(0);
  });
  it("starts lanes concurrently and protects inputs from provider mutation", async () => {
    const deps = dependencies();
    let unlock: (() => void) | undefined;
    const joined = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    deps.providers.jev = async (input) => {
      input.entities.order_id[0] = "tampered";
      await joined;
      return decision();
    };
    deps.providers.gpt = async (input) => {
      expect(input.entities.order_id[0]).not.toBe("tampered");
      unlock?.();
      return decision();
    };
    const { result } = await bench(deps);
    expect(result.lanes.every((l) => l.status === "complete")).toBe(true);
    expect(BENCH_CASES[0].entities.order_id[0]).not.toBe("tampered");
  });
});
