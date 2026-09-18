import { AbstractAgent } from "@ag-ui/client";
import { EventType, type BaseEvent, type RunAgentInput } from "@ag-ui/core";
import { CopilotKitCoreReact } from "@copilotkit/react-core/v2/context";
import { Observable, type Subscriber } from "rxjs";
import { describe, expect, it } from "vitest";
import { initialRace, type RaceState } from "../lib/race/types";
import {
  interruptRace,
  isTerminalRace,
  runWithRaceLifecycle,
  selectRaceState,
} from "./race-lifecycle";

type Script = (input: RunAgentInput, subscriber: Subscriber<BaseEvent>) => void;

class ScriptedAgent extends AbstractAgent {
  constructor(private readonly script: Script) {
    super({ agentId: "wiki_race" });
  }
  run(input: RunAgentInput) {
    return new Observable<BaseEvent>((subscriber) => {
      subscriber.next({
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      });
      this.script(input, subscriber);
    });
  }
}

function runningRace(): RaceState {
  const state = initialRace();
  return {
    ...state,
    runId: crypto.randomUUID(),
    status: "running",
    lanes: state.lanes.map((lane) => ({
      ...lane,
      status: "thinking",
      startedAt: 100,
      elapsedMs: 100,
      modelMs: 60,
    })),
  };
}

async function runSdkScript(script: Script, cancelled = false) {
  const agent = new ScriptedAgent(script);
  const state = runningRace();
  agent.setState(state);
  const copilotkit = new CopilotKitCoreReact({
    agents__unsafe_dev_only: { wiki_race: agent },
  });
  const result: {
    fallback: RaceState | null;
    errors: string[];
    sdkResolved: boolean;
  } = { fallback: null, errors: [], sdkResolved: false };
  await runWithRaceLifecycle({
    agent,
    initialState: state,
    isCancelled: () => cancelled,
    onError: (message) => {
      result.errors.push(message);
    },
    onFallback: (fallback) => {
      result.fallback = fallback;
    },
    run: async () => {
      await copilotkit.runAgent({ agent, runId: state.runId });
      result.sdkResolved = true;
    },
  });
  return { ...result, state, agent };
}

describe("race UI lifecycle with the installed CopilotKit SDK", () => {
  it("makes all active lanes terminal when RUN_ERROR resolves instead of rejecting", async () => {
    const result = await runSdkScript((_input, subscriber) => {
      subscriber.next({
        type: EventType.RUN_ERROR,
        message: "Wikipedia is unavailable.",
      });
      subscriber.complete();
    });
    expect(result.sdkResolved).toBe(true);
    expect(result.errors).toContain("Wikipedia is unavailable.");
    expect(result.fallback?.status).toBe("cancelled");
    expect(
      result.fallback?.lanes.every(
        (lane) =>
          lane.status === "error" && lane.error === "Wikipedia is unavailable.",
      ),
    ).toBe(true);
  });

  it("handles transport errors swallowed by CopilotKit using onRunFailed", async () => {
    const result = await runSdkScript((_input, subscriber) =>
      subscriber.error(new Error("Connection lost.")),
    );
    expect(result.sdkResolved).toBe(true);
    expect(result.errors).toContain("Connection lost.");
    expect(
      result.fallback?.lanes.every((lane) => lane.status === "error"),
    ).toBe(true);
  });

  it("fails a resolved stream that never delivered a terminal race snapshot", async () => {
    const result = await runSdkScript((input, subscriber) => {
      subscriber.next({
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      });
      subscriber.complete();
    });
    expect(result.sdkResolved).toBe(true);
    expect(result.errors[0]).toContain("before a final result arrived");
    expect(result.fallback && isTerminalRace(result.fallback)).toBe(true);
  });

  it("keeps cancellation distinct from a connection failure if no final snapshot arrives", async () => {
    const result = await runSdkScript((input, subscriber) => {
      subscriber.next({
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      });
      subscriber.complete();
    }, true);
    expect(result.errors).toEqual([]);
    expect(
      result.fallback?.lanes.every((lane) => lane.status === "cancelled"),
    ).toBe(true);
  });

  it("accepts terminal state with final timings after an immediate local stop", async () => {
    const result = await runSdkScript((input, subscriber) => {
      const current = runningRace();
      const final = interruptRace({
        ...current,
        runId: input.runId,
        lanes: current.lanes.map((lane) => ({
          ...lane,
          elapsedMs: 450,
          modelMs: 280,
        })),
      });
      subscriber.next({ type: EventType.STATE_SNAPSHOT, snapshot: final });
      subscriber.next({
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      });
      subscriber.complete();
    }, true);
    const immediateStop = interruptRace(result.state);
    const visible = selectRaceState(
      result.agent.state,
      immediateStop,
      initialRace(),
    );
    expect(result.errors).toEqual([]);
    expect(result.fallback).toBeNull();
    expect(visible.lanes[0]).toMatchObject({
      status: "cancelled",
      elapsedMs: 450,
      modelMs: 280,
    });
  });
});

describe("race snapshot reconciliation", () => {
  it("retains completed lanes and their timings when another lane fails", () => {
    const state = runningRace();
    state.lanes[0] = {
      ...state.lanes[0],
      status: "finished",
      elapsedMs: 1100,
      modelMs: 700,
    };
    const fallback = interruptRace(state, "Connection lost.");
    expect(fallback.lanes[0]).toBe(state.lanes[0]);
    expect(fallback.lanes[1]).toMatchObject({
      status: "error",
      error: "Connection lost.",
    });
  });

  it("holds the local stop through nonterminal or other-run snapshots", () => {
    const state = runningRace();
    const localStop = interruptRace(state);
    expect(selectRaceState(state, localStop, initialRace())).toBe(localStop);
    const otherRun = interruptRace(runningRace());
    expect(selectRaceState(otherRun, localStop, initialRace())).toBe(localStop);
  });
});
