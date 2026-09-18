import { describe, expect, it } from "vitest";
import { lastValueFrom, toArray, tap } from "rxjs";
import { EventType, type RunAgentInput } from "@ag-ui/core";
import { WikiRaceAgent } from "./agent";
import { DEFAULT_CONFIG } from "./types";
import { z } from "zod";
import { InMemoryAgentRunner } from "@copilotkit/runtime/v2";

const input: RunAgentInput = {
  threadId: "test-thread",
  runId: "test-run",
  state: {},
  messages: [],
  tools: [],
  context: [],
  forwardedProps: { config: DEFAULT_CONFIG },
};
describe("CopilotKit race agent", () => {
  it("streams a whole sample race with ordered AG-UI lifecycle and shared state", async () => {
    const events = await lastValueFrom(
      new WikiRaceAgent().run(input).pipe(toArray()),
    );
    expect(events[0].type).toBe(EventType.RUN_STARTED);
    expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED);
    const snapshots = events.filter(
      (event) => event.type === EventType.STATE_SNAPSHOT,
    );
    expect(snapshots.length).toBeGreaterThan(6);
    for (const event of snapshots)
      expect(event.snapshot).toMatchObject({ runId: input.runId });
    const last = snapshots.at(-1)!;
    const state = z
      .object({
        status: z.string(),
        config: z.object({ mode: z.string() }),
        lanes: z.array(
          z.object({ status: z.string(), path: z.array(z.string()) }),
        ),
      })
      .parse(last.snapshot);
    expect(state.status).toBe("complete");
    expect(state.config.mode).toBe("sample");
    expect(state.lanes.every((l) => l.status === "finished")).toBe(true);
    expect(state.lanes[0].path).toEqual([
      "Baseball",
      "United States",
      "Earth",
      "Sun",
    ]);
  }, 10_000);
  it("reports invalid input as a run error", async () => {
    const events = await lastValueFrom(
      new WikiRaceAgent()
        .run({
          ...input,
          forwardedProps: { config: { ...DEFAULT_CONFIG, maxHops: 100 } },
        })
        .pipe(toArray()),
    );
    expect(events.map((e) => e.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.RUN_ERROR,
    ]);
  });
  it("stops through the actual CopilotKit runner while the agent is active", async () => {
    const runner = new InMemoryAgentRunner();
    const agent = new WikiRaceAgent();
    const threadId = crypto.randomUUID();
    const run = { ...input, threadId, runId: crypto.randomUUID() };
    let stopRequested = false;
    const events = await lastValueFrom(
      runner.run({ threadId, agent, input: run }).pipe(
        tap((event) => {
          if (event.type === EventType.STATE_SNAPSHOT && !stopRequested) {
            stopRequested = true;
            void runner.stop({ threadId, runId: run.runId });
          }
        }),
        toArray(),
      ),
    );
    expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED);
    expect(agent.isRunning).toBe(false);
    expect(
      events.filter((e) => e.type === EventType.STATE_SNAPSHOT).at(-1)
        ?.snapshot,
    ).toMatchObject({ status: "cancelled", runId: run.runId });
  }, 3000);
  it("remembers Stop before the run observable starts", async () => {
    const agent = new WikiRaceAgent();
    agent.abortRun();
    const events = await lastValueFrom(agent.run(input).pipe(toArray()));
    expect(
      events.filter((e) => e.type === EventType.STATE_SNAPSHOT).at(-1)
        ?.snapshot,
    ).toMatchObject({ status: "cancelled", runId: input.runId });
  });
});
