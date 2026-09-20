import { AbstractAgent } from "@ag-ui/client";
import { EventType, type BaseEvent, type RunAgentInput } from "@ag-ui/core";
import { CopilotKitCoreReact } from "@copilotkit/react-core/v2/context";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Observable, type Subscriber } from "rxjs";
import { describe, expect, it } from "vitest";
import {
  initialBench,
  type BenchLane,
  type BenchResult,
  type BenchState,
} from "../lib/tool-bench/types";
import { ToolBenchLane } from "./tool-bench-lane";
import {
  interruptBench,
  isTerminalBench,
  runWithBenchLifecycle,
  selectBenchState,
} from "./tool-bench-lifecycle";
import { benchComparisons, laneMetrics } from "./tool-bench-metrics";

function result(overrides: Partial<BenchResult> = {}): BenchResult {
  return {
    caseId: "lookup-order",
    prompt: "Look up order ORD-10.",
    expected: { tool: "lookup_order", arguments: { order_id: "ORD-10" } },
    actual: { tool: "lookup_order", arguments: { order_id: "ORD-10" } },
    toolCorrect: true,
    argumentsCorrect: true,
    correct: true,
    modelMs: 100,
    inputTokens: null,
    outputTokens: null,
    confidence: null,
    choices: [],
    error: null,
    ...overrides,
  };
}

function runningBench(): BenchState {
  const state = initialBench({ mode: "live", caseCount: 2 });
  return {
    ...state,
    runId: crypto.randomUUID(),
    status: "running",
    lanes: state.lanes.map((lane) => ({
      ...lane,
      available: true,
      status: "running",
      startedAt: 100,
      elapsedMs: 100,
    })),
  };
}

type Script = (input: RunAgentInput, subscriber: Subscriber<BaseEvent>) => void;
class ScriptedBenchAgent extends AbstractAgent {
  constructor(private readonly script: Script) {
    super({ agentId: "tool_bench" });
  }
  run(input: RunAgentInput) {
    return new Observable<BaseEvent>((subscriber) => {
      subscriber.next({
        type: EventType.RUN_STARTED,
        runId: input.runId,
        threadId: input.threadId,
      });
      this.script(input, subscriber);
    });
  }
}

async function runScript(script: Script, cancelled = false) {
  const agent = new ScriptedBenchAgent(script);
  const state = runningBench();
  agent.setState(state);
  const copilotkit = new CopilotKitCoreReact({
    agents__unsafe_dev_only: { tool_bench: agent },
  });
  const observed: {
    errors: string[];
    fallback: BenchState | null;
    resolved: boolean;
  } = { errors: [], fallback: null, resolved: false };
  await runWithBenchLifecycle({
    agent,
    initialState: state,
    isCancelled: () => cancelled,
    onError: (message) => {
      observed.errors.push(message);
    },
    onFallback: (fallback) => {
      observed.fallback = fallback;
    },
    run: async () => {
      await copilotkit.runAgent({ agent, runId: state.runId });
      observed.resolved = true;
    },
  });
  return { ...observed, agent, state };
}

describe("benchmark UI lifecycle with the installed SDK", () => {
  it("makes active lanes terminal when RUN_ERROR resolves without rejecting", async () => {
    const observed = await runScript((_input, subscriber) => {
      subscriber.next({
        type: EventType.RUN_ERROR,
        message: "Provider disconnected.",
      });
      subscriber.complete();
    });
    expect(observed.resolved).toBe(true);
    expect(observed.errors).toContain("Provider disconnected.");
    expect(
      observed.fallback?.lanes.every((lane) => lane.status === "error"),
    ).toBe(true);
  });

  it("handles transport failures swallowed by the SDK", async () => {
    const observed = await runScript((_input, subscriber) =>
      subscriber.error(new Error("Connection lost.")),
    );
    expect(observed.resolved).toBe(true);
    expect(observed.errors).toContain("Connection lost.");
    expect(observed.fallback && isTerminalBench(observed.fallback)).toBe(true);
  });

  it("rejects an incomplete resolved run but treats an explicit stop as cancellation", async () => {
    const end: Script = (input, subscriber) => {
      subscriber.next({
        type: EventType.RUN_FINISHED,
        runId: input.runId,
        threadId: input.threadId,
      });
      subscriber.complete();
    };
    const incomplete = await runScript(end);
    expect(incomplete.errors[0]).toContain("before a final result arrived");
    const stopped = await runScript(end, true);
    expect(stopped.errors).toEqual([]);
    expect(
      stopped.fallback?.lanes.every((lane) => lane.status === "cancelled"),
    ).toBe(true);
  });

  it("prefers the authoritative same-run cancellation snapshot and preserves completed results", async () => {
    const observed = await runScript((input, subscriber) => {
      const state = runningBench();
      const final = interruptBench({
        ...state,
        runId: input.runId,
        lanes: state.lanes.map((lane) => ({
          ...lane,
          results: [result()],
          elapsedMs: 450,
          modelMs: 280,
        })),
      });
      subscriber.next({ type: EventType.STATE_SNAPSHOT, snapshot: final });
      subscriber.next({
        type: EventType.RUN_FINISHED,
        runId: input.runId,
        threadId: input.threadId,
      });
      subscriber.complete();
    }, true);
    const visible = selectBenchState(
      observed.agent.state,
      interruptBench(observed.state),
      initialBench(),
    );
    expect(observed.errors).toEqual([]);
    expect(visible.lanes[0]).toMatchObject({
      status: "cancelled",
      elapsedMs: 450,
      modelMs: 280,
      results: [result()],
    });
  });

  it("holds local cancellation through late nonterminal or other-run snapshots", () => {
    const state = runningBench();
    const fallback = interruptBench(state);
    expect(selectBenchState(state, fallback, initialBench())).toBe(fallback);
    expect(
      selectBenchState(
        interruptBench(runningBench()),
        fallback,
        initialBench(),
      ),
    ).toBe(fallback);
    const completedLane: BenchLane = {
      ...state.lanes[0],
      status: "complete",
      results: [result()],
      elapsedMs: 400,
    };
    const interrupted = interruptBench(
      { ...state, lanes: [completedLane, state.lanes[1]] },
      "Network failed.",
    );
    expect(interrupted.lanes[0]).toBe(completedLane);
    expect(interrupted.lanes[1].status).toBe("error");
  });
});

