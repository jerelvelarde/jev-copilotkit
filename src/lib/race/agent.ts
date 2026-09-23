import { AbstractAgent } from "@ag-ui/client";
import { EventType, type BaseEvent, type RunAgentInput } from "@ag-ui/core";
import { Observable } from "rxjs";
import { runRace } from "./engine";
import { getLaneDefinitions, liveProviders } from "./providers";
import { loadWikipediaPage } from "./wikipedia";
import { raceConfigSchema } from "./types";
import type { RaceDependencies } from "./types";
import { z } from "zod";

export class WikiRaceAgent extends AbstractAgent {
  private raceController = new AbortController();
  constructor(private readonly dependencies?: RaceDependencies) {
    super({
      agentId: "wiki_race",
      description:
        "Race from one Wikipedia article to another with Jev and comparison models.",
    });
  }

  override abortRun(): void {
    this.raceController.abort();
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable((subscriber) => {
      // Created eagerly so Stop also wins the window before run subscription.
      const controller = this.raceController;
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
            .object({ config: raceConfigSchema })
            .parse(input.forwardedProps);
          const lanes = getLaneDefinitions();
          const dependencies = this.dependencies ?? {
            loadPage: loadWikipediaPage,
            providers: liveProviders(lanes),
          };
          await runRace(
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
                ? "Invalid race configuration. Enter valid article titles and a hop limit from 1 to 20."
                : error instanceof Error
                  ? error.message
                  : "The race could not start.",
          });
        } finally {
          subscriber.complete();
        }
      })();
      return () => {
        controller.abort();
        if (this.raceController === controller)
          this.raceController = new AbortController();
      };
    });
  }

  clone(): WikiRaceAgent {
    return new WikiRaceAgent(this.dependencies);
  }
}
