import { AbstractAgent } from "@ag-ui/client";
import { EventType, type BaseEvent, type RunAgentInput } from "@ag-ui/core";
import { Observable } from "rxjs";
import { z } from "zod";
import type { LaneDefinition } from "../race/types";
import { executeToolCall } from "./executor";
import { runArenaLane } from "./lane-engine";
import { createJevProvider, createOpenRouterProvider } from "./providers";
import { createSampleProvider } from "./sample";
import { arenaConfigSchema, type ArenaConfig } from "./types";

const runPropsSchema = z.object({
  config: arenaConfigSchema,
  runId: z.string().uuid(),
});

/** Every lane keeps its own keys server-side; nothing here reaches the client. */
function laneProvider(lane: LaneDefinition, config: ArenaConfig) {
  if (config.mode === "sample") return createSampleProvider(lane.id);
  return lane.provider === "jev"
    ? createJevProvider(process.env.TYPESAFE_API_KEY ?? "", lane.model)
    : createOpenRouterProvider(process.env.OPENROUTER_API_KEY ?? "", lane.model);
}

export class ToolArenaAgent extends AbstractAgent {
  private laneController = new AbortController();
  constructor(private readonly lane: LaneDefinition) {
    super({
      agentId: `tool_bench_${lane.id}`,
      description: `${lane.name} tool-calling arena lane`,
    });
  }
  override abortRun(): void {
    this.laneController.abort();
  }
  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable((subscriber) => {
      const controller = this.laneController;
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
          const { config, runId } = runPropsSchema.parse(input.forwardedProps);
          // Provider, tool and stop outcomes are lane state, not run errors:
          // one failing agent must never end the other three.
          await runArenaLane(
            this.lane,
            config,
            runId,
            {
              provider: laneProvider(this.lane, config),
              execute: executeToolCall,
            },
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
                ? "Invalid arena run specification. Choose sample or live mode and one benchmark case."
                : error instanceof Error
                  ? error.message
                  : "The arena lane could not start.",
          });
        } finally {
          subscriber.complete();
        }
      })();
      return () => {
        controller.abort();
        if (this.laneController === controller)
          this.laneController = new AbortController();
      };
    });
  }
  override clone(): ToolArenaAgent {
    return new ToolArenaAgent(this.lane);
  }
}
