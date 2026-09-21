import { AbstractAgent } from "@ag-ui/client";
import { EventType, type BaseEvent, type RunAgentInput } from "@ag-ui/core";
import { CopilotKitCoreReact } from "@copilotkit/react-core/v2/context";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Observable, type Subscriber } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_LANES } from "../lib/race/types";
import { initialLaneState, type ArenaLaneState } from "../lib/tool-bench/types";
import { ToolArenaLane } from "./tool-arena-lane";
import {
  createArenaRun,
  interruptLane,
  isArenaComplete,
  isTerminalLane,
  launchArena,
  runWithLaneLifecycle,
  selectLaneState,
  stopArena,
  withAgentIds,
  withRenderCommit,
  type ArenaController,
  type ArenaLane,
} from "./tool-bench-lifecycle";

const definitions = withAgentIds(
  DEFAULT_LANES.map((lane) => ({ ...lane, available: true })),
);

const state = (
  status: ArenaLaneState["status"],
  overrides: Partial<ArenaLane> = {},
): ArenaLane => ({
  ...initialLaneState(definitions[0]),
  agentId: definitions[0].agentId,
  runId: "run-1",
  status,
  ...overrides,
});

function controller(
  definition = definitions[0],
  run: ArenaController["run"] = async () => {},
): ArenaController & { stopped: number } {
  const value = {
    definition,
    run: vi.fn(run),
    stop: vi.fn(() => {
      value.stopped += 1;
    }),
    isRunning: () => true,
    stopped: 0,
  };
  return value;
}

describe("arena run specification", () => {
  it("sends one case to every registered lane agent", () => {
    expect(
      createArenaRun("sample", "order-details", definitions, {
        runId: "run-1",
      }),
    ).toMatchObject({
      runId: "run-1",
      config: { mode: "sample", caseId: "order-details" },
      lanes: definitions.map((lane) => ({
        agentId: `tool_bench_${lane.id}`,
        runId: "run-1",
        caseId: "order-details",
        status: "running",
      })),
    });
  });

  it("marks unconfigured live lanes unavailable and keeps sample lanes running", () => {
    const mixed = withAgentIds([
      { ...DEFAULT_LANES[0], available: true },
      { ...DEFAULT_LANES[1], available: false },
    ]);
    const live = createArenaRun("live", "order-details", mixed);
    expect(live.lanes.map((lane) => lane.status)).toEqual([
      "running",
      "unavailable",
    ]);
    expect(live.lanes[1].error).toContain("OPENROUTER_API_KEY");
    expect(
      createArenaRun("sample", "order-details", mixed).lanes.map(
        (lane) => lane.status,
      ),
    ).toEqual(["running", "running"]);
  });

  it("rejects a run specification without a selected case", () => {
    expect(() => createArenaRun("sample", "", definitions)).toThrow();
  });

  it("carries the selected prompt so lanes render before the first snapshot", () => {
    expect(
      createArenaRun("sample", "order-details", definitions, {
        prompt: "Check ORD-1042.",
      }).lanes[0].prompt,
    ).toBe("Check ORD-1042.");
  });
});

