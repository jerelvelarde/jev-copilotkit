"use client";

import type { ArenaLaneState, ArenaPhase } from "../lib/tool-bench/types";
import { benchTime, buildTrace, collapsePhases } from "./tool-bench-metrics";

const phaseLabels: Record<ArenaPhase, string> = {
  decision: "Decision",
  tool: "Tool",
  render: "UI commit",
};
const statusLabels = {
  started: "in flight",
  finished: "finished",
  error: "failed",
  cancelled: "cancelled",
};

export function ToolArenaGraph({
  lanes,
  sample,
}: {
  lanes: ArenaLaneState[];
  sample: boolean;
}) {
  const scale = Math.max(1, ...lanes.map((lane) => lane.timings.totalMs));
  return (
    <section className="tb-graph" aria-label="Execution trace">
      <div className="tb-graph-heading">
        <h2>Prompt → Decision → Tool → UI</h2>
        <span>
          {sample
            ? "Synthetic decisions on a shared axis · authored delays"
            : `Shared time axis · ${benchTime(scale)} full scale`}
        </span>
      </div>
      <div
        className="tb-graph-viewport"
        role="region"
        aria-label="Agent execution traces"
        tabIndex={0}
      >
        <ol className="tb-trace-rows">
          {lanes.map((lane) => {
            const nodes = buildTrace(collapsePhases(lane.events), scale);
            return (
              <li key={lane.id} className={`tb-trace-row tb-color-${lane.id}`}>
                <span className="tb-trace-label">{lane.name}</span>
                <ol className="tb-trace-track">
                  <li className="tb-trace-node tb-trace-prompt" style={{ left: 0 }}>
                    <span>Prompt</span>
                    <small>shared request</small>
                  </li>
                  {nodes.map((node) => (
                    <li
                      key={`${node.phase}-${node.status}`}
                      className={`tb-trace-node tb-trace-${node.phase} tb-trace-${node.status}`}
                      style={{ left: `${node.left}%`, width: `${node.width}%` }}
                    >
                      <span>{phaseLabels[node.phase]}</span>
                      <small>
                        {`${statusLabels[node.status]} · ${
                          node.durationMs === null
                            ? "running"
                            : benchTime(node.durationMs)
                        }`}
                      </small>
                    </li>
                  ))}
                  {nodes.length === 0 && (
                    <li className="tb-trace-empty">
                      {lane.status === "unavailable"
                        ? "Not racing this round"
                        : "Waiting for the first event"}
                    </li>
                  )}
                </ol>
                <span className="tb-trace-total">
                  {benchTime(lane.timings.totalMs)}
                </span>
                {lane.error && (
                  <p className="tb-trace-error">{lane.error}</p>
                )}
              </li>
            );
          })}
        </ol>
      </div>
      <p className="tb-graph-note">
        Bars are positioned on one shared axis scaled to the slowest lane. Each
        node repeats its phase, status and duration as text, so the trace stays
        readable without color.
      </p>
    </section>
  );
}
