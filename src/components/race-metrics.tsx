"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Info } from "lucide-react";
import type { RaceState } from "@/lib/race/types";

function clockText(milliseconds: number) {
  const centiseconds = Math.floor(Math.max(0, milliseconds) / 10);
  const minutes = Math.floor(centiseconds / 6000);
  const seconds = Math.floor(centiseconds / 100) % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(centiseconds % 100).padStart(2, "0")}`;
}

function modelTime(milliseconds: number) {
  return milliseconds < 1000
    ? `${Math.round(milliseconds)} ms`
    : `${(milliseconds / 1000).toFixed(2)} s`;
}

export function RaceClock({
  race,
  running,
}: {
  race: RaceState;
  running: boolean;
}) {
  const [tick, setTick] = useState<{ runId: string; elapsedMs: number } | null>(
    null,
  );
  const activeLanes = race.lanes.filter(
    (lane) => lane.status === "loading" || lane.status === "thinking",
  );
  const ticking =
    running && activeLanes.some((lane) => lane.startedAt !== null);
  const authoritativeMs = Math.max(
    0,
    ...race.lanes.map((lane) => lane.elapsedMs),
  );

  useEffect(() => {
    if (!ticking) return;
    // Extrapolate from a received duration on the browser's monotonic clock.
    // Browser and server wall clocks need not agree.
    const receivedAt = performance.now();
    const interval = window.setInterval(() => {
      setTick({
        runId: race.runId,
        elapsedMs: authoritativeMs + performance.now() - receivedAt,
      });
    }, 33);
    return () => window.clearInterval(interval);
  }, [ticking, authoritativeMs, race.runId]);

  const elapsedMs =
    ticking && tick?.runId === race.runId
      ? Math.max(authoritativeMs, tick.elapsedMs)
      : authoritativeMs;
  return (
    <div className="arena-clock">
      <span
        className="arena-clock-value"
        role="timer"
        aria-label={`Race elapsed time: ${clockText(elapsedMs)}`}
        aria-live="off"
      >
        {clockText(elapsedMs)}
      </span>
      <span className="arena-clock-label">
        {race.config.mode === "sample"
          ? "Sample race time"
          : "Race elapsed time"}
      </span>
    </div>
  );
}

export function RaceTimeline({ race }: { race: RaceState }) {
  const largestMs = Math.max(1, ...race.lanes.map((lane) => lane.modelMs));
  const sample = race.config.mode === "sample";

  return (
    <section className="arena-timeline" aria-label="Model request times">
      <div className="arena-timeline-header">
        <h2>Model time</h2>
        <span>
          {sample
            ? "Simulated · sample illustration"
            : "Measured · model requests only"}
        </span>
      </div>
      <div className="arena-timeline-rows">
        {race.lanes.map((lane) => (
          <div
            className={`arena-timeline-row arena-timeline-${lane.id}`}
            key={lane.id}
          >
            <span className="arena-timeline-name" title={lane.model}>
              {lane.name}
            </span>
            <span className="arena-timeline-track" aria-hidden="true">
              <span
                className="arena-timeline-fill"
                style={{
                  width: `${(Math.max(0, lane.modelMs) / largestMs) * 100}%`,
                }}
              />
            </span>
            <span className="arena-timeline-value">
              {!sample && !lane.available
                ? "Not configured"
                : modelTime(lane.modelMs)}
            </span>
          </div>
        ))}
      </div>
      <div className="arena-timeline-footer">
        <span>
          {sample ? "Scripted article previews." : "Article content from "}
          {!sample && (
            <a href="https://en.wikipedia.org" target="_blank" rel="noreferrer">
              Wikipedia
            </a>
          )}{" "}
          {!sample && (
            <>
              ·{" "}
              <a
                href="https://creativecommons.org/licenses/by-sa/4.0/"
                target="_blank"
                rel="noreferrer"
              >
                CC BY-SA 4.0
              </a>
            </>
          )}
        </span>
        <details className="arena-timeline-methodology">
          <summary>
            <Info size={12} />
            About the numbers
            <ChevronDown size={12} />
          </summary>
          <div>
            <p>
              Sample courses and timings are authored illustrations, not
              recorded inference or verified Wikipedia routes. Live model time
              measures API requests; the race clock includes article retrieval
              and other waiting. Wikipedia pages use a cache shared by the lanes
              within each race.
            </p>
            <p>
              Jev chooses among up to 255 links, ranking larger sets in batches
              first. Baselines receive the full candidate list within the page
              limit. A direct target link ends a lane without a model call.
              Timing bars are scaled to the longest model time in this race.
            </p>
            <p>
              Live articles are from{" "}
              <a
                href="https://en.wikipedia.org"
                target="_blank"
                rel="noreferrer"
              >
                Wikipedia
              </a>{" "}
              under{" "}
              <a
                href="https://creativecommons.org/licenses/by-sa/4.0/"
                target="_blank"
                rel="noreferrer"
              >
                CC BY-SA 4.0
              </a>
              . Article links in each lane provide source attribution. This demo
              is not a controlled benchmark.
            </p>
          </div>
        </details>
      </div>
    </section>
  );
}
