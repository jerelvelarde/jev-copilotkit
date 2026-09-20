import { describe, expect, it } from "vitest";
import { lastValueFrom, toArray, tap } from "rxjs";
import { EventType, type RunAgentInput } from "@ag-ui/core";
import { InMemoryAgentRunner } from "@copilotkit/runtime/v2";
import { ToolBenchAgent } from "./agent";
const input: RunAgentInput = {
  threadId: "bench-thread",
  runId: "bench-run",
  state: {},
  messages: [],
  tools: [],
  context: [],
  forwardedProps: { config: { mode: "sample", caseCount: 1 } },
};
const collect = (agent = new ToolBenchAgent(), run = input) =>
  lastValueFrom(agent.run(run).pipe(toArray()));
describe("tool benchmark AG-UI lifecycle", () => {
  it("uses caller run identity in every snapshot and ordered lifecycle", async () => {
    const events = await collect();
    expect(events[0].type).toBe(EventType.RUN_STARTED);
    expect(events.at(-1)?.type).toBe(EventType.RUN_FINISHED);
    const snapshots = events.filter((e) => e.type === EventType.STATE_SNAPSHOT);
    for (const event of snapshots)
      expect(event.snapshot).toMatchObject({ runId: input.runId });
    expect(snapshots.at(-1)?.snapshot).toMatchObject({
      status: "complete",
      totalCases: 1,
    });
  });
  it("reports invalid config", async () => {
    const events = await collect(new ToolBenchAgent(), {
      ...input,
      forwardedProps: { config: { mode: "sample", caseCount: 13 } },
    });
    expect(events.map((e) => e.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.RUN_ERROR,
    ]);
  });
  it("honors stop before subscription and resets for reuse; clones are independent", async () => {
    const agent = new ToolBenchAgent();
    agent.abortRun();
    const stopped = await collect(agent);
    expect(
      stopped.filter((e) => e.type === EventType.STATE_SNAPSHOT).at(-1)
        ?.snapshot,
    ).toMatchObject({ status: "cancelled" });
    const again = await collect(agent);
    expect(
      again.filter((e) => e.type === EventType.STATE_SNAPSHOT).at(-1)?.snapshot,
    ).toMatchObject({ status: "complete" });
    expect(agent.clone()).toBeInstanceOf(ToolBenchAgent);
    expect(agent.clone()).not.toBe(agent);
  });
  it("stops through the installed CopilotKit runner", async () => {
    const runner = new InMemoryAgentRunner();
    const agent = new ToolBenchAgent();
    let stopping = false;
    const run = {
      ...input,
      threadId: crypto.randomUUID(),
      runId: crypto.randomUUID(),
    };
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
    expect(
      events.filter((e) => e.type === EventType.STATE_SNAPSHOT).at(-1)
        ?.snapshot,
    ).toMatchObject({ status: "cancelled", runId: run.runId });
    expect(agent.isRunning).toBe(false);
  });
});
