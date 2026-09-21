"use client";

import { useEffect, useState } from "react";
import type { ArenaEvent, ArenaPhase } from "../lib/tool-bench/types";

export function benchTime(milliseconds: number) {
  return milliseconds < 1000
    ? `${Math.round(milliseconds)} ms`
    : `${(milliseconds / 1000).toFixed(2)} s`;
}

/** Positions one lane's events on the arena's shared time axis. */
export function buildTrace(events: ArenaEvent[], scaleMs: number) {
  const safeScale = Math.max(1, scaleMs);
  return events.map((event) => ({
    ...event,
    left: Math.min(100, Math.max(0, (event.atMs / safeScale) * 100)),
    width:
      event.durationMs === null
        ? 0
        : Math.min(100, Math.max(1, (event.durationMs / safeScale) * 100)),
  }));
}

/** One node per phase: its outcome if it has one, otherwise its in-flight start. */
export function collapsePhases(events: ArenaEvent[]): ArenaEvent[] {
  const latest = new Map<ArenaPhase, ArenaEvent>();
  for (const event of events)
    if (!latest.has(event.phase) || event.status !== "started")
      latest.set(event.phase, event);
  return [...latest.values()];
}

/**
 * Wall-clock race time. It counts up from launch and freezes at the moment
 * every lane settled; per-lane phase timings are the measurements.
 */
export function arenaClockMs(
  startedAt: number | null,
  finishedAt: number | null,
  now: number | null,
) {
  if (startedAt === null) return 0;
  return Math.max(0, (finishedAt ?? now ?? startedAt) - startedAt);
}

export function createArenaTicker(onTick: () => void, intervalMs = 50) {
  const timer = setInterval(onTick, intervalMs);
  return () => clearInterval(timer);
}

export function ArenaClock({
  startedAt,
  finishedAt,
}: {
  startedAt: number | null;
  finishedAt: number | null;
}) {
  const [now, setNow] = useState<number | null>(null);
  const ticking = startedAt !== null && finishedAt === null;
  useEffect(() => {
    if (!ticking) return;
    return createArenaTicker(() => setNow(performance.now()));
  }, [ticking]);
  const ms = arenaClockMs(startedAt, finishedAt, now);
  return (
    <div className="tb-clock">
      <span
        role="timer"
        aria-live="off"
        aria-label={`Race time ${(ms / 1000).toFixed(1)} seconds`}
      >
        {(ms / 1000).toFixed(1)}
        <small>s</small>
      </span>
      <span>Race</span>
    </div>
  );
}
