import { AbstractAgent } from "@ag-ui/client";
import { EventType, type BaseEvent, type RunAgentInput } from "@ag-ui/core";
import { Observable } from "rxjs";
import { z } from "zod";
import { getLaneDefinitions } from "../race/providers";
import { BENCH_CASES } from "./cases";
import { runBenchmark } from "./engine";
import { liveProviders } from "./providers";
import { createSampleDependencies } from "./sample";
import { benchConfigSchema } from "./types";

export class ToolBenchAgent extends AbstractAgent {
  private benchController = new AbortController();
  constructor() {
    super({
      agentId: "tool_bench",
      description:
        "Benchmark Jev and comparison models on a labeled suite of simulated support tool calls.",
    });
  }
  override abortRun(): void {
    this.benchController.abort();
  }
  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable((subscriber) => {
      const controller = this.benchController;
      const emit = (event: BaseEvent) => {
        if (!subscriber.closed) subscriber.next(event);
      };
      emit({
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      });
      void (async () => {
        try {
          const { config } = z
            .object({ config: benchConfigSchema })
            .parse(input.forwardedProps);
          const lanes = getLaneDefinitions();
          const dependencies =
            config.mode === "sample"
              ? createSampleDependencies(config, lanes)
              : { cases: BENCH_CASES, providers: liveProviders(lanes) };
          await runBenchmark(
            config,
            lanes,
            dependencies,
            controller.signal,
            (snapshot) =>
              emit({
                type: EventType.STATE_SNAPSHOT,
                snapshot: { ...snapshot, runId: input.runId },
              }),
          );
          emit({
            type: EventType.RUN_FINISHED,
            threadId: input.threadId,
            runId: input.runId,
          });
        } catch (error) {
          emit({
            type: EventType.RUN_ERROR,
            message:
              error instanceof z.ZodError
                ? "Invalid benchmark configuration. Choose sample or live mode and 1 to 12 cases."
                : error instanceof Error
                  ? error.message
                  : "The benchmark could not start.",
          });
        } finally {
          subscriber.complete();
        }
      })();
      return () => {
        controller.abort();
        if (this.benchController === controller)
          this.benchController = new AbortController();
      };
    });
  }
  override clone(): ToolBenchAgent {
    return new ToolBenchAgent();
  }
}
