"use client";

import {
  Check,
  ChevronDown,
  Code2,
  LoaderCircle,
  TriangleAlert,
  X,
} from "lucide-react";
import type { ArenaLaneState } from "../lib/tool-bench/types";
import { benchTime } from "./tool-bench-metrics";
import { ToolResultCard } from "./tool-result-card";

const statusLabels: Record<ArenaLaneState["status"], string> = {
  idle: "Ready",
  running: "Choosing a tool",
  complete: "Complete",
  cancelled: "Stopped",
  error: "Lane failed",
  unavailable: "Key needed",
};

function scoreLabel(lane: ArenaLaneState) {
  if (!lane.score) return lane.error ? "Call failed" : "Not evaluated";
  if (lane.score.correct) return "Exact match";
  return lane.score.toolCorrect ? "Argument mismatch" : "Tool mismatch";
}

function phaseLabel(lane: ArenaLaneState) {
  if (lane.status === "running")
    return lane.decision ? "Running the tool…" : "Choosing a tool…";
  if (lane.status === "complete") return "Answered from the tool result";
  if (lane.status === "cancelled") return "Stopped before finishing";
  if (lane.status === "unavailable") return "Not racing this round";
  if (lane.status === "error") return "Could not finish";
  return "Waiting for the race to start";
}

export function ToolArenaLane({ lane }: { lane: ArenaLaneState }) {
  const active = lane.status === "running";
  const choices = lane.decision?.choices ?? [];
  return (
    <article
      className={`tb-lane tb-color-${lane.id} ${active ? "tb-lane-active" : ""} ${lane.status === "complete" ? "tb-lane-complete" : ""}`}
      aria-label={`${lane.name} CopilotKit agent`}
    >
      <header className="tb-lane-header">
        <div className="tb-lane-title">
          <h2>{lane.name}</h2>
          <span className={`tb-lane-status tb-status-${lane.status}`}>
            {active ? (
              <LoaderCircle size={11} className="spin" />
            ) : lane.status === "error" ? (
              <TriangleAlert size={11} />
            ) : lane.status === "complete" ? (
              <Check size={12} strokeWidth={2.5} />
            ) : (
              <span className="tb-status-dot" />
            )}
            {statusLabels[lane.status]}
          </span>
        </div>
        <span className="tb-model-id" title={lane.model}>
          {lane.model}
        </span>
      </header>

      <div className="tb-conversation">
        <p className="tb-bubble tb-bubble-user">
          {lane.prompt || "Ready for the shared request."}
        </p>
        <div className="tb-bubble tb-bubble-agent">
          <p className="tb-phase">
            {active && (
              <LoaderCircle size={11} className="spin" aria-hidden="true" />
            )}
            {phaseLabel(lane)}
          </p>

          {lane.decision && (
            <div className="tb-call-card">
              <div className="tb-call-heading">
                <span>
                  Tool call
                  {` · ${benchTime(lane.timings.decisionMs)}`}
                </span>
                <span
                  className={
                    lane.score?.correct ? "tb-correct" : "tb-incorrect"
                  }
                >
                  {lane.score?.correct ? <Check size={12} /> : <X size={12} />}
                  {scoreLabel(lane)}
                </span>
              </div>
              <pre className="tb-call">
                <code>
                  <strong>{lane.decision.tool}</strong>(
                  {JSON.stringify(lane.decision.arguments)})
                </code>
              </pre>
              {lane.score && (
                <p className="tb-call-checks">
                  {`Tool ${lane.score.toolCorrect ? "✓" : "✕"} · arguments ${
                    lane.score.argumentsCorrect ? "✓" : "✕"
                  }`}
                </p>
              )}
            </div>
          )}

          {lane.execution && <ToolResultCard execution={lane.execution} />}

          {lane.provider === "jev" && choices.length > 0 && (
            <details className="tb-choices">
              <summary>
                Ranked tool choices <ChevronDown size={12} />
              </summary>
              <div className="tb-probabilities">
                {lane.decision?.confidence !== null &&
                  lane.decision?.confidence !== undefined && (
                    <p>
                      {`Returned confidence ${(lane.decision.confidence * 100).toFixed(1)}%. A provider score, not measured correctness.`}
                    </p>
                  )}
                {choices.map((choice) => (
                  <div key={choice.tool}>
                    <span>{choice.tool}</span>
                    <span>{`${(choice.probability * 100).toFixed(1)}%`}</span>
                    <span className="tb-probability-track" aria-hidden="true">
                      <span
                        style={{
                          width: `${Math.max(0, Math.min(1, choice.probability)) * 100}%`,
                        }}
                      />
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )}

          {lane.error && (
            <p className="tb-lane-error" role="alert">
              {lane.error}
            </p>
          )}

          {!lane.decision && !lane.error && (
            <p className="tb-lane-ready">
              <Code2 size={18} strokeWidth={1.25} aria-hidden="true" />
              One request. The right tool. Exact arguments.
            </p>
          )}
        </div>
      </div>

      <dl className="tb-lane-timers" aria-label={`${lane.name} phase timing`}>
        <div>
          <dt>Decision</dt>
          <dd>{benchTime(lane.timings.decisionMs)}</dd>
        </div>
        <div>
          <dt>Tool</dt>
          <dd>{benchTime(lane.timings.toolMs)}</dd>
        </div>
        <div>
          <dt>UI commit</dt>
          <dd>{benchTime(lane.timings.renderMs)}</dd>
        </div>
        <div className="tb-lane-total">
          <dt>Total</dt>
          <dd>{benchTime(lane.timings.totalMs)}</dd>
        </div>
      </dl>
    </article>
  );
}
