import { describe, expect, it } from "vitest";
import { lastValueFrom, toArray, tap } from "rxjs";
import { EventType, type RunAgentInput } from "@ag-ui/core";
import { InMemoryAgentRunner } from "@copilotkit/runtime/v2";
import { DEFAULT_LANES, type LaneDefinition } from "../race/types";
import { BENCH_CASES } from "./cases";
import { ToolArenaAgent } from "./agent";
import type { ArenaLaneState } from "./types";

const lane: LaneDefinition = { ...DEFAULT_LANES[0], available: false };
const runId = "8a1f0f1a-0d2d-4a1f-9c4a-6b8f0f2f1c11";
const input: RunAgentInput = {
  threadId: "arena-thread",
  runId,
  state: {},
  messages: [],
  tools: [],
  context: [],
  forwardedProps: {
    config: { mode: "sample", caseId: BENCH_CASES[0].id },
    runId,
  },
};
const collect = (agent = new ToolArenaAgent(lane), run = input) =>
  lastValueFrom(agent.run(run).pipe(toArray()));
const snapshots = (events: { type: EventType; snapshot?: unknown }[]) =>
  events
    .filter((event) => event.type === EventType.STATE_SNAPSHOT)
    .map((event) => event.snapshot as ArenaLaneState);

describe("tool arena lane AG-UI lifecycle", () => {
  it("identifies one lane agent per provider definition", () => {
    expect(new ToolArenaAgent(lane).agentId).toBe("tool_bench_jev");
    expect(
      DEFAULT_LANES.map((item) => new ToolArenaAgent(item).agentId),
    ).toEqual([
      "tool_bench_jev",
      "tool_bench_gpt",
      "tool_bench_haiku",
      "tool_bench_sonnet",
    ]);
    const agent = new ToolArenaAgent(lane);
    expect(agent.clone()).toBeInstanceOf(ToolArenaAgent);
    expect(agent.clone()).not.toBe(agent);
    expect(agent.clone().agentId).toBe(agent.agentId);
  });

  it("streams progressive snapshots between RUN_STARTED and RUN_FINISHED", async () => {
    const events = await collect();
    expect(events[0].type).toBe(EventType.RUN_STARTED);
    expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED);
    const states = snapshots(events);
    expect(states.length).toBeGreaterThan(1);
    for (const state of states) expect(state.runId).toBe(runId);
    expect(states.map((state) => state.events.length)).toEqual([0, 1, 2, 3, 4]);
    expect(states.at(-1)).toMatchObject({
      status: "complete",
      caseId: BENCH_CASES[0].id,
      score: { correct: true },
    });
    expect(states.at(-1)?.execution?.result).toMatchObject({ kind: "order" });
  });

  it("reports invalid forwarded properties as a run error", async () => {
    const events = await collect(new ToolArenaAgent(lane), {
      ...input,
      forwardedProps: { config: { mode: "sample" }, runId },
    });
    expect(events.map((event) => event.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.RUN_ERROR,
    ]);
  });

  it("ends a live lane without keys as unavailable, not as a run error", async () => {
    const events = await collect(new ToolArenaAgent(lane), {
      ...input,
      forwardedProps: {
        config: { mode: "live", caseId: BENCH_CASES[0].id },
        runId,
      },
    });
    expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED);
    expect(snapshots(events).at(-1)).toMatchObject({ status: "unavailable" });
  });

  it("honors a stop before subscription and resets for reuse", async () => {
    const agent = new ToolArenaAgent(lane);
    agent.abortRun();
    expect(snapshots(await collect(agent)).at(-1)).toMatchObject({
      status: "cancelled",
    });
    expect(snapshots(await collect(agent)).at(-1)).toMatchObject({
      status: "complete",
    });
  });

  it("stops through the installed CopilotKit runner", async () => {
    const runner = new InMemoryAgentRunner();
    const agent = new ToolArenaAgent(lane);
    const run = { ...input, threadId: crypto.randomUUID() };
    let stopping = false;
    const events = await lastValueFrom(
      runner.run({ threadId: run.threadId, agent, input: run }).pipe(
        tap((event) => {
          if (event.type === EventType.STATE_SNAPSHOT && !stopping) {
            stopping = true;
            void runner.stop({ threadId: run.threadId, runId: run.runId });
          }
        }),
        toArray(),
      ),
    );
    expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED);
    expect(snapshots(events).at(-1)).toMatchObject({
      status: "cancelled",
      runId,
    });
    expect(agent.isRunning).toBe(false);
  });
});
