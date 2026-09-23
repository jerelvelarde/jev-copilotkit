import { describe, expect, it, vi } from "vitest";
import { DEFAULT_LANES, type LaneDefinition } from "../race/types";
import { BENCH_CASES } from "./cases";
import { executeToolCall } from "./executor";
import type { ToolCall } from "./types";
import { runArenaLane, type LaneDependencies } from "./lane-engine";
import { BenchOutputError } from "./providers";
import type {
  ArenaConfig,
  ArenaLaneState,
  BenchDecision,
  BenchProvider,
} from "./types";

const lane: LaneDefinition = { ...DEFAULT_LANES[0], available: true };
const config: ArenaConfig = { mode: "live", caseId: "earth-article" };
const authored = BENCH_CASES[0];
const fakeExecute = async (call: ToolCall) => ({
  ...call,
  result: {
    kind: "article",
    title: "Earth",
    extract: "Text",
    linkCount: 1,
    url: "https://en.wikipedia.org/wiki/Earth",
  },
});

const decision = (overrides: Partial<BenchDecision> = {}): BenchDecision => ({
  ...structuredClone(authored.expected),
  modelMs: 0,
  inputTokens: null,
  outputTokens: null,
  confidence: null,
  choices: [],
  ...overrides,
});

/**
 * The engine reads the clock once per phase boundary: start, decision end, tool
 * end. Each step is that phase's duration, so the math stays exact.
 */
function steppedClock(steps: number[]) {
  let index = 0;
  let value = 0;
  return () => {
    if (index++ === 0) return 0;
    value += steps[Math.min(index - 2, steps.length - 1)];
    return value;
  };
}

async function runLane({
  provider = (async () => decision()) as BenchProvider,
  execute = fakeExecute,
  now,
  timeoutMs,
  signal = new AbortController().signal,
  laneDefinition = lane,
  runConfig = config,
}: {
  provider?: BenchProvider;
  execute?: LaneDependencies["execute"];
  now?: () => number;
  timeoutMs?: number;
  signal?: AbortSignal;
  laneDefinition?: LaneDefinition;
  runConfig?: ArenaConfig;
} = {}) {
  const snapshots: ArenaLaneState[] = [];
  const final = await runArenaLane(
    laneDefinition,
    runConfig,
    "run-1",
    { provider, execute, now, timeoutMs },
    signal,
    (state) => snapshots.push(state),
  );
  return { final, snapshots };
}

const phases = (state: ArenaLaneState) =>
  state.events.map(({ phase, status }) => [phase, status]);

