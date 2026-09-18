"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import {
  CopilotKitProvider,
  useAgent,
  useCopilotKit,
} from "@copilotkit/react-core/v2";
import {
  ArrowRight,
  Flag,
  FlaskConical,
  LoaderCircle,
  Radio,
  RotateCcw,
  Settings2,
  Square,
  TriangleAlert,
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

import { RaceSetup } from "./race-setup";
import { RaceClock, RaceTimeline } from "./race-metrics";

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
  const [setupOpen, setSetupOpen] = useState(false);
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

  const canStart = isReady && (sample || (configLoaded && readyLanes > 0));
  const idle = !race.runId;

  return (
    <main className="arena" aria-label="Wikipedia race arena">
      <header className="arena-header">
        <div className="arena-brand">
          <Image
            src="/copilotkit-logo-dark.svg"
            alt="CopilotKit"
            width={146}
            height={28}
            priority
          />
          <span className="brand-times" aria-hidden="true">
            ×
          </span>
          <span className="arena-jev">jev.</span>
          <h1>Wiki race</h1>
        </div>
        <button
          className="arena-course"
          onClick={() => setSetupOpen(true)}
          disabled={running}
          aria-label="Change race setup"
        >
          <span title={stateConfig.start}>{stateConfig.start}</span>
          <ArrowRight size={14} aria-hidden="true" />
          <span title={stateConfig.target}>{stateConfig.target}</span>
        </button>
        <div className="arena-actions">
          <RaceClock race={race} running={running} />
          {running ? (
            <button
              className="toolbar-button stop-control"
              onClick={stopRace}
              disabled={stopping}
            >
              <Square size={12} fill="currentColor" />{" "}
              {stopping ? "Stopping…" : "Stop"}
            </button>
          ) : !idle ? (
            <button
              className="toolbar-button"
              onClick={() => void startRace()}
              disabled={!canStart}
            >
              <RotateCcw size={14} /> Race again
            </button>
          ) : null}
          <button
            className="toolbar-button setup-control"
            aria-label="Set up race"
            onClick={() => setSetupOpen(true)}
            disabled={running}
          >
            <Settings2 size={14} /> <span>Setup</span>
          </button>
        </div>
      </header>

      <div className="arena-statusline">
        <span className="mode-disclosure">
          {sample ? <FlaskConical size={12} /> : <Radio size={12} />}
          {sample
            ? "Sample · scripted paths and simulated timings"
            : `Live · ${readyLanes} of ${definitions.length} models configured`}
        </span>
        <span className="arena-race-status" role="status" aria-live="polite">
          {running
            ? "Race in progress"
            : race.status === "complete"
              ? `${finished.length} / ${readyLanes} reached the destination`
              : race.status === "cancelled"
                ? "Race stopped · paths preserved"
                : "Four racers. One destination."}
        </span>
      </div>

      {(error || connectionError) && (
        <div className="arena-error" role="alert">
          <TriangleAlert size={16} />
          <p>{error || connectionError}</p>
          <button
            onClick={() => {
              setError(null);
              clearConnectionError();
            }}
            aria-label="Dismiss error"
          >
            <X size={16} />
          </button>
        </div>
      )}

      <section
        className={`arena-grid ${idle ? "arena-grid-ready" : ""}`}
        aria-label="Four model race lanes"
      >
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
        {idle && (
          <div className="arena-launch">
            <button
              className="go-button"
              onClick={() => void startRace()}
              disabled={!canStart}
            >
              {!isReady ? (
                <LoaderCircle size={25} className="spin" />
              ) : (
                <Flag size={25} />
              )}
              {!isReady ? "Connecting" : "Go!"}
            </button>
            <button
              className="back-to-setup"
              onClick={() => setSetupOpen(true)}
            >
              {!sample && readyLanes === 0 ? "Connect models" : "Back to setup"}
            </button>
          </div>
        )}
      </section>

      <RaceTimeline race={race} />
      <RaceSetup
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
        config={config}
        onConfigChange={updateConfig}
        readyLanes={readyLanes}
      />
    </main>
  );
}
