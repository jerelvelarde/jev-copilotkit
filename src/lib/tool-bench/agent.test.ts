import { describe, expect, it } from "vitest";
import { lastValueFrom, toArray } from "rxjs";
import { EventType, type RunAgentInput } from "@ag-ui/core";
import { DEFAULT_LANES } from "../race/types";
import { BENCH_CASES } from "./cases";
import { ToolArenaAgent } from "./agent";
import type { ArenaLaneState } from "./types";

const lane = { ...DEFAULT_LANES[0], available: true };
const runId = "8a1f0f1a-0d2d-4a1f-9c4a-6b8f0f2f1c11";
const input: RunAgentInput = {
  threadId: "arena-thread",
  runId,
  state: {},
  messages: [],
  tools: [],
  context: [],
  forwardedProps: {
    config: { mode: "live", caseId: BENCH_CASES[0].id },
    runId,
  },
};
const agent = () =>
  new ToolArenaAgent(lane, {
    provider: async () => ({
      ...BENCH_CASES[0].expected,
      modelMs: 1,
      inputTokens: 2,
      outputTokens: 3,
      confidence: null,
      choices: [],
    }),
    execute: async (call) => ({
      ...call,
      result: {
        kind: "article",
        title: "Earth",
        extract: "Live data",
        linkCount: 4,
        url: "https://en.wikipedia.org/wiki/Earth",
      },
    }),
  });
const collect = (instance = agent(), run = input) =>
  lastValueFrom(instance.run(run).pipe(toArray()));
const snapshots = (events: { type: EventType; snapshot?: unknown }[]) =>
  events
    .filter((event) => event.type === EventType.STATE_SNAPSHOT)
    .map((event) => event.snapshot as ArenaLaneState);

describe("tool arena AG-UI lifecycle", () => {
  it("streams a decision and executed result to completion", async () => {
    const events = await collect();
    expect(events[0].type).toBe(EventType.RUN_STARTED);
    expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED);
    expect(snapshots(events).map((state) => state.events.length)).toEqual([
      0, 1, 2, 3, 4,
    ]);
    expect(snapshots(events).at(-1)).toMatchObject({
      status: "complete",
      score: { correct: true },
      execution: { result: { kind: "article" } },
    });
  });
  it("rejects an invalid run specification", async () => {
    const events = await collect(agent(), {
      ...input,
      forwardedProps: {
        config: { mode: "sample", caseId: BENCH_CASES[0].id },
        runId,
      },
    });
    expect(events.map((event) => event.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.RUN_ERROR,
    ]);
  });
  it("marks a missing provider key unavailable", async () => {
    const unavailable = new ToolArenaAgent({ ...lane, available: false });
    expect(snapshots(await collect(unavailable)).at(-1)?.status).toBe(
      "unavailable",
    );
  });
  it("preserves injected dependencies when cloned", async () => {
    const original = agent();
    expect(original.clone()).not.toBe(original);
    expect(snapshots(await collect(original.clone())).at(-1)?.status).toBe(
      "complete",
    );
  });
});
