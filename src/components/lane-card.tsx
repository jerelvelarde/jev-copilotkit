"use client";

import { useState } from "react";
import {
  ArrowDown,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Flag,
  LoaderCircle,
  Route,
  Sparkles,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { articleUrl, type LaneState, type RaceConfig } from "@/lib/race/types";

export function formatTime(ms: number) {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`;
}

const statusLabels: Record<LaneState["status"], string> = {
  ready: "Ready to race",
  loading: "Reading article",
  thinking: "Choosing a link",
  finished: "Destination reached",
  exhausted: "Race limit reached",
  error: "Lane failed",
  cancelled: "Stopped",
  unavailable: "Key needed",
};

export function LaneCard({
  lane,
  config,
  place,
}: {
  lane: LaneState;
  config: RaceConfig;
  place: number | null;
}) {
  const unavailable = config.mode === "live" && !lane.available;
  const status = unavailable ? "unavailable" : lane.status;
  const active = status === "loading" || status === "thinking";
  const [inspection, setInspection] = useState<{
    startedAt: number | null;
    index: number;
  } | null>(null);
  const inspectedIndex =
    inspection && inspection.startedAt === lane.startedAt
      ? Math.min(inspection.index, lane.hops.length - 1)
      : lane.hops.length - 1;
  const decision = lane.hops[inspectedIndex];
  const path = lane.path.length > 0 ? lane.path : [config.start];
  const sample = config.mode === "sample";
  const hasStarted = lane.startedAt !== null || lane.hops.length > 0;

  return (
    <article
      className={`lane-card lane-${lane.color} ${unavailable ? "lane-unavailable" : ""} ${status === "finished" ? "lane-finished" : ""}`}
      aria-label={`${lane.name} race lane`}
    >
      <div className="lane-topline" />
      <header className="lane-header">
        <div className="lane-identity">
          <span className="lane-avatar" aria-hidden="true">
            {lane.provider === "jev" ? (
              <Zap size={22} strokeWidth={1.8} />
            ) : (
              <Sparkles size={20} strokeWidth={1.7} />
            )}
          </span>
          <div>
            <div className="lane-title">
              <h3>{lane.name}</h3>
              {lane.id === "jev" && <span className="model-tag">System 1</span>}
            </div>
            <p className="model-id" title={lane.model}>
              {lane.model}
            </p>
          </div>
        </div>
        <span
          className={`lane-status status-${status}`}
          aria-label={statusLabels[status]}
        >
          {active ? (
            <LoaderCircle className="spin" size={12} />
          ) : status === "finished" ? (
            <Check size={13} />
          ) : status === "error" ? (
            <TriangleAlert size={12} />
          ) : (
            <span className="status-dot" />
          )}
          <span>{statusLabels[status]}</span>
        </span>
      </header>

      <div className="lane-metrics">
        <div>
          <span className="metric-label">
            Model time{" "}
            <span
              title={
                sample
                  ? "Scripted illustration; not measured model latency."
                  : "Total time waiting for this lane's model API requests."
              }
              className="metric-hint"
            >
              {sample ? "simulated" : "measured"}
            </span>
          </span>
          <strong>
            {hasStarted ? (
              formatTime(lane.modelMs)
            ) : (
              <span className="metric-empty">—</span>
            )}
          </strong>
        </div>
        <div>
          <span className="metric-label">
            Elapsed{" "}
            <span
              title={
                sample
                  ? "Scripted illustration; not a benchmark."
                  : "End-to-end lane time, including model calls and article retrieval."
              }
              className="metric-hint"
            >
              {sample ? "simulated" : "total"}
            </span>
          </span>
          <strong>
            {hasStarted ? (
              formatTime(lane.elapsedMs)
            ) : (
              <span className="metric-empty">—</span>
            )}
          </strong>
        </div>
        <div>
          <span className="metric-label">Hops</span>
          <strong>
            {lane.hops.length}
            <small> / {config.maxHops}</small>
          </strong>
        </div>
      </div>

      <div className={`article-preview ${!lane.current ? "article-idle" : ""}`}>
        <div className="article-kicker">
          <span>
            <BookOpen size={13} />
            {lane.current ? "Current article" : "Starting article"}
          </span>
          {lane.current && (
            <a
              href={lane.current.url}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${lane.current.title} on Wikipedia`}
            >
              <ArrowUpRight size={16} />
            </a>
          )}
        </div>
        <h4>{lane.current?.title || config.start}</h4>
        <p>
          {lane.current?.extract ||
            (unavailable
              ? `Connect ${lane.provider === "jev" ? "Jev" : "OpenRouter"} to include this model in a live race.`
              : "Every destination begins with a single link. Start the race to see where this model goes next.")}
        </p>
        {status === "finished" && (
          <div className="arrival">
            <Flag size={13} />
            <span>Arrived at {lane.current?.title || config.target}</span>
            {place !== null && <strong>#{place}</strong>}
          </div>
        )}
        {lane.error && (
          <p className="lane-error" role="alert">
            {lane.error}
          </p>
        )}
      </div>

      <div className="path-section">
        <div className="path-label">
          <Route size={13} /> Article trail
        </div>
        <ol className="article-trail">
          {path.map((title, index) => (
            <li key={`${index}-${title}`}>
              {index > 0 && <ChevronRight size={11} aria-hidden="true" />}
              <a
                href={articleUrl(title)}
                target="_blank"
                rel="noreferrer"
                className={index === path.length - 1 ? "trail-current" : ""}
              >
                {title}
              </a>
            </li>
          ))}
        </ol>
      </div>

      {decision ? (
        <details className="decision-details">
          <summary>
            <span>
              <CircleDot size={14} />
              Decision log{" "}
              <span className="decision-count">#{lane.hops.length}</span>
            </span>
            <ChevronDown size={15} />
          </summary>
          <div className="decision-body">
            <label className="decision-meta">
              Inspect move
              <select
                aria-label={`${lane.name} decision to inspect`}
                value={
                  inspection && inspection.startedAt === lane.startedAt
                    ? inspectedIndex
                    : "latest"
                }
                onChange={(event) =>
                  setInspection(
                    event.target.value === "latest"
                      ? null
                      : {
                          startedAt: lane.startedAt,
                          index: Number(event.target.value),
                        },
                  )
                }
              >
                <option value="latest">Latest move</option>
                {lane.hops.map((hop, index) => (
                  <option key={index} value={index}>
                    #{index + 1} · {hop.to}
                  </option>
                ))}
              </select>
            </label>
            <div className="decision-route">
              <span>{decision.from}</span>
              <ArrowDown size={13} />
              <strong>{decision.to}</strong>
            </div>
            <div className="decision-meta">
              <span>{decision.candidates} available links</span>
              <span>
                {decision.method === "direct"
                  ? "Direct target link"
                  : decision.method === "sample"
                    ? "Scripted choice"
                    : decision.method === "rank+choice"
                      ? "Rank + choice"
                      : "Model choice"}
              </span>
            </div>
            {decision.choices.length > 0 ? (
              <>
                <p className="probability-label">
                  {sample
                    ? "Illustrative choice weights"
                    : lane.provider === "jev"
                      ? "Returned choice probabilities"
                      : "Returned choice scores"}
                </p>
                <div className="choice-list">
                  {decision.choices.slice(0, 6).map((choice) => (
                    <div className="choice-row" key={choice.title}>
                      <div>
                        <span>{choice.title}</span>
                        <span>{(choice.probability * 100).toFixed(1)}%</span>
                      </div>
                      <span className="probability-track">
                        <span
                          style={{
                            width: `${Math.max(0, Math.min(100, choice.probability * 100))}%`,
                          }}
                        />
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="decision-note">
                {decision.method === "direct"
                  ? "The destination is linked from this article. No model call was needed."
                  : "This provider did not return a probability distribution."}
              </p>
            )}
            <p className="decision-note">
              {decision.modelCalls} model{" "}
              {decision.modelCalls === 1 ? "call" : "calls"} ·{" "}
              {formatTime(decision.modelMs)}
              {decision.inputTokens !== null
                ? ` · ${decision.inputTokens.toLocaleString()} input tokens`
                : ""}
              {sample ? " · simulated" : ""}
            </p>
          </div>
        </details>
      ) : (
        <div className="decision-placeholder">
          <CircleDot size={14} />
          <span>
            {unavailable
              ? "Provider not configured"
              : active
                ? "Waiting for the first decision…"
                : "Decisions appear here as the race unfolds"}
          </span>
        </div>
      )}
    </article>
  );
}