describe("arena completion and interruption", () => {
  it("completes once every lane, including skipped ones, is terminal", () => {
    expect(
      isArenaComplete([
        state("complete"),
        state("error"),
        state("cancelled"),
        state("unavailable"),
      ]),
    ).toBe(true);
    expect(isArenaComplete([state("complete"), state("running")])).toBe(false);
    expect(isArenaComplete([state("idle")])).toBe(false);
    expect(isArenaComplete([])).toBe(false);
  });

  it("interrupts only active lanes and preserves finished work", () => {
    const complete = state("complete", {
      timings: { decisionMs: 20, toolMs: 10, renderMs: 0, totalMs: 30 },
    });
    expect(interruptLane(complete)).toBe(complete);
    expect(interruptLane(state("running"))).toMatchObject({
      status: "cancelled",
      error: null,
    });
    expect(interruptLane(state("running"), "Connection lost.")).toMatchObject({
      status: "error",
      error: "Connection lost.",
    });
    expect(isTerminalLane(state("unavailable"))).toBe(true);
    expect(isTerminalLane(state("running"))).toBe(false);
  });

  it("holds a local stop through late nonterminal or other-run snapshots", () => {
    const running = state("running");
    const stopped = interruptLane(running);
    expect(selectLaneState(running, stopped, state("idle"))).toBe(stopped);
    expect(
      selectLaneState(
        { ...state("complete"), runId: "run-2" },
        stopped,
        state("idle"),
      ),
    ).toBe(stopped);
    const authoritative = state("complete", {
      timings: { decisionMs: 20, toolMs: 10, renderMs: 0, totalMs: 30 },
    });
    expect(selectLaneState(authoritative, stopped, state("idle"))).toBe(
      authoritative,
    );
    expect(selectLaneState({ not: "a lane" }, null, state("idle")).status).toBe(
      "idle",
    );
  });
});

describe("client UI commit measurement", () => {
  const completed = state("complete", {
    execution: { tool: "lookup_order", arguments: {}, result: { kind: "order" } },
    timings: { decisionMs: 200, toolMs: 40, renderMs: 0, totalMs: 240 },
  });

  it("merges the client measurement into timings and the timeline once", () => {
    const merged = withRenderCommit(completed, { runId: "run-1", renderMs: 12 });
    expect(merged.timings).toEqual({
      decisionMs: 200,
      toolMs: 40,
      renderMs: 12,
      totalMs: 252,
    });
    expect(merged.events.at(-1)).toEqual({
      phase: "render",
      status: "finished",
      atMs: 240,
      durationMs: 12,
      message: null,
    });
    expect(withRenderCommit(merged, { runId: "run-1", renderMs: 99 })).toBe(
      merged,
    );
  });

  it("never lets a later snapshot or another run erase the measurement", () => {
    expect(withRenderCommit(completed, null)).toBe(completed);
    expect(withRenderCommit(completed, { runId: "run-2", renderMs: 12 })).toBe(
      completed,
    );
    expect(
      withRenderCommit(state("error"), { runId: "run-1", renderMs: 12 }),
    ).toMatchObject({ timings: { renderMs: 0 } });
  });
});

describe("synchronized arena launch", () => {
  it("keeps every other lane running when one lane rejects", async () => {
    const failing = controller(definitions[0], async () => {
      throw new Error("Lane transport failed.");
    });
    const healthy = definitions
      .slice(1)
      .map((definition) => controller(definition));
    const results = await launchArena([failing, ...healthy], {
      config: { mode: "sample", caseId: "order-details" },
      runId: "run-1",
    });
    expect(results.map((entry) => entry.status)).toEqual([
      "rejected",
      "fulfilled",
      "fulfilled",
      "fulfilled",
    ]);
    for (const lane of healthy) expect(lane.run).toHaveBeenCalledTimes(1);
  });

  it("skips unconfigured lanes in live mode but runs them all in sample mode", async () => {
    const available = controller({ ...definitions[0], available: true });
    const missing = controller({ ...definitions[1], available: false });
    await launchArena([available, missing], {
      config: { mode: "live", caseId: "order-details" },
      runId: "run-1",
    });
    expect(available.run).toHaveBeenCalledTimes(1);
    expect(missing.run).not.toHaveBeenCalled();
    await launchArena([available, missing], {
      config: { mode: "sample", caseId: "order-details" },
      runId: "run-2",
    });
    expect(missing.run).toHaveBeenCalledTimes(1);
  });

  it("stops every running agent and leaves finished lanes alone", () => {
    const running = controller();
    const finished = { ...controller(definitions[1]), isRunning: () => false };
    stopArena([running, finished]);
    expect(running.stop).toHaveBeenCalledTimes(1);
    expect(finished.stop).not.toHaveBeenCalled();
  });
});

