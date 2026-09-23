"use client";

import { ChevronDown, Gauge, Info, Target, Trophy } from "lucide-react";
import type { ArenaLaneState } from "../lib/tool-bench/types";
import { benchTime } from "./tool-bench-metrics";

export type ArenaSummary = {
  highestAccuracy: string[];
  fastestExact: string[];
  completed: number;
  available: number;
};

const accuracyRank = (lane: ArenaLaneState) =>
  lane.score?.correct ? 2 : lane.score?.toolCorrect ? 1 : 0;

/** A lane that produced no score still owes the table a readable cell. */
const statusLabel: Record<ArenaLaneState["status"], string> = {
  idle: "Not started",
  running: "Racing",
  complete: "—",
  cancelled: "Stopped",
  error: "Failed",
  unavailable: "Not configured",
};

/**
 * Accuracy and speed are reported separately and never combined into a
 * composite: a faster lane that called the wrong tool wins nothing.
 */
export function summarizeArena(lanes: ArenaLaneState[]): ArenaSummary {
  const available = lanes.filter((lane) => lane.status !== "unavailable");
  const completed = available.filter((lane) => lane.status === "complete");
  const best = Math.max(0, ...completed.map(accuracyRank));
  const exact = completed.filter((lane) => lane.score?.correct);
  const fastest = Math.min(
    Infinity,
    ...exact.map((lane) => lane.timings.totalMs),
  );
  return {
    highestAccuracy:
      best > 0
        ? completed
            .filter((lane) => accuracyRank(lane) === best)
            .map((lane) => lane.name)
        : [],
    fastestExact: exact
      .filter((lane) => lane.timings.totalMs === fastest)
      .map((lane) => lane.name),
    completed: completed.length,
    available: available.length,
  };
}

function Outcome({
  icon: Icon,
  title,
  names,
  detail,
}: {
  icon: typeof Target;
  title: string;
  names: string[];
  detail: string | null;
}) {
  return (
    <div className="tb-outcome">
      <span className="tb-outcome-title">
        <Icon size={13} aria-hidden="true" />
        {title}
      </span>
      <strong>{names.length ? names.join(" · ") : "—"}</strong>
      <small>
        {names.length && detail ? detail : "No qualifying lane yet"}
      </small>
    </div>
  );
}

export function ToolArenaSummary({
  lanes,
  complete,
}: {
  lanes: ArenaLaneState[];
  complete: boolean;
}) {
  const summary = summarizeArena(lanes);
  const exactLanes = lanes.filter(
    (lane) => lane.status === "complete" && lane.score?.correct,
  );
  const fastestMs = exactLanes.length
    ? Math.min(...exactLanes.map((lane) => lane.timings.totalMs))
    : null;
  const winnerId = exactLanes.find(
    (lane) => lane.timings.totalMs === fastestMs,
  )?.id;
  return (
    <section className="tb-metrics" aria-label="Arena results">
      <div className="tb-metrics-heading">
        <h2>Results this race</h2>
        <span>
          {complete
            ? `${summary.completed}/${summary.available} agents completed`
            : "Waiting for the race to finish"}
        </span>
      </div>
      {complete ? (
        <div className="tb-results-reveal" role="status" aria-live="polite">
          <div
            className={`tb-winner ${winnerId ? `tb-color-${winnerId}` : ""}`}
          >
            <span className="tb-outcome-title">
              <Trophy size={15} aria-hidden="true" /> Winner
            </span>
            <strong>
              {summary.fastestExact.length
                ? `Winner: ${summary.fastestExact.join(" · ")}`
                : "No exact-call winner"}
            </strong>
            <small>
              {fastestMs === null
                ? "No agent finished with the exact tool and arguments."
                : `Fastest exact call · ${benchTime(fastestMs)} total`}
            </small>
          </div>
          <div className="tb-outcomes">
            <Outcome
              icon={Target}
              title="Highest accuracy"
              names={summary.highestAccuracy}
              detail="Exact tool and arguments on this request"
            />
            <Outcome
              icon={Gauge}
              title="Fastest exact call"
              names={summary.fastestExact}
              detail={
                fastestMs === null ? null : `${benchTime(fastestMs)} total`
              }
            />
          </div>
        </div>
      ) : (
        <p className="tb-winner-pending" role="status">
          Winner revealed when all agents finish
        </p>
      )}
      <div
        className="tb-table-scroll"
        role="region"
        aria-label="Per-agent phase timing"
        tabIndex={0}
      >
        <table className="tb-table">
          <thead>
            <tr>
              <th scope="col">Agent</th>
              <th scope="col">Result</th>
              <th scope="col">Decision</th>
              <th scope="col">Tool</th>
              <th scope="col">UI commit</th>
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {lanes.map((lane) => (
              <tr key={lane.id} className={`tb-color-${lane.id}`}>
                <th scope="row" title={lane.model}>
                  {lane.name}
                </th>
                {lane.status === "unavailable" ? (
                  <td colSpan={5} className="tb-unavailable-metric">
                    {lane.error ?? "Not configured"}
                  </td>
                ) : (
                  <>
                    <td>
                      {lane.score?.correct
                        ? "Exact call"
                        : lane.score?.toolCorrect
                          ? "Argument mismatch"
                          : lane.score
                            ? "Tool mismatch"
                            : statusLabel[lane.status]}
                    </td>
                    <td>{benchTime(lane.timings.decisionMs)}</td>
                    <td>{benchTime(lane.timings.toolMs)}</td>
                    <td>{benchTime(lane.timings.renderMs)}</td>
                    <td>{benchTime(lane.timings.totalMs)}</td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <footer className="tb-footer">
        <span>
          Accuracy and speed are reported separately; local tools are
          deterministic and side-effect free.
        </span>
        <details className="tb-methodology">
          <summary>
            <Info size={13} /> About the numbers <ChevronDown size={12} />
          </summary>
          <div>
            <p>
              Every agent receives the same request, tool definitions, entity
              candidates, evaluation rules and local tool implementations. Jev
              selects the tool and each constrained argument through typed
              Choice questions in one request; the comparison models use native
              function calling through their native APIs. These integration
              formats differ and are disclosed rather than presented as one
              protocol. Expected labels never reach a provider input.
            </p>
            <p>
              <strong>Decision</strong> runs from request dispatch to a valid
              tool call or a provider failure. <strong>Tool</strong> runs from
              local tool invocation to its result or failure.{" "}
              <strong>UI commit</strong> runs from receiving the tool result
              until the browser commits the rendered lane; it is an application
              lifecycle measurement, not a paint benchmark.{" "}
              <strong>Total</strong> is the sum of those phases for that lane.
              The header clock is wall-clock race time from launch until every
              lane settled.
            </p>
            <p>
              Tool accuracy checks the selected tool. Exact-call accuracy also
              requires every argument key and value to match, with no extra or
              missing arguments. Provider failures, unknown tools and invalid
              arguments count as incorrect and never produce a fabricated
              result. Fastest is computed only among exact completed lanes.
            </p>
            <p>
              Live latency includes network and provider time. A single request
              on a small curated suite and the included cases do not establish
              general model performance.
            </p>
            <p>
              Live setup: set <code>TYPESAFE_API_KEY</code>,{" "}
              <code>OPENAI_API_KEY</code>, <code>ANTHROPIC_API_KEY</code>, and{" "}
              <code>GOOGLE_API_KEY</code> in the server environment, then
              restart. Keys stay server-side.
            </p>
          </div>
        </details>
      </footer>
    </section>
  );
}
