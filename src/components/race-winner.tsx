"use client";

import { Trophy } from "lucide-react";
import type { LaneState, RaceState } from "../lib/race/types";
import { formatTime } from "./lane-card";

export function RaceWinner({
  race,
  finished,
}: {
  race: RaceState;
  finished: LaneState[];
}) {
  if (race.status !== "complete") {
    return (
      <p className="arena-winner-pending" role="status">
        {race.status === "cancelled"
          ? "Race stopped before a winner was declared"
          : "Winner revealed when all racers finish"}
      </p>
    );
  }

  const winner = finished[0];
  return (
    <div
      className={`arena-winner ${winner ? `arena-lane-${winner.id}` : ""}`}
      role="status"
      aria-live="polite"
    >
      <span>
        <Trophy size={14} aria-hidden="true" /> Winner
      </span>
      <strong>
        {winner ? `Winner: ${winner.name}` : "No racer reached the destination"}
      </strong>
      {winner && (
        <small>
          {winner.hops.length} {winner.hops.length === 1 ? "hop" : "hops"} ·{" "}
          {formatTime(winner.elapsedMs)} elapsed
        </small>
      )}
    </div>
  );
}
