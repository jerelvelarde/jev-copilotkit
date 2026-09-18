"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  CopilotKitProvider,
  useAgent,
  useCopilotKit,
} from "@copilotkit/react-core/v2";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  Circle,
  Flag,
  FlaskConical,
  Info,
  LoaderCircle,
  Play,
  Radio,
  RotateCcw,
  Square,
  TriangleAlert,
  Waypoints,
  X,
} from "lucide-react";
import {
  DEFAULT_CONFIG,
  DEFAULT_LANES,
  initialRace,
  raceConfigSchema,
  type LaneDefinition,
  type RaceConfig,
  type RaceState,
} from "@/lib/race/types";
import { LaneCard } from "./lane-card";
import {
  interruptRace,
  runWithRaceLifecycle,
  selectRaceState,
} from "./race-lifecycle";

const CHALLENGES = [
  { start: "Coffee", target: "Napoleon", label: "The breakfast detour" },
  { start: "Rubber duck", target: "Moon", label: "A small giant leap" },
  { start: "Jazz", target: "Antarctica", label: "The coolest route" },
];

export function WikiRace() {
  const [connectionError, setConnectionError] = useState<string | null>(null);
  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      agentId="wiki_race"
      enableInspector={false}
      onError={({ error }) => setConnectionError(error.message)}
    >
      <RaceBoard
        connectionError={connectionError}
        clearConnectionError={() => setConnectionError(null)}
      />
    </CopilotKitProvider>
  );
}

