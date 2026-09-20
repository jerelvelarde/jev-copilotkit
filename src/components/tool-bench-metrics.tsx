"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Info } from "lucide-react";
import type { BenchLane, BenchState } from "../lib/tool-bench/types";

export function benchTime(milliseconds: number) {
  return milliseconds < 1000
    ? `${Math.round(milliseconds)} ms`
    : `${(milliseconds / 1000).toFixed(2)} s`;
}

/** Nearest-rank percentiles include every measured request, including failures. */
export function laneMetrics(lane: BenchLane) {
  const timings = lane.results
    .map((result) => result.modelMs)
    .filter((ms) => Number.isFinite(ms) && ms > 0)
    .sort((a, b) => a - b);
  const correct = lane.results.filter((result) => result.correct).length;
  const toolCorrect = lane.results.filter(
    (result) => result.toolCorrect,
  ).length;
  const percentile = (p: number) =>
    timings.length ? timings[Math.ceil(timings.length * p) - 1] : null;
  return {
    count: lane.results.length,
    correct,
    toolCorrect,
    p50: percentile(0.5),
    p95: percentile(0.95),
    correctPerSecond:
      lane.results.length && lane.elapsedMs > 0
        ? (correct * 1000) / lane.elapsedMs
        : null,
  };
}

export function benchComparisons(bench: BenchState): string[] {
  if (bench.config.mode !== "live" || bench.status !== "complete") return [];
  const eligible = bench.lanes.filter(
    (lane) =>
      lane.available &&
      lane.status === "complete" &&
      lane.results.length === bench.totalCases,
  );
  const jev = eligible.find((lane) => lane.provider === "jev");
  if (!jev) return [];
  const jevMetrics = laneMetrics(jev);
  const jevP50 = jevMetrics.p50;
  if (jevP50 === null) return [];
  return eligible
    .filter((lane) => lane.provider !== "jev")
    .flatMap((lane) => {
      const other = laneMetrics(lane);
      if (other.p50 === null) return [];
      const ratio = other.p50 / jevP50;
      const timing =
        ratio > 1.005
          ? `${ratio.toFixed(2)}× faster than`
          : ratio < 0.995
            ? `${(1 / ratio).toFixed(2)}× slower than`
            : "about the same speed as";
      return [
        `Jev: ${timing} ${lane.name} by p50 request latency; exact calls ${jevMetrics.correct}/${bench.totalCases} vs ${other.correct}/${bench.totalCases}.`,
      ];
    });
}

export function BenchClock({
  bench,
  running,
}: {
  bench: BenchState;
  running: boolean;
}) {
  const [tick, setTick] = useState<{ runId: string; ms: number } | null>(null);
  const measured = Math.max(0, ...bench.lanes.map((lane) => lane.elapsedMs));
  const ticking =
    running &&
    bench.lanes.some(
      (lane) => lane.status === "running" && lane.startedAt !== null,
    );
  useEffect(() => {
    if (!ticking) return;
    const receivedAt = performance.now();
    const timer = window.setInterval(() => {
      setTick({
        runId: bench.runId,
        ms: measured + performance.now() - receivedAt,
      });
    }, 50);
    return () => window.clearInterval(timer);
  }, [ticking, measured, bench.runId]);
  const ms =
    ticking && tick?.runId === bench.runId
      ? Math.max(measured, tick.ms)
      : measured;
  return (
    <div className="tb-clock">
      <span
        role="timer"
        aria-live="off"
        aria-label={`Elapsed time ${(ms / 1000).toFixed(1)} seconds`}
      >
        {(ms / 1000).toFixed(1)}
        <small>s</small>
      </span>
      <span>Elapsed</span>
    </div>
  );
}

