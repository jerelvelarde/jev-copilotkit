"use client";

import { useState } from "react";
import {
  Check,
  ChevronDown,
  Code2,
  LoaderCircle,
  TriangleAlert,
  X,
} from "lucide-react";
import type { BenchConfig, BenchLane } from "../lib/tool-bench/types";
import { benchTime, laneMetrics } from "./tool-bench-metrics";

const labels: Record<BenchLane["status"], string> = {
  ready: "Ready",
  running: "Choosing a tool",
  complete: "Complete",
  cancelled: "Stopped",
  error: "Lane failed",
  unavailable: "Key needed",
};

export function ToolBenchLane({
  lane,
  config,
  totalCases,
}: {
  lane: BenchLane;
  config: BenchConfig;
  totalCases: number;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const sample = config.mode === "sample";
  const unavailable = !sample && !lane.available;
  const status = unavailable ? "unavailable" : lane.status;
  const active = status === "running";
  const index =
    selected === null
      ? lane.results.length - 1
      : Math.min(selected, lane.results.length - 1);
  const result = lane.results[index];
  const metrics = laneMetrics(lane);
  const current = active ? lane.currentCase : null;
  const inspected = selected !== null;
  const request =
    inspected && result ? result.prompt : (current?.prompt ?? result?.prompt);
  const requestId =
    inspected && result ? result.caseId : (current?.id ?? result?.caseId);

  return (
    <article
      className={`tb-lane tb-color-${lane.id} ${active ? "tb-lane-active" : ""}`}
      aria-label={`${lane.name} benchmark lane`}
    >
      <header className="tb-lane-header">
        <div className="tb-lane-title">
          <h2>{lane.name}</h2>
          <span className={`tb-lane-status tb-status-${status}`}>
            {active ? (
              <LoaderCircle size={11} className="spin" />
            ) : status === "error" ? (
              <TriangleAlert size={11} />
            ) : (
              <span className="tb-status-dot" />
            )}
            {labels[status]}
          </span>
        </div>
        <div className="tb-lane-meta">
          <span className="tb-model-id" title={lane.model}>
            {lane.model}
          </span>
          <span>
            {lane.results.length}/{totalCases} requests
          </span>
          <span>{metrics.correct} exact</span>
        </div>
      </header>

      {!request ? (
        <div className="tb-lane-ready">
          <Code2 size={25} strokeWidth={1.25} aria-hidden="true" />
          <h3>{lane.name}</h3>
          <p>
            {unavailable
              ? "Connect this model to join the benchmark."
              : active
                ? "Waiting for the first request…"
                : status === "cancelled"
                  ? "Stopped before a result arrived."
                  : status === "error"
                    ? "No completed result. Review the error below."
                    : "One request. The right tool. Exact arguments."}
          </p>
          {unavailable && (
            <p className="tb-key-note">
              Set{" "}
              <code>
                {lane.provider === "jev"
                  ? "TYPESAFE_API_KEY"
                  : "OPENROUTER_API_KEY"}
              </code>{" "}
              on the server and restart.
            </p>
          )}
          {lane.error && !unavailable && (
            <p className="tb-lane-error" role="alert">
              {lane.error}
            </p>
          )}
        </div>
      ) : (
        <div className="tb-lane-scroll">
          <div className="tb-request-heading">
            <span>
              {inspected
                ? "Inspected request"
                : active
                  ? "Current request"
                  : "Last request"}
            </span>
            <span>{requestId}</span>
            {inspected && (
              <button onClick={() => setSelected(null)}>Follow latest</button>
            )}
          </div>
          <details className="tb-request-disclosure">
            <summary
              title={request}
              aria-label={`Read full request: ${request}`}
            >
              <span>{request}</span>
              <ChevronDown size={12} />
            </summary>
            <p className="tb-request">{request}</p>
          </details>
          {lane.error && (
            <p className="tb-lane-error" role="alert">
              {lane.error}
            </p>
          )}
          {result ? (
            <>
              <div className="tb-call-heading">
                <span>
                  {sample ? "Synthetic call" : "Tool invocation"}
                  {` · ${benchTime(result.modelMs)}`}
                  {active && !inspected && result.caseId !== current?.id
                    ? ` · ${result.caseId}`
                    : ""}
                </span>
                <span
                  className={result.correct ? "tb-correct" : "tb-incorrect"}
                >
                  {result.correct ? <Check size={12} /> : <X size={12} />}
                  {result.correct
                    ? "Exact match"
                    : result.error
                      ? "Request failed"
                      : result.toolCorrect
                        ? "Argument mismatch"
                        : "Tool mismatch"}
                </span>
              </div>
              <pre
                className="tb-call"
                title={
                  result.actual
                    ? JSON.stringify(result.actual)
                    : "No tool call returned"
                }
              >
                <code>
                  {result.actual ? (
                    <>
                      <strong>{result.actual.tool}</strong>(
                      {JSON.stringify(result.actual.arguments)})
                    </>
                  ) : (
                    "No tool call returned"
                  )}
                </code>
              </pre>
              <div className="tb-result-meta">
                <span>
                  {benchTime(result.modelMs)} {sample ? "simulated" : "request"}
                </span>
                <span>
                  Tool {result.toolCorrect ? "✓" : "✕"} · arguments{" "}
                  {result.argumentsCorrect ? "✓" : "✕"}
                </span>
              </div>
            </>
          ) : (
            <div className="tb-awaiting">
              <LoaderCircle size={13} className="spin" /> Waiting for the
              model’s tool call…
            </div>
          )}

          {result && (
            <details className="tb-inspection">
              <summary>
                Expected vs actual <ChevronDown size={13} />
              </summary>
              <div>
                <label className="tb-history-select">
                  Inspect request
                  <select
                    value={selected === null ? "latest" : String(index)}
                    onChange={(event) =>
                      setSelected(
                        event.target.value === "latest"
                          ? null
                          : Number(event.target.value),
                      )
                    }
                  >
                    <option value="latest">Follow latest</option>
                    {lane.results.map((item, resultIndex) => (
                      <option key={item.caseId} value={resultIndex}>
                        {resultIndex + 1}. {item.caseId} ·{" "}
                        {item.correct ? "exact" : "incorrect"}
                      </option>
                    ))}
                  </select>
                </label>
                {!inspected && current?.id !== result.caseId && (
                  <p className="tb-inspection-request">{result.prompt}</p>
                )}
                <div className="tb-call-compare">
                  <div>
                    <h3>Expected</h3>
                    <pre>
                      <code>{JSON.stringify(result.expected, null, 2)}</code>
                    </pre>
                  </div>
                  <div>
                    <h3>Actual</h3>
                    <pre>
                      <code>
                        {result.actual
                          ? JSON.stringify(result.actual, null, 2)
                          : "No tool call returned"}
                      </code>
                    </pre>
                  </div>
                </div>
                {result.error && (
                  <p className="tb-lane-error">{result.error}</p>
                )}
                {(result.inputTokens !== null ||
                  result.outputTokens !== null) && (
                  <p className="tb-inspection-note">
                    Returned usage:{" "}
                    {result.inputTokens !== null
                      ? `${result.inputTokens} input tokens`
                      : "input not reported"}{" "}
                    ·{" "}
                    {result.outputTokens !== null
                      ? `${result.outputTokens} output tokens`
                      : "output not reported"}
                    .
                  </p>
                )}
                {result.confidence !== null && (
                  <p className="tb-inspection-note">
                    Returned confidence: {(result.confidence * 100).toFixed(1)}
                    %. This is a provider score, not measured correctness.
                  </p>
                )}
                {result.choices.length > 0 && (
                  <div className="tb-probabilities">
                    <p>
                      {sample
                        ? "Synthetic tool probabilities"
                        : "Returned tool probabilities"}
                    </p>
                    {result.choices.map((choice, choiceIndex) => (
                      <div key={`${choice.tool}-${choiceIndex}`}>
                        <span>{choice.tool}</span>
                        <span>{(choice.probability * 100).toFixed(1)}%</span>
                        <span
                          className="tb-probability-track"
                          aria-hidden="true"
                        >
                          <span
                            style={{
                              width: `${Math.max(0, Math.min(1, choice.probability)) * 100}%`,
                            }}
                          />
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </details>
          )}
        </div>
      )}
      {request && (
        <div className="tb-history" aria-label={`${lane.name} request history`}>
          {Array.from({ length: totalCases }, (_, caseIndex) => {
            const item = lane.results[caseIndex];
            return (
              <button
                key={caseIndex}
                disabled={!item}
                className={`tb-history-dot ${item ? (item.correct ? "tb-history-correct" : "tb-history-incorrect") : ""} ${item && caseIndex === index ? "tb-history-selected" : ""}`}
                onClick={() => setSelected(caseIndex)}
                aria-pressed={Boolean(item && caseIndex === index)}
                aria-label={`Request ${caseIndex + 1}${item ? `, ${item.correct ? "exact match" : item.error ? "failed" : "incorrect"}, inspect result` : ", pending"}`}
                title={
                  item
                    ? `${item.caseId}: ${item.correct ? "exact match" : "incorrect"}`
                    : "Pending"
                }
              >
                {caseIndex + 1}
              </button>
            );
          })}
          <span>
            {lane.results.length}/{totalCases} evaluated
          </span>
        </div>
      )}
    </article>
  );
}