describe("one-lane arena engine", () => {
  it("emits an ordered timeline, scores the call and runs the local tool", async () => {
    const { final } = await runLane({
      now: steppedClock([20, 10]),
      execute: fakeExecute,
    });
    expect(phases(final)).toEqual([
      ["decision", "started"],
      ["decision", "finished"],
      ["tool", "started"],
      ["tool", "finished"],
    ]);
    expect(final.score).toEqual({
      toolCorrect: true,
      argumentsCorrect: true,
      correct: true,
    });
    expect(final.execution?.result).toMatchObject({ kind: "article" });
    expect(final.timings).toMatchObject({
      decisionMs: 20,
      toolMs: 10,
      totalMs: 30,
    });
    expect(final.status).toBe("complete");
    expect(final.runId).toBe("run-1");
    expect(final.caseId).toBe(authored.id);
    expect(final.prompt).toBe(authored.prompt);
    expect(final.expected).toEqual(authored.expected);
  });

  it("publishes cloned snapshots at every phase boundary", async () => {
    const { final, snapshots } = await runLane({
      execute: fakeExecute,
    });
    expect(snapshots.map((state) => state.events.length)).toEqual([
      0, 1, 2, 3, 4,
    ]);
    expect(snapshots.at(-1)).not.toBe(final);
    snapshots[0].events.push({
      phase: "render",
      status: "error",
      atMs: 0,
      durationMs: null,
      message: null,
    });
    expect(final.events).toHaveLength(4);
  });

  it("hides the expected label from the provider input", async () => {
    const provider = vi.fn<BenchProvider>(async () => decision());
    await runLane({
      provider,
      execute: fakeExecute,
    });
    const [input] = provider.mock.calls[0];
    expect(input).not.toHaveProperty("expected");
    expect(input.id).toBe(authored.id);
  });

  it("executes a schema-valid but incorrect call and marks it incorrect", async () => {
    const { final } = await runLane({
      provider: async () =>
        decision({
          tool: "get_github_repository",
          arguments: { repository: "cli/cli" },
        }),
      execute: fakeExecute,
    });
    expect(final.status).toBe("complete");
    expect(final.score).toEqual({
      toolCorrect: false,
      argumentsCorrect: false,
      correct: false,
    });
    expect(final.execution?.result).toMatchObject({ kind: "article" });
    expect(phases(final).at(-1)).toEqual(["tool", "finished"]);
  });

  it.each([
    [
      "an unknown tool",
      async () => decision({ tool: "invented", arguments: {} }),
      "Unknown tool",
    ],
    [
      "invalid arguments",
      async () => decision({ arguments: { title: 7 } }),
      "Invalid arguments",
    ],
  ])("fails without a fabricated result for %s", async (_label, provider) => {
    const { final } = await runLane({
      provider: provider as BenchProvider,
      execute: (call, signal) =>
        executeToolCall(call, signal, async () => Response.json({})),
    });
    expect(final.status).toBe("error");
    expect(final.execution).toBeNull();
    expect(final.decision).not.toBeNull();
    expect(phases(final)).toEqual([
      ["decision", "started"],
      ["decision", "finished"],
      ["tool", "started"],
      ["tool", "error"],
    ]);
    expect(final.error).toBeTruthy();
  });

  it("records a provider failure as a decision error and keeps prior events", async () => {
    const { final } = await runLane({
      provider: async () => {
        throw new Error("Provider HTTP 401");
      },
    });
    expect(final.status).toBe("error");
    expect(final.error).toContain("401");
    expect(final.decision).toBeNull();
    expect(phases(final)).toEqual([
      ["decision", "started"],
      ["decision", "error"],
    ]);
  });

  it("keeps a readable tool selection when the provider output is unusable", async () => {
    const { final } = await runLane({
      provider: async () => {
        throw new BenchOutputError(
          "Malformed tool arguments",
          5,
          null,
          null,
          null,
          "get_wikipedia_article",
        );
      },
    });
    expect(final.status).toBe("error");
    expect(final.score).toEqual({
      toolCorrect: true,
      argumentsCorrect: false,
      correct: false,
    });
    expect(final.execution).toBeNull();
  });

  it("reports a tool failure without discarding the decision", async () => {
    const { final } = await runLane({
      execute: async () => {
        throw new Error("Tool backend unavailable");
      },
    });
    expect(final.status).toBe("error");
    expect(final.error).toContain("Tool backend unavailable");
    expect(final.decision).not.toBeNull();
    expect(final.execution).toBeNull();
    expect(phases(final).at(-1)).toEqual(["tool", "error"]);
  });

  it("bounds a noncooperative provider with its own deadline", async () => {
    const { final } = await runLane({
      provider: () => new Promise(() => {}),
      timeoutMs: 15,
    });
    expect(final.status).toBe("error");
    expect(final.error).toContain("time limit");
    expect(phases(final).at(-1)).toEqual(["decision", "error"]);
  });

  it("cancels through the parent signal and preserves completed events", async () => {
    const controller = new AbortController();
    const pending = runLane({
      provider: async (_input, signal) => {
        await new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          }),
        );
        return decision();
      },
      signal: controller.signal,
    });
    // The SDK aborts with a DOMException; the lane must not surface it raw.
    controller.abort(
      new DOMException("This operation was aborted", "AbortError"),
    );
    const { final } = await pending;
    expect(final.status).toBe("cancelled");
    expect(final.error).toBe("Stopped by you.");
    expect(phases(final)).toEqual([
      ["decision", "started"],
      ["decision", "cancelled"],
    ]);
  });

  it("refuses an unknown case without falling back to another one", async () => {
    await expect(
      runLane({ runConfig: { mode: "live", caseId: "not-a-case" } }),
    ).rejects.toThrow("Unknown benchmark case");
  });

  it("marks an unconfigured lane unavailable without calling the provider", async () => {
    const provider = vi.fn<BenchProvider>(async () => decision());
    const { final } = await runLane({
      provider,
      laneDefinition: { ...lane, available: false },
    });
    expect(final.status).toBe("unavailable");
    expect(final.error).toContain("TYPESAFE_API_KEY");
    expect(provider).not.toHaveBeenCalled();
  });
});
