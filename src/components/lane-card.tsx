"use client";

import { useState } from "react";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";
import { articleUrl, type LaneState } from "../lib/race/types";
import { arenaKeyName } from "../lib/tool-bench/lanes";

export function formatTime(ms: number) {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`;
}

const statusLabels: Record<LaneState["status"], string> = {
  ready: "Ready",
  loading: "Reading article",
  thinking: "Choosing a link",
  finished: "Complete",
  exhausted: "Race limit reached",
  error: "Lane failed",
  cancelled: "Stopped",
  unavailable: "Key needed",
};

export function LaneCard({
  lane,
  place,
}: {
  lane: LaneState;
  place: number | null;
}) {
  const unavailable = !lane.available;
  const status = unavailable ? "unavailable" : lane.status;
  const active = status === "loading" || status === "thinking";
  const [inspection, setInspection] = useState<{
    startedAt: number | null;
    index: number;
  } | null>(null);
  const selected =
    inspection && inspection.startedAt === lane.startedAt
      ? Math.min(inspection.index, lane.hops.length - 1)
      : lane.hops.length - 1;
  const decision = lane.hops[selected];

  return (
    <article
      className={`arena-lane arena-lane-${lane.id} ${active ? "lane-active" : ""} ${status === "finished" ? "lane-complete" : ""}`}
      aria-label={`${lane.name} race lane`}
    >
      <header className="lane-header">
        <div className="lane-heading">
          <h2>{lane.name}</h2>
          {place !== null && (
            <span className="finish-place">
              <Check size={11} /> #{place}
            </span>
          )}
        </div>
        <div className="lane-stats">
          <span className={`lane-status lane-status-${status}`}>
            {active ? (
              <LoaderCircle size={10} className="spin" />
            ) : status === "error" ? (
              <TriangleAlert size={10} />
            ) : status === "finished" ? (
              <Check size={11} strokeWidth={2.5} />
            ) : (
              <span className="status-dot" />
            )}
            {statusLabels[status]}
          </span>
          <span>
            {lane.hops.length} {lane.hops.length === 1 ? "hop" : "hops"}
          </span>
          <span>{formatTime(lane.modelMs)} model</span>
          <span className="lane-elapsed">
            {formatTime(lane.elapsedMs)} elapsed
          </span>
        </div>
      </header>

      {!lane.current ? (
        <div className="lane-ready">
          <h3>{lane.name}</h3>
          <p>{statusLabels[status]}</p>
          <span className="lane-model-id">{lane.model}</span>
          {unavailable && (
            <p className="lane-empty-note">
              Configure {arenaKeyName(lane)} in setup.
            </p>
          )}
          {lane.error && (
            <p className="lane-empty-note" role="alert">
              {lane.error}
            </p>
          )}
        </div>
      ) : (
        <div className="lane-scroll">
          <div className="article-toolbar">
            <span>Wikipedia</span>
            <a
              href={lane.current.url}
              target="_blank"
              rel="noreferrer"
              aria-label={`Open ${lane.current.title} on Wikipedia`}
            >
              Open article <ArrowUpRight size={12} />
            </a>
          </div>
          <div className="lane-article">
            <h3>{lane.current.title}</h3>
            <p>{lane.current.extract}</p>
          </div>
          {lane.error && (
            <p className="lane-error" role="alert">
              {lane.error}
            </p>
          )}
          <ol className="lane-trail" aria-label="Article trail">
            {lane.path.map((title, index) => (
              <li key={`${index}-${title}`}>
                {index > 0 && <ChevronRight size={10} aria-hidden="true" />}
                <a
                  href={articleUrl(title)}
                  target="_blank"
                  rel="noreferrer"
                  className={
                    index === lane.path.length - 1 ? "trail-current" : ""
                  }
                >
                  {title}
                </a>
              </li>
            ))}
          </ol>
          {decision && (
            <details className="decision-details">
              <summary>
                <span>
                  <CircleDot size={12} /> Decision log{" "}
                  <span className="decision-count">{lane.hops.length}</span>
                </span>
                <ChevronDown size={13} />
              </summary>
              <div className="decision-body">
                <label className="decision-select">
                  Inspect move
                  <select
                    aria-label={`${lane.name} decision to inspect`}
                    value={
                      inspection && inspection.startedAt === lane.startedAt
                        ? selected
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
                  <ChevronRight size={12} />
                  <strong>{decision.to}</strong>
                </div>
                <p className="decision-meta">
                  {decision.candidates} available links ·{" "}
                  {decision.method === "direct"
                    ? "Direct target link"
                    : decision.method === "rank+choice"
                      ? "Rank + choice"
                      : "Model choice"}
                </p>
                {decision.choices.length > 0 ? (
                  <div className="choice-list">
                    <p>Returned choice probabilities</p>
                    {decision.choices.map((choice) => (
                      <div className="choice-row" key={choice.title}>
                        <div>
                          <span>{choice.title}</span>
                          <span>{(choice.probability * 100).toFixed(1)}%</span>
                        </div>
                        <span className="probability-track">
                          <span
                            style={{ width: `${choice.probability * 100}%` }}
                          />
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="decision-note">
                    {decision.method === "direct"
                      ? "The target is linked here. No model call was needed."
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
                </p>
              </div>
            </details>
          )}
        </div>
      )}
    </article>
  );
}