describe("benchmark metrics", () => {
  it("counts failed attempts in accuracy and duration without boosting correct throughput", () => {
    const lane: BenchLane = {
      ...runningBench().lanes[0],
      elapsedMs: 2000,
      results: [
        result({ modelMs: 100 }),
        result({
          actual: null,
          correct: false,
          toolCorrect: false,
          argumentsCorrect: false,
          modelMs: 900,
          error: "Timeout",
        }),
      ],
    };
    expect(laneMetrics(lane)).toEqual({
      count: 2,
      correct: 1,
      toolCorrect: 1,
      p50: 100,
      p95: 900,
      correctPerSecond: 0.5,
    });
    expect(
      laneMetrics({
        ...lane,
        results: lane.results.map((entry) => ({ ...entry, correct: false })),
      }).correctPerSecond,
    ).toBe(0);
    expect(laneMetrics({ ...lane, results: [] }).correctPerSecond).toBeNull();
  });

  it("only compares fully complete available live lanes and always shows exact accuracy", () => {
    const state = runningBench();
    const complete: BenchState = {
      ...state,
      status: "complete",
      lanes: state.lanes.map((lane) => ({
        ...lane,
        status: "complete",
        results: [result(), result()],
      })),
    };
    expect(benchComparisons(complete)).toHaveLength(3);
    expect(benchComparisons(complete)[0]).toContain(
      "about the same speed as GPT-4.1 mini",
    );
    expect(benchComparisons(complete)[0]).toContain("exact calls 2/2 vs 2/2");
    expect(
      benchComparisons({
        ...complete,
        config: { ...complete.config, mode: "sample" },
      }),
    ).toEqual([]);
    expect(benchComparisons({ ...complete, status: "cancelled" })).toEqual([]);
    expect(
      benchComparisons({
        ...complete,
        lanes: complete.lanes.map((lane) =>
          lane.provider === "jev" ? lane : { ...lane, available: false },
        ),
      }),
    ).toEqual([]);
    expect(
      benchComparisons({
        ...complete,
        lanes: complete.lanes.map((lane) =>
          lane.provider === "jev" ? lane : { ...lane, results: [result()] },
        ),
      }),
    ).toEqual([]);
  });
});

describe("benchmark lane rendering", () => {
  it("pairs the last completed call with its own prompt after stopping mid-request", () => {
    const lane: BenchLane = {
      ...runningBench().lanes[0],
      status: "cancelled",
      results: [result()],
      currentCase: {
        id: "refund-next",
        prompt: "Refund the unrelated payment.",
        entities: {},
      },
    };
    const html = renderToStaticMarkup(
      createElement(ToolBenchLane, {
        lane,
        config: { mode: "live", caseCount: 2 },
        totalCases: 2,
      }),
    );
    expect(html).toContain("Look up order ORD-10.");
    expect(html).toContain("lookup_order");
    expect(html).not.toContain("Refund the unrelated payment.");
    expect(html).not.toContain("Returned confidence");
    expect(html).not.toContain("Returned usage");
  });

  it("clearly labels the previous result while the next request is active", () => {
    const lane: BenchLane = {
      ...runningBench().lanes[0],
      results: [result()],
      currentCase: {
        id: "refund-next",
        prompt: "Refund the unrelated payment.",
        entities: {},
      },
    };
    const html = renderToStaticMarkup(
      createElement(ToolBenchLane, {
        lane,
        config: { mode: "live", caseCount: 2 },
        totalCases: 2,
      }),
    );
    expect(html).toContain("Current request");
    expect(html).toContain("Refund the unrelated payment.");
    expect(html).toContain("lookup-order");
  });
});
