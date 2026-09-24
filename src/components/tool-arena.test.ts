import { AbstractAgent } from "@ag-ui/client";
import { EventType, type BaseEvent, type RunAgentInput } from "@ag-ui/core";
import { CopilotKitCoreReact } from "@copilotkit/react-core/v2/context";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Observable, type Subscriber } from "rxjs";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_LANES } from "../lib/race/types";
import { initialLaneState, type ArenaLaneState } from "../lib/tool-bench/types";
import { ToolArenaGraph } from "./tool-arena-graph";
import { ToolArenaLane } from "./tool-arena-lane";
import { summarizeArena, ToolArenaSummary } from "./tool-arena-summary";
import {
  arenaClockMs,
  buildTrace,
  createArenaTicker,
} from "./tool-bench-metrics";
import {
  createArenaRun,
  idleArenaLane,
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
      createArenaRun("live", "earth-article", definitions, {
        runId: "run-1",
      }),
    ).toMatchObject({
      runId: "run-1",
      config: { mode: "live", caseId: "earth-article" },
      lanes: definitions.map((lane) => ({
        agentId: `tool_bench_${lane.id}`,
        runId: "run-1",
        caseId: "earth-article",
        status: "running",
      })),
    });
  });

  it("marks unconfigured lanes unavailable", () => {
    const mixed = withAgentIds([
      { ...DEFAULT_LANES[0], available: true },
      { ...DEFAULT_LANES[1], available: false },
    ]);
    const live = createArenaRun("live", "earth-article", mixed);
    expect(live.lanes.map((lane) => lane.status)).toEqual([
      "running",
      "unavailable",
    ]);
    expect(live.lanes[1].error).toContain("OPENAI_API_KEY");
  });

  it("rejects a run specification without a selected case", () => {
    expect(() => createArenaRun("live", "", definitions)).toThrow();
  });

  it("explains the missing key before the race", () => {
    const unconfigured = withAgentIds([
      { ...DEFAULT_LANES[0], available: false },
    ])[0];
    const live = idleArenaLane(unconfigured);
    expect(live.status).toBe("unavailable");
    expect(live.error).toBeTruthy();
  });

  it("carries the selected prompt so lanes render before the first snapshot", () => {
    expect(
      createArenaRun("live", "earth-article", definitions, {
        prompt: "Check Earth.",
      }).lanes[0].prompt,
    ).toBe("Check Earth.");
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
    execution: {
      tool: "get_wikipedia_article",
      arguments: {},
      result: { kind: "order" },
    },
    timings: { decisionMs: 200, toolMs: 40, renderMs: 0, totalMs: 240 },
  });

  it("merges the client measurement into timings and the timeline once", () => {
    const merged = withRenderCommit(completed, {
      runId: "run-1",
      renderMs: 12,
    });
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
      config: { mode: "live", caseId: "earth-article" },
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

  it("skips unconfigured lanes", async () => {
    const available = controller({ ...definitions[0], available: true });
    const missing = controller({ ...definitions[1], available: false });
    await launchArena([available, missing], {
      config: { mode: "live", caseId: "earth-article" },
      runId: "run-1",
    });
    expect(available.run).toHaveBeenCalledTimes(1);
    expect(missing.run).not.toHaveBeenCalled();
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
  caseId: "earth-article",
  prompt: "Get the current Wikipedia introduction for Earth.",
  expected: { tool: "get_wikipedia_article", arguments: { title: "Earth" } },
  decision: {
    tool: "get_wikipedia_article",
    arguments: { title: "Earth" },
    modelMs: 350,
    inputTokens: 412,
    outputTokens: 18,
    confidence: 0.94,
    choices: [
      { tool: "get_wikipedia_article", probability: 0.94 },
      { tool: "get_github_repository", probability: 0.04 },
    ],
  },
  execution: {
    tool: "get_wikipedia_article",
    arguments: { title: "Earth" },
    result: {
      kind: "article",
      title: "Earth",
      extract: "Planet Earth introduction",
      linkCount: 42,
      url: "https://en.wikipedia.org/wiki/Earth",
    },
  },
  score: { toolCorrect: true, argumentsCorrect: true, correct: true },
  timings: { decisionMs: 350, toolMs: 180, renderMs: 4, totalMs: 534 },
  events: [
    {
      phase: "decision",
      status: "started",
      atMs: 0,
      durationMs: null,
      message: null,
    },
    {
      phase: "decision",
      status: "finished",
      atMs: 350,
      durationMs: 350,
      message: null,
    },
    {
      phase: "tool",
      status: "started",
      atMs: 350,
      durationMs: null,
      message: null,
    },
    {
      phase: "tool",
      status: "finished",
      atMs: 530,
      durationMs: 180,
      message: null,
    },
  ],
  ...overrides,
});

const markup = (lane: ArenaLane) =>
  renderToStaticMarkup(createElement(ToolArenaLane, { lane }));

describe("agent conversation lane", () => {
  it("shows the shared request, tool call, A2UI surface, and both timers", () => {
    const html = markup(completedJev());
    expect(html).toContain("tb-lane-complete");
    expect(html).toContain("Complete");
    expect(html).toContain("Get the current Wikipedia introduction for Earth.");
    expect(html).toContain("get_wikipedia_article");
    expect(html).toContain("Earth");
    expect(html).toContain("A2UI result");
    expect(html).toContain("Rendering A2UI surface");
    expect(html).toContain("Exact match");
    expect(html).toContain("350 ms");
    expect(html).toContain("180 ms");
    expect(html).toContain("Jev");
  });

  it("discloses ranked Jev choices and keeps both correctness checks visible", () => {
    const html = markup(completedJev());
    expect(html).toContain("get_github_repository");
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
    expect(html).toContain("get_wikipedia_article");
  });

  it("marks an incorrect but executed call without claiming a match", () => {
    const html = markup(
      completedJev({
        decision: {
          ...completedJev().decision!,
          tool: "get_github_repository",
          arguments: { title: "cli/cli" },
          choices: [],
          confidence: null,
        },
        execution: {
          tool: "get_github_repository",
          arguments: { title: "cli/cli" },
          result: {
            kind: "repository",
            name: "cli/cli",
            description: "GitHub CLI",
            stars: 123,
            language: "Go",
            url: "https://github.com/cli/cli",
          },
        },
        score: { toolCorrect: false, argumentsCorrect: false, correct: false },
      }),
    );
    expect(html).toContain("Tool mismatch");
    expect(html).not.toContain("Exact match");
    expect(html).toContain("A2UI result");
  });

  it("never renders a fabricated result for a failed lane", () => {
    const html = markup(
      completedJev({
        status: "error",
        execution: null,
        error: "Invalid arguments for get_wikipedia_article.",
        events: [
          {
            phase: "decision",
            status: "started",
            atMs: 0,
            durationMs: null,
            message: null,
          },
          {
            phase: "tool",
            status: "error",
            atMs: 350,
            durationMs: 0,
            message: "Invalid arguments for get_wikipedia_article.",
          },
        ],
      }),
    );
    expect(html).toContain("Invalid arguments for get_wikipedia_article.");
    expect(html).not.toContain("Planet Earth introduction");
    expect(html).not.toContain("42");
    expect(html).toContain("Lane failed");
  });

  it("names the missing key when unavailable", () => {
    const html = markup({
      ...state("unavailable"),
      error: "Configure TYPESAFE_API_KEY to enable live Jev.",
    });
    expect(html).toContain("TYPESAFE_API_KEY");
    expect(html).not.toContain("Exact match");
  });
});

describe("execution trace geometry", () => {
  const events = completedJev().events;

  it("places ordered nodes as clamped percentages of the shared scale", () => {
    expect(buildTrace(events, 1000)).toEqual([
      { ...events[0], left: 0, width: 0 },
      { ...events[1], left: 35, width: 35 },
      { ...events[2], left: 35, width: 0 },
      { ...events[3], left: 53, width: 18 },
    ]);
  });

  it("keeps zero-duration, oversized and cancelled lanes renderable", () => {
    expect(buildTrace(events, 0)[1]).toMatchObject({ left: 100, width: 100 });
    expect(
      buildTrace(
        [
          {
            phase: "tool",
            status: "cancelled",
            atMs: 40,
            durationMs: 0,
            message: "Stopped by you.",
          },
        ],
        100,
      ),
    ).toEqual([
      {
        phase: "tool",
        status: "cancelled",
        atMs: 40,
        durationMs: 0,
        message: "Stopped by you.",
        left: 40,
        width: 1,
      },
    ]);
    expect(buildTrace([], 100)).toEqual([]);
  });
});

describe("global race clock", () => {
  it("counts up while racing and freezes at the recorded finish", () => {
    expect(arenaClockMs(null, null, 500)).toBe(0);
    expect(arenaClockMs(100, null, 900)).toBe(800);
    expect(arenaClockMs(100, 700, 5_000)).toBe(600);
    expect(arenaClockMs(100, null, null)).toBe(0);
    expect(arenaClockMs(900, null, 100)).toBe(0);
  });

  it("ticks on an interval and stops when the race is over", () => {
    vi.useFakeTimers();
    let ticks = 0;
    const stop = createArenaTicker(() => {
      ticks += 1;
    }, 50);
    vi.advanceTimersByTime(200);
    expect(ticks).toBe(4);
    stop();
    vi.advanceTimersByTime(500);
    expect(ticks).toBe(4);
    vi.useRealTimers();
  });
});

describe("execution graph rendering", () => {
  it("labels every agent row and keeps phase, status and duration readable", () => {
    const html = renderToStaticMarkup(
      createElement(ToolArenaGraph, {
        lanes: [
          completedJev(),
          {
            ...state("cancelled", {
              ...DEFAULT_LANES[1],
              agentId: "tool_bench_gpt",
            }),
            error: "Stopped by you.",
            events: [
              {
                phase: "decision",
                status: "started",
                atMs: 0,
                durationMs: null,
                message: null,
              },
              {
                phase: "decision",
                status: "cancelled",
                atMs: 120,
                durationMs: 120,
                message: "Stopped by you.",
              },
            ],
          },
        ],
      }),
    );
    expect(html).toContain("Jev");
    expect(html).toContain("GPT-5.6 Luna");
    expect(html).toContain("Prompt");
    expect(html).toContain("Decision");
    expect(html).toContain("Tool");
    expect(html).toContain("350 ms");
    expect(html).toContain("Stopped by you.");
    expect(html).toContain("cancelled");
  });
});

describe("arena summary", () => {
  const lane = (
    id: string,
    correct: boolean,
    totalMs: number,
    overrides: Partial<ArenaLane> = {},
  ): ArenaLane => ({
    ...completedJev(),
    id,
    name: id,
    score: {
      toolCorrect: correct,
      argumentsCorrect: correct,
      correct,
    },
    timings: { decisionMs: totalMs - 30, toolMs: 30, renderMs: 0, totalMs },
    ...overrides,
  });

  it("never gives a faster incorrect lane the fastest-exact label", () => {
    const summary = summarizeArena([
      lane("jev", true, 400),
      lane("gpt", false, 120),
      lane("haiku", true, 900),
      lane("sonnet", false, 100, { status: "error", execution: null }),
    ]);
    expect(summary).toEqual({
      highestAccuracy: ["jev", "haiku"],
      fastestExact: ["jev"],
      fastestDecision: ["jev"],
      completed: 3,
      available: 4,
    });
  });

  it("lists every tied lane and excludes lanes that never completed", () => {
    expect(
      summarizeArena([
        lane("jev", true, 400),
        lane("gpt", true, 400),
        lane("haiku", true, 200, { status: "cancelled", execution: null }),
        lane("sonnet", false, 100, { status: "unavailable" }),
      ]),
    ).toEqual({
      highestAccuracy: ["jev", "gpt"],
      fastestExact: ["jev", "gpt"],
      fastestDecision: ["jev", "gpt"],
      completed: 2,
      available: 3,
    });
  });

  it("separates decision speed from tool and total latency", () => {
    expect(
      summarizeArena([
        lane("jev", true, 900, {
          timings: { decisionMs: 100, toolMs: 800, renderMs: 0, totalMs: 900 },
        }),
        lane("gpt", true, 400, {
          timings: { decisionMs: 350, toolMs: 50, renderMs: 0, totalMs: 400 },
        }),
      ]),
    ).toMatchObject({
      fastestDecision: ["jev"],
      fastestExact: ["gpt"],
    });
  });

  it("reports nothing before any lane finishes", () => {
    expect(
      summarizeArena([
        lane("jev", false, 0, { status: "running", score: null }),
      ]),
    ).toEqual({
      highestAccuracy: [],
      fastestExact: [],
      fastestDecision: [],
      completed: 0,
      available: 1,
    });
    expect(summarizeArena([])).toEqual({
      highestAccuracy: [],
      fastestExact: [],
      fastestDecision: [],
      completed: 0,
      available: 0,
    });
  });

  it("renders both outcomes with their measured values and the methodology warning", () => {
    const html = renderToStaticMarkup(
      createElement(ToolArenaSummary, {
        lanes: [lane("jev", true, 400), lane("gpt", false, 120)],
        complete: true,
      }),
    );
    expect(html).toContain("jev");
    expect(html).toContain("400 ms");
    expect(html).toContain("Highest accuracy");
    expect(html).toContain("Fastest exact call");
    expect(html).toContain("Fastest tool decision");
    expect(html).toContain("do not establish general model performance");
  });

  it("withholds the winner until every lane has settled", () => {
    const lanes = [
      lane("jev", true, 400),
      lane("gpt", false, 120, { status: "running", score: null }),
    ];
    const inProgress = renderToStaticMarkup(
      createElement(ToolArenaSummary, { lanes, complete: false }),
    );
    expect(inProgress).toContain("Winner revealed when all agents finish");
    expect(inProgress).not.toContain("Winner: jev");

    const finished = renderToStaticMarkup(
      createElement(ToolArenaSummary, {
        lanes: [lanes[0], { ...lanes[1], status: "complete" }],
        complete: true,
      }),
    );
    expect(finished).toContain("Winner: jev");
  });
});