function RaceBoard({
  connectionError,
  clearConnectionError,
}: {
  connectionError: string | null;
  clearConnectionError: () => void;
}) {
  const { agent, isReady } = useAgent({ agentId: "wiki_race" });
  const { copilotkit } = useCopilotKit();
  const [config, setConfig] = useState<RaceConfig>(DEFAULT_CONFIG);
  const [definitions, setDefinitions] =
    useState<LaneDefinition[]>(DEFAULT_LANES);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stoppedState, setStoppedState] = useState<RaceState | null>(null);
  const cancelled = useRef(false);
  const activeRun = useRef(false);
  const race = selectRaceState(
    agent.state,
    stoppedState,
    initialRace(config, definitions),
  );
  const running = pending || race.status === "running";
  const sample = config.mode === "sample";
  const readyLanes = definitions.filter(
    (lane) => sample || lane.available,
  ).length;
  const finished = race.lanes
    .filter((lane) => lane.status === "finished")
    .sort((a, b) => a.elapsedMs - b.elapsedMs);
  const stateConfig = race.runId ? race.config : config;

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/config", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            "Could not check provider configuration. Reload to try again.",
          );
        const data: { lanes: LaneDefinition[] } = await response.json();
        setDefinitions(data.lanes);
        setConfigLoaded(true);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load provider configuration.",
          );
      });
    return () => controller.abort();
  }, []);

  function updateConfig(next: RaceConfig) {
    if (running) return;
    setConfig(next);
    setStoppedState(null);
    setError(null);
    agent.setState(initialRace(next, definitions));
  }

  async function startRace() {
    if (activeRun.current) return;
    const parsed = raceConfigSchema.safeParse(config);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message || "Check the article titles.");
      return;
    }
    if (!isReady) {
      setError(
        "The race runtime is still connecting. Please try again in a moment.",
      );
      return;
    }
    if (readyLanes === 0) {
      setError(
        "Add a Jev or OpenRouter API key to run a live race, or select Sample.",
      );
      return;
    }
    const next = initialRace(parsed.data, definitions);
    next.runId = crypto.randomUUID();
    next.status = "running";
    next.lanes = next.lanes.map((lane) => ({
      ...lane,
      status: sample || lane.available ? "loading" : "unavailable",
    }));
    activeRun.current = true;
    cancelled.current = false;
    setStopping(false);
    setPending(true);
    setError(null);
    clearConnectionError();
    setStoppedState(null);
    agent.setState(next);
    try {
      await runWithRaceLifecycle({
        agent,
        initialState: next,
        isCancelled: () => cancelled.current,
        onError: setError,
        onFallback: setStoppedState,
        run: () =>
          copilotkit.runAgent({
            agent,
            forwardedProps: { config: parsed.data },
            runId: next.runId,
          }),
      });
    } finally {
      activeRun.current = false;
      setPending(false);
      setStopping(false);
    }
  }

  function stopRace() {
    cancelled.current = true;
    setStopping(true);
    copilotkit.stopAgent({ agent });
    setStoppedState(interruptRace(race));
  }

  function resetRace() {
    if (running) return;
    setStoppedState(null);
    setError(null);
    clearConnectionError();
    agent.setState(initialRace(config, definitions));
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <Link
          className="brand"
          href="/"
          aria-label="CopilotKit and Jev Wiki race home"
        >
          <Image
            src="/copilotkit-logo.svg"
            alt="CopilotKit"
            width={167}
            height={32}
            priority
          />
          <X size={14} aria-hidden="true" />
          <span className="jev-wordmark">
            jev<span>.</span>
          </span>
        </Link>
        <div className="header-right">
          <span className="lab-badge">
            <FlaskConical size={12} />
            Agent lab
          </span>
          <a
            href="https://typesafe.ai/blog/introducing-system-one-models-and-jev"
            target="_blank"
            rel="noreferrer"
            className="text-link"
          >
            Meet Jev <ArrowUpRight size={15} />
          </a>
        </div>
      </header>

      <main>
        <section className="hero" aria-labelledby="page-title">
          <div className="hero-copy">
            <div className="eyebrow">
              <span />
              Same start. Different minds.
            </div>
            <h1 id="page-title">
              Wiki race<span className="title-dot">.</span>
            </h1>
            <p>
              One starting page. One destination.
              <br className="mobile-break" /> Let the links lead the way.
            </p>
          </div>
          <div className="hero-route" aria-hidden="true">
            <div className="route-orbit">
              <span className="orbit-node orbit-one" />
              <span className="orbit-node orbit-two" />
              <span className="orbit-node orbit-three" />
              <span className="orbit-node orbit-four" />
              <span className="orbit-node orbit-five" />
              <span className="orbit-center">W</span>
              <span className="orbit-flag">
                <Flag size={19} />
              </span>
            </div>
            <span className="hero-annotation">A world of possible paths</span>
          </div>
        </section>

        <section className="race-controls" aria-label="Set up a Wikipedia race">
          <div className="controls-top">
            <div className="control-heading">
              <Waypoints size={17} />
              <h2>Choose your challenge</h2>
            </div>
            <div className="mode-switch" role="group" aria-label="Race mode">
              <button
                type="button"
                aria-pressed={sample}
                disabled={running}
                className={sample ? "mode-active" : ""}
                onClick={() =>
                  updateConfig({
                    ...DEFAULT_CONFIG,
                    mode: "sample",
                    maxHops: config.maxHops,
                  })
                }
              >
                <FlaskConical size={13} />
                Sample
              </button>
              <button
                type="button"
                aria-pressed={!sample}
                disabled={running}
                className={!sample ? "mode-active" : ""}
                onClick={() => updateConfig({ ...config, mode: "live" })}
              >
                <Radio size={13} />
                Live
              </button>
            </div>
          </div>

          <form
            className="challenge-form"
            onSubmit={(event) => {
              event.preventDefault();
              void startRace();
            }}
          >
            <div className="article-input">
              <label htmlFor="start-article">
                <Circle size={12} />
                Start here
              </label>
              <input
                id="start-article"
                value={config.start}
                onChange={(event) =>
                  updateConfig({ ...config, start: event.target.value })
                }
                readOnly={sample}
                disabled={running}
                maxLength={200}
                required
                autoComplete="off"
                spellCheck={false}
                placeholder="Starting article"
              />
            </div>
            <span className="input-direction" aria-hidden="true">
              <ArrowRight size={23} />
            </span>
            <div className="article-input">
              <label htmlFor="target-article">
                <Flag size={12} />
                Get to
              </label>
              <input
                id="target-article"
                value={config.target}
                onChange={(event) =>
                  updateConfig({ ...config, target: event.target.value })
                }
                readOnly={sample}
                disabled={running}
                maxLength={200}
                required
                autoComplete="off"
                spellCheck={false}
                placeholder="Destination article"
              />
            </div>
            {running ? (
              <button
                type="button"
                className="start-button stop-button"
                onClick={stopRace}
                disabled={stopping}
              >
                <Square size={15} fill="currentColor" />
                {stopping ? "Stopping…" : "Stop race"}
              </button>
            ) : (
              <button
                type="submit"
                className="start-button"
                disabled={
                  !isReady || (!sample && (!configLoaded || readyLanes === 0))
                }
              >
                {!isReady ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <Play size={16} fill="currentColor" />
                )}
                {!isReady ? "Connecting…" : "Start race"}
                <ArrowRight size={16} />
              </button>
            )}
          </form>

          <div className="challenge-bottom">
            <div className="challenge-presets">
              <span>Try a route</span>
              {CHALLENGES.map((challenge) => (
                <button
                  type="button"
                  key={challenge.start}
                  title={challenge.label}
                  disabled={running}
                  className={
                    config.start === challenge.start &&
                    config.target === challenge.target
                      ? "preset-active"
                      : ""
                  }
                  onClick={() =>
                    updateConfig({
                      ...config,
                      start: challenge.start,
                      target: challenge.target,
                    })
                  }
                >
                  {challenge.start}
                  <ArrowRight size={11} />
                  {challenge.target}
                </button>
              ))}
            </div>
            <label className="hop-limit" htmlFor="hop-limit">
              <select
                id="hop-limit"
                value={config.maxHops}
                disabled={running}
                onChange={(event) =>
                  updateConfig({
                    ...config,
                    maxHops: Number(event.target.value),
                  })
                }
              >
                {[8, 12, 20].map((value) => (
                  <option value={value} key={value}>
                    {value} hop limit
                  </option>
                ))}
              </select>
              <ChevronDown size={12} />
            </label>
          </div>
        </section>

        <div className={`mode-note ${sample ? "sample-note" : "live-note"}`}>
          <Info size={15} />
          <p>
            {sample ? (
              <>
                <strong>Sample mode.</strong> Scripted paths and simulated
                timings to explore the experience. No model calls or benchmark
                results.
              </>
            ) : (
              <>
                <strong>Live mode.</strong> Real Wikipedia links and measured
                model requests. {readyLanes} of {definitions.length} models
                configured.
              </>
            )}
          </p>
        </div>
        {!sample && configLoaded && readyLanes < definitions.length && (
          <details className="setup-note">
            <summary>
              Connect models <ChevronDown size={13} />
            </summary>
            <p>
              Add <code>TYPESAFE_API_KEY</code> for Jev and{" "}
              <code>OPENROUTER_API_KEY</code> for the other models to the
              server’s <code>.env.local</code>, then restart the app. Available
              models can race independently. Keys stay on the server.
            </p>
          </details>
        )}

        {(error || connectionError) && (
          <div className="error-banner" role="alert">
            <TriangleAlert size={18} />
            <div>
              <strong>
                {connectionError && !isReady
                  ? "The race runtime could not connect"
                  : "Something interrupted the race"}
              </strong>
              <p>{error || connectionError}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setError(null);
                clearConnectionError();
              }}
              aria-label="Dismiss error"
            >
              <X size={17} />
            </button>
          </div>
        )}

        <section className="race-section" aria-labelledby="racers-title">
          <div className="race-section-heading">
            <div>
              <h2 id="racers-title">
                {running
                  ? "The race is on"
                  : race.status === "complete"
                    ? "The routes are in"
                    : race.status === "cancelled"
                      ? "A pause along the way"
                      : "At the starting line"}
                {running ? (
                  <span className="live-indicator">Racing</span>
                ) : race.status === "complete" ? (
                  <span className="complete-indicator">
                    <Check size={12} />
                    Complete
                  </span>
                ) : race.status === "cancelled" ? (
                  <span className="stopped-indicator">Stopped</span>
                ) : null}
              </h2>
              <p>
                {running
                  ? `Finding a way from ${stateConfig.start} to ${stateConfig.target}.`
                  : race.status === "complete"
                    ? `${finished.length} of ${readyLanes} racers reached ${stateConfig.target}. Explore their paths below.`
                    : "Four perspectives. A whole encyclopedia between them."}
              </p>
            </div>
            <button
              className="reset-button"
              type="button"
              onClick={resetRace}
              disabled={running || race.status === "idle"}
            >
              <RotateCcw size={14} />
              Reset
            </button>
          </div>
          <div className="race-grid">
            {race.lanes.map((lane) => (
              <LaneCard
                key={lane.id}
                lane={lane}
                config={stateConfig}
                place={
                  lane.status === "finished"
                    ? finished.findIndex((item) => item.id === lane.id) + 1
                    : null
                }
              />
            ))}
          </div>
          <p className="race-announcement" aria-live="polite" role="status">
            {running
              ? "Race in progress."
              : race.status === "complete"
                ? `Race complete. ${finished.length} racers reached the destination.`
                : race.status === "cancelled"
                  ? "Race stopped. Your paths are preserved."
                  : "Ready to start a race."}
          </p>
        </section>

        <section className="how-it-works" aria-labelledby="how-title">
          <div className="how-intro">
            <span className="eyebrow">The shortest explanation</span>
            <h2 id="how-title">
              Follow links.
              <br />
              Find a way.
            </h2>
          </div>
          <div className="how-step">
            <span className="step-number">01</span>
            <h3>Same starting point</h3>
            <p>
              Every model opens the same article, with the same destination in
              mind.
            </p>
          </div>
          <div className="how-step">
            <span className="step-number">02</span>
            <h3>One link at a time</h3>
            <p>
              Each model picks from that article’s links. Every hop takes it
              somewhere new.
            </p>
          </div>
          <div className="how-step">
            <span className="step-number">03</span>
            <h3>Watch the decisions</h3>
            <p>
              Compare paths and inspect each move. A direct link to the target
              ends the race.
            </p>
          </div>
        </section>

        <details className="methodology">
          <summary>
            <Info size={14} />
            <span>A note on the numbers</span>
            <ChevronDown size={14} />
          </summary>
          <div>
            <p>
              Sample races use fixed paths and simulated numbers. Live races
              show model request time separately from end-to-end elapsed time.
              Article retrieval uses a shared cache within each race, so elapsed
              time includes network and cache effects. This is an interactive
              demo, not a controlled benchmark.
            </p>
            <p>
              In Live mode, Jev chooses from up to 255 links. Larger sets are
              ranked in batches before a final choice. Baseline models receive
              the full candidate list within the app’s page limit. A direct
              target link requires no model call. All models follow article
              links and avoid visited pages.
            </p>
          </div>
        </details>
      </main>

      <footer className="site-footer">
        <p>
          Agent state, brought to life with{" "}
          <a href="https://copilotkit.ai" target="_blank" rel="noreferrer">
            CopilotKit <ArrowUpRight size={12} />
          </a>
        </p>
        <div>
          <a
            href="https://en.wikipedia.org/wiki/Wikipedia:Wikirace"
            target="_blank"
            rel="noreferrer"
          >
            What’s a wiki race? <ArrowUpRight size={12} />
          </a>
          <span>
            Articles from{" "}
            <a href="https://en.wikipedia.org" target="_blank" rel="noreferrer">
              Wikipedia
            </a>{" "}
            ·{" "}
            <a
              href="https://creativecommons.org/licenses/by-sa/4.0/"
              target="_blank"
              rel="noreferrer"
            >
              CC BY-SA
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}