export function ToolBenchMetrics({ bench }: { bench: BenchState }) {
  const sample = bench.config.mode === "sample";
  const largest = Math.max(1, ...bench.lanes.map((lane) => lane.modelMs));
  const comparisons = benchComparisons(bench);
  const hasResults = bench.lanes.some((lane) => lane.results.length > 0);
  return (
    <section className="tb-metrics" aria-label="Benchmark results">
      <div className="tb-metrics-heading">
        <h2>{sample ? "Sample results" : "Results this run"}</h2>
        <span>
          {sample
            ? "Synthetic responses · equal simulated delays · no benchmark claims"
            : `${bench.datasetVersion} · ${bench.totalCases} requests per model · measured request time`}
        </span>
      </div>
      <div
        className="tb-table-scroll"
        role="region"
        aria-label="Model metrics comparison"
        tabIndex={0}
      >
        <table className="tb-table">
          <thead>
            <tr>
              <th scope="col">Model</th>
              <th scope="col">Tool accuracy</th>
              <th scope="col">Exact call</th>
              <th scope="col">p50</th>
              <th scope="col">p95</th>
              <th scope="col">Correct calls/s</th>
              <th scope="col">Total request time</th>
            </tr>
          </thead>
          <tbody>
            {bench.lanes.map((lane) => {
              const metrics = laneMetrics(lane);
              const unavailable = !sample && !lane.available;
              return (
                <tr key={lane.id} className={`tb-color-${lane.id}`}>
                  <th scope="row" title={lane.model}>
                    {lane.name}
                  </th>
                  {unavailable ? (
                    <td colSpan={6} className="tb-unavailable-metric">
                      Not configured ·{" "}
                      {lane.provider === "jev"
                        ? "TYPESAFE_API_KEY"
                        : "OPENROUTER_API_KEY"}{" "}
                      needed
                    </td>
                  ) : (
                    <>
                      <td>
                        {metrics.count
                          ? `${Math.round((metrics.toolCorrect / metrics.count) * 100)}%`
                          : "—"}
                        <small>
                          {metrics.count
                            ? `${metrics.toolCorrect}/${metrics.count}`
                            : ""}
                        </small>
                      </td>
                      <td>
                        {metrics.count
                          ? `${Math.round((metrics.correct / metrics.count) * 100)}%`
                          : "—"}
                        <small>
                          {metrics.count
                            ? `${metrics.correct}/${metrics.count}`
                            : ""}
                        </small>
                      </td>
                      <td>
                        {metrics.p50 === null ? "—" : benchTime(metrics.p50)}
                      </td>
                      <td>
                        {metrics.p95 === null ? "—" : benchTime(metrics.p95)}
                      </td>
                      <td>
                        {metrics.correctPerSecond === null
                          ? "—"
                          : metrics.correctPerSecond.toFixed(2)}
                      </td>
                      <td>
                        <div className="tb-time-cell">
                          <span className="tb-time-track" aria-hidden="true">
                            <span
                              style={{
                                width: `${(Math.max(0, lane.modelMs) / largest) * 100}%`,
                              }}
                            />
                          </span>
                          <span>
                            {lane.modelMs > 0 ? benchTime(lane.modelMs) : "—"}
                          </span>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {comparisons.length > 0 && (
        <div className="tb-comparisons">
          {comparisons.map((comparison) => (
            <p key={comparison}>{comparison}</p>
          ))}
          <p>
            Small labeled suite, single run. Read latency alongside accuracy;
            results do not establish general model performance.
          </p>
        </div>
      )}
      <footer className="tb-footer">
        <span>
          {sample
            ? "Preview the workflow. Switch to Live for real requests."
            : hasResults
              ? "Accuracy uses recorded attempts; completion is shown in each lane."
              : "Same requests, candidate arguments and order. Tools are never executed."}
        </span>
        <details className="tb-methodology">
          <summary>
            <Info size={13} /> About the numbers <ChevronDown size={12} />
          </summary>
          <div>
            <p>
              Each lane receives the same versioned support requests, entity
              candidates and tool definitions. Jev uses typed Choice questions
              for tool and argument selection in one request; OpenRouter models
              use native function calling. These API formats differ. Expected
              labels are kept out of provider inputs. Calls are evaluated, never
              executed.
            </p>
            <p>
              Tool accuracy checks the selected tool. Exact-call accuracy
              requires the tool and every argument to match, including no extra
              or missing arguments. Failed attempts count as incorrect. Partial
              or stopped runs are not compared as complete runs.
            </p>
            <p>
              p50 and p95 use nearest-rank percentiles of recorded request
              durations, including failures. Bars show summed request time,
              scaled to this run. Correct calls/s is exact calls divided by each
              lane’s recorded elapsed time, including failures and waiting. The
              live clock extrapolates from received durations; final times come
              from the server.
            </p>
            <p>
              {sample
                ? "Sample responses are synthetic and all lanes use the same simulated delay. Sample numbers are a UI demonstration, not provider measurements."
                : "Latency includes network and provider time. This small suite is not a general model ranking. Runs stop at 90 seconds; cancelled requests preserve completed results."}
            </p>
            <p>
              Live setup: set <code>TYPESAFE_API_KEY</code> for Jev and{" "}
              <code>OPENROUTER_API_KEY</code> for baselines in the server
              environment, then restart. Keys stay server-side. Live mode never
              falls back to samples.
            </p>
          </div>
        </details>
      </footer>
    </section>
  );
}