type Script = (input: RunAgentInput, subscriber: Subscriber<BaseEvent>) => void;
class ScriptedLaneAgent extends AbstractAgent {
  constructor(private readonly script: Script) {
    super({ agentId: "tool_bench_jev" });
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
  const agent = new ScriptedLaneAgent(script);
  const initial = state("running");
  agent.setState(initial);
  const copilotkit = new CopilotKitCoreReact({
    agents__unsafe_dev_only: { tool_bench_jev: agent },
  });
  const observed: {
    errors: string[];
    fallback: ArenaLaneState | null;
    resolved: boolean;
  } = { errors: [], fallback: null, resolved: false };
  await runWithLaneLifecycle({
    agent,
    initialState: initial,
    isCancelled: () => cancelled,
    onError: (message) => {
      observed.errors.push(message);
    },
    onFallback: (fallback) => {
      observed.fallback = fallback;
    },
    run: async () => {
      await copilotkit.runAgent({ agent, runId: initial.runId });
      observed.resolved = true;
    },
  });
  return { ...observed, agent, initial };
}

describe("lane lifecycle with the installed CopilotKit SDK", () => {
  it("makes the lane terminal when RUN_ERROR resolves instead of rejecting", async () => {
    const observed = await runScript((_input, subscriber) => {
      subscriber.next({
        type: EventType.RUN_ERROR,
        message: "Provider disconnected.",
      });
      subscriber.complete();
    });
    expect(observed.resolved).toBe(true);
    expect(observed.errors).toContain("Provider disconnected.");
    expect(observed.fallback).toMatchObject({
      status: "error",
      error: "Provider disconnected.",
    });
  });

  it("handles a transport failure swallowed by the SDK", async () => {
    const observed = await runScript((_input, subscriber) =>
      subscriber.error(new Error("Connection lost.")),
    );
    expect(observed.errors).toContain("Connection lost.");
    expect(observed.fallback && isTerminalLane(observed.fallback)).toBe(true);
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
    expect((await runScript(end)).errors[0]).toContain(
      "before a final result arrived",
    );
    const stopped = await runScript(end, true);
    expect(stopped.errors).toEqual([]);
    expect(stopped.fallback).toMatchObject({ status: "cancelled" });
  });

  it("prefers an authoritative same-run terminal snapshot over the local stop", async () => {
    const observed = await runScript((input, subscriber) => {
      subscriber.next({
        type: EventType.STATE_SNAPSHOT,
        snapshot: {
          ...state("cancelled"),
          runId: input.runId,
          timings: { decisionMs: 210, toolMs: 40, renderMs: 0, totalMs: 250 },
        },
      });
      subscriber.next({
        type: EventType.RUN_FINISHED,
        runId: input.runId,
        threadId: input.threadId,
      });
      subscriber.complete();
    }, true);
    expect(observed.errors).toEqual([]);
    expect(
      selectLaneState(
        observed.agent.state,
        interruptLane(observed.initial),
        state("idle"),
      ),
    ).toMatchObject({
      status: "cancelled",
      timings: { decisionMs: 210, toolMs: 40, totalMs: 250 },
    });
  });
});

const completedJev = (overrides: Partial<ArenaLane> = {}): ArenaLane => ({
  ...state("complete"),
  caseId: "order-details",
  prompt: "I need the item list and total for order ORD-1042.",
  expected: { tool: "lookup_order", arguments: { order_id: "ORD-1042" } },
  decision: {
    tool: "lookup_order",
    arguments: { order_id: "ORD-1042" },
    modelMs: 350,
    inputTokens: 412,
    outputTokens: 18,
    confidence: 0.94,
    choices: [
      { tool: "lookup_order", probability: 0.94 },
      { tool: "track_shipment", probability: 0.04 },
    ],
  },
  execution: {
    tool: "lookup_order",
    arguments: { order_id: "ORD-1042" },
    result: {
      kind: "order",
      orderId: "ORD-1042",
      status: "Delivered",
      items: 2,
      total: "$84.00",
    },
  },
  score: { toolCorrect: true, argumentsCorrect: true, correct: true },
  timings: { decisionMs: 350, toolMs: 180, renderMs: 4, totalMs: 534 },
  events: [
    { phase: "decision", status: "started", atMs: 0, durationMs: null, message: null },
    { phase: "decision", status: "finished", atMs: 350, durationMs: 350, message: null },
    { phase: "tool", status: "started", atMs: 350, durationMs: null, message: null },
    { phase: "tool", status: "finished", atMs: 530, durationMs: 180, message: null },
  ],
  ...overrides,
});

const markup = (lane: ArenaLane, sample = false) =>
  renderToStaticMarkup(createElement(ToolArenaLane, { lane, sample }));

describe("agent conversation lane", () => {
  it("shows the shared request, the call, the prepared result and both timers", () => {
    const html = markup(completedJev());
    expect(html).toContain("I need the item list and total for order ORD-1042.");
    expect(html).toContain("lookup_order");
    expect(html).toContain("ORD-1042");
    expect(html).toContain("Delivered");
    expect(html).toContain("$84.00");
    expect(html).toContain("Exact match");
    expect(html).toContain("350 ms");
    expect(html).toContain("180 ms");
    expect(html).toContain("Jev");
  });

  it("discloses ranked Jev choices and keeps both correctness checks visible", () => {
    const html = markup(completedJev());
    expect(html).toContain("track_shipment");
    expect(html).toContain("94.0%");
    expect(html).toContain("Tool ✓");
    expect(html).toContain("arguments ✓");
  });

  it("omits ranked choices for a lane whose provider returns none", () => {
    const lane = completedJev({
      ...DEFAULT_LANES[1],
      agentId: "tool_bench_gpt",
    });
    const html = markup({
      ...lane,
      decision: { ...lane.decision!, confidence: null, choices: [] },
    });
    expect(html).not.toContain("Ranked tool choices");
    expect(html).toContain("lookup_order");
  });

  it("marks an incorrect but executed call without claiming a match", () => {
    const html = markup(
      completedJev({
        decision: {
          ...completedJev().decision!,
          tool: "track_shipment",
          arguments: { order_id: "ORD-1089" },
          choices: [],
          confidence: null,
        },
        execution: {
          tool: "track_shipment",
          arguments: { order_id: "ORD-1089" },
          result: {
            kind: "shipment",
            orderId: "ORD-1089",
            carrier: "Northwind Freight",
            status: "Out for delivery",
            eta: "Today, 6:00 PM",
          },
        },
        score: { toolCorrect: false, argumentsCorrect: false, correct: false },
      }),
    );
    expect(html).toContain("Tool mismatch");
    expect(html).not.toContain("Exact match");
    expect(html).toContain("Northwind Freight");
  });

  it("never renders a fabricated result for a failed lane", () => {
    const html = markup(
      completedJev({
        status: "error",
        execution: null,
        error: "Invalid arguments for lookup_order.",
        events: [
          { phase: "decision", status: "started", atMs: 0, durationMs: null, message: null },
          { phase: "tool", status: "error", atMs: 350, durationMs: 0, message: "Invalid arguments for lookup_order." },
        ],
      }),
    );
    expect(html).toContain("Invalid arguments for lookup_order.");
    expect(html).not.toContain("Delivered");
    expect(html).not.toContain("$84.00");
    expect(html).toContain("Lane failed");
  });

  it("labels sample decisions synthetic and names the missing key when unavailable", () => {
    expect(markup(completedJev(), true)).toContain("Synthetic");
    const html = markup({
      ...state("unavailable"),
      error: "Configure TYPESAFE_API_KEY to enable live Jev.",
    });
    expect(html).toContain("TYPESAFE_API_KEY");
    expect(html).not.toContain("Exact match");
  });
});
