import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_CONFIG, initialRace } from "../lib/race/types";
import { LaneCard } from "./lane-card";
import { RaceWinner } from "./race-winner";

const config = { ...DEFAULT_CONFIG, mode: "live" as const };

describe("wiki race completion", () => {
  it("highlights a finished lane immediately with Complete", () => {
    const lane = {
      ...initialRace(config).lanes[0],
      available: true,
      status: "finished" as const,
      elapsedMs: 420,
    };
    const html = renderToStaticMarkup(
      createElement(LaneCard, { lane, config, place: null }),
    );
    expect(html).toContain("lane-complete");
    expect(html).toContain("Complete");
    expect(html).not.toContain("#1");
  });

  it("reveals the fastest finisher only after the whole race settles", () => {
    const race = initialRace(config);
    race.runId = "run-1";
    race.status = "running";
    race.lanes[0].status = "finished";
    race.lanes[0].elapsedMs = 420;
    race.lanes[1].status = "thinking";
    const finished = [race.lanes[0]];
    const inProgress = renderToStaticMarkup(
      createElement(RaceWinner, { race, finished }),
    );
    expect(inProgress).toContain("Winner revealed when all racers finish");
    expect(inProgress).not.toContain("Winner: Jev");

    const final = renderToStaticMarkup(
      createElement(RaceWinner, {
        race: { ...race, status: "complete" },
        finished,
      }),
    );
    expect(final).toContain("Winner: Jev");
    expect(final).toContain("420 ms elapsed");
  });
});
