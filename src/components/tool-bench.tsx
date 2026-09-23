"use client";

import Image from "next/image";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  CopilotKitProvider,
  useAgent,
  useCopilotKit,
} from "@copilotkit/react-core/v2";
import {
  ArrowLeft,
  FlaskConical,
  LoaderCircle,
  MessagesSquare,
  Play,
  Radio,
  RotateCcw,
  Square,
  TriangleAlert,
  Waypoints,
  X,
} from "lucide-react";
import { ARENA_LANES } from "@/lib/tool-bench/lanes";
import type { ArenaConfig, ArenaLaneState } from "@/lib/tool-bench/types";
import { ToolArenaGraph } from "./tool-arena-graph";
import { ToolArenaLane } from "./tool-arena-lane";
import { ToolArenaSummary } from "./tool-arena-summary";
import { ArenaClock } from "./tool-bench-metrics";
import {
  createArenaRun,
  idleArenaLane,
  interruptLane,
  isArenaComplete,
  isArenaLaneState,
  isTerminalLane,
  launchArena,
  runWithLaneLifecycle,
  selectLaneState,
  stopArena,
  withAgentIds,
  withRenderCommit,
  type ArenaController,
  type ArenaLane,
  type ArenaLaneDefinition,
  type ArenaRun,
  type ArenaRunProps,
  type RenderOverlay,
} from "./tool-bench-lifecycle";
import "./tool-bench.css";

type BenchCaseOption = { id: string; prompt: string };
type ArenaView = "ui" | "graph";

export function ToolBench() {
  const [connectionError, setConnectionError] = useState<string | null>(null);
  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      enableInspector={false}
      onError={({ error }) => setConnectionError(error.message)}
    >
      <ToolArenaBoard
        connectionError={connectionError}
        clearConnectionError={() => setConnectionError(null)}
      />
    </CopilotKitProvider>
  );
}

function ToolArenaBoard({
  connectionError,
  clearConnectionError,
}: {
  connectionError: string | null;
  clearConnectionError: () => void;
}) {
  const [definitions, setDefinitions] = useState<ArenaLaneDefinition[]>(() =>
    withAgentIds(ARENA_LANES),
  );
  const [cases, setCases] = useState<BenchCaseOption[]>([]);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [mode, setMode] = useState<ArenaConfig["mode"]>("sample");
  const [caseId, setCaseId] = useState("");
  const [view, setView] = useState<ArenaView>("ui");
  const [run, setRun] = useState<ArenaRun | null>(null);
  const [lanes, setLanes] = useState<Record<string, ArenaLane>>({});
  const [ready, setReady] = useState<Record<string, boolean>>({});
  const [pending, setPending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  const controllers = useRef(new Map<string, ArenaController>());
  const activeRun = useRef(false);

  const register = useCallback((controller: ArenaController) => {
    controllers.current.set(controller.definition.id, controller);
    return () => {
      if (controllers.current.get(controller.definition.id) === controller)
        controllers.current.delete(controller.definition.id);
    };
  }, []);
  const publishLane = useCallback((lane: ArenaLane) => {
    setLanes((current) => ({ ...current, [lane.id]: lane }));
  }, []);
  const publishReady = useCallback((laneId: string, isReady: boolean) => {
    setReady((current) =>
      current[laneId] === isReady ? current : { ...current, [laneId]: isReady },
    );
  }, []);

  const sample = (run?.config.mode ?? mode) === "sample";
  const participating = definitions.filter(
    (lane) => sample || lane.available,
  ).length;
  const laneStates = useMemo(
    () =>
      definitions.map(
        (definition) =>
          lanes[definition.id] ?? idleArenaLane(definition, sample),
      ),
    [definitions, lanes, sample],
  );
  const complete = Boolean(run) && isArenaComplete(laneStates);
  const running = pending || (Boolean(run) && !complete);
  const allReady = definitions.every((lane) => ready[lane.id]);
  const selectedCase = cases.find((item) => item.id === caseId) ?? null;
  const canStart =
    allReady &&
    Boolean(caseId) &&
    (sample || (configLoaded && participating > 0));

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/config", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            "Could not check provider configuration. Reload to retry.",
          );
        const data: {
          lanes: ArenaLaneDefinition[];
          cases: BenchCaseOption[];
        } = await response.json();
        setDefinitions(data.lanes);
        setCases(data.cases);
        setCaseId((current) => current || (data.cases[0]?.id ?? ""));
        if (
          data.lanes.length === 4 &&
          data.lanes.every((lane) => lane.available)
        )
          setMode("live");
        setConfigLoaded(true);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load the arena configuration.",
          );
      });
    return () => controller.abort();
  }, []);

  function reset() {
    if (activeRun.current) return;
    setRun(null);
    setLanes({});
    setStartedAt(null);
    setFinishedAt(null);
    setError(null);
    clearConnectionError();
  }

  async function start() {
    if (activeRun.current) return;
    if (!caseId) {
      setError("Choose the support request every agent should answer.");
      return;
    }
    if (!allReady) {
      setError("The arena runtime is still connecting. Try again in a moment.");
      return;
    }
    if (!sample && (!configLoaded || participating === 0)) {
      setError(
        "Set a server API key for Jev, OpenAI, Anthropic, or Google and restart, or select Sample.",
      );
      return;
    }
    const specification = createArenaRun(mode, caseId, definitions, {
      prompt: selectedCase?.prompt,
    });
    activeRun.current = true;
    setPending(true);
    setStopping(false);
    setError(null);
    clearConnectionError();
    setRun(specification);
    setLanes(
      Object.fromEntries(specification.lanes.map((lane) => [lane.id, lane])),
    );
    setStartedAt(performance.now());
    setFinishedAt(null);
    try {
      // Every lane promise settles exactly when that agent reaches a terminal
      // state, so this is the honest end of the race, not a polled guess.
      await launchArena([...controllers.current.values()], {
        config: specification.config,
        runId: specification.runId,
        prompt: selectedCase?.prompt,
      });
      setFinishedAt(performance.now());
    } finally {
      activeRun.current = false;
      setPending(false);
      setStopping(false);
    }
  }

  function stop() {
    setStopping(true);
    stopArena([...controllers.current.values()]);
  }

  return (
    <main className="tb-arena" aria-label="Tool calling arena">
      {definitions.map((definition) => (
        <LaneAgent
          key={definition.agentId}
          definition={definition}
          sample={sample}
          run={run}
          register={register}
          onState={publishLane}
          onReady={publishReady}
          onError={setError}
        />
      ))}
      <header className="tb-header">
        <div className="tb-brand">
          <Image
            src="/copilotkit-logo-dark.svg"
            alt="CopilotKit"
            width={146}
            height={28}
            loading="eager"
          />
          <span aria-hidden="true">×</span>
          <span className="tb-jev">jev.</span>
          <h1>Tool-call arena</h1>
        </div>
        <div className="tb-controls">
          <fieldset disabled={running} className="tb-mode">
            <legend className="tb-sr-only">Arena mode</legend>
            <button
              aria-pressed={mode === "sample"}
              onClick={() => {
                setMode("sample");
                reset();
              }}
            >
              <FlaskConical size={12} />
              Sample
            </button>
            <button
              aria-pressed={mode === "live"}
              onClick={() => {
                setMode("live");
                reset();
              }}
            >
              <Radio size={12} />
              Live
            </button>
          </fieldset>
          <label className="tb-case">
            <span className="tb-sr-only">Support request</span>
            <select
              disabled={running || cases.length === 0}
              value={run?.config.caseId ?? caseId}
              onChange={(event) => {
                setCaseId(event.target.value);
                reset();
              }}
            >
              {cases.length === 0 && (
                <option value="">Loading requests…</option>
              )}
              {cases.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.id}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="tb-view">
            <legend className="tb-sr-only">Arena view</legend>
            <button
              aria-pressed={view === "ui"}
              onClick={() => setView("ui")}
              title="Conversation view"
            >
              <MessagesSquare size={12} />
              UI
            </button>
            <button
              aria-pressed={view === "graph"}
              onClick={() => setView("graph")}
              title="Execution trace"
            >
              <Waypoints size={12} />
              Graph
            </button>
          </fieldset>
        </div>
        <div className="tb-actions">
          <ArenaClock startedAt={startedAt} finishedAt={finishedAt} />
          {running ? (
            <button
              className="tb-button tb-stop"
              onClick={stop}
              disabled={stopping}
            >
              <Square size={12} fill="currentColor" />
              {stopping ? "Stopping…" : "Stop"}
            </button>
          ) : (
            run && (
              <>
                <button
                  className="tb-button"
                  onClick={() => void start()}
                  disabled={!canStart}
                >
                  <RotateCcw size={13} />
                  Race again
                </button>
                <button className="tb-button tb-reset" onClick={reset}>
                  Reset
                </button>
              </>
            )
          )}
          <Link href="/" className="tb-back">
            <ArrowLeft size={12} />
            Wiki race
          </Link>
        </div>
      </header>
      <div className="tb-statusline">
        <span>
          {sample ? <FlaskConical size={12} /> : <Radio size={12} />}
          {sample
            ? "Sample · synthetic decisions and authored delays · not a measurement"
            : `Live · ${participating}/${definitions.length} agents configured · tools run locally`}
        </span>
        <span role="status" aria-live="polite">
          {running
            ? "Four agents answering the same request"
            : complete
              ? `${laneStates.filter((lane) => lane.status === "complete").length}/${participating} agents finished`
              : "One request. Four agents. Every tool call executed and scored."}
        </span>
      </div>
      {selectedCase && (
        <p className="tb-prompt-preview">{selectedCase.prompt}</p>
      )}
      {(error || connectionError) && (
        <div className="tb-error" role="alert">
          <TriangleAlert size={15} />
          <p>{error || connectionError}</p>
          <button
            aria-label="Dismiss error"
            onClick={() => {
              setError(null);
              clearConnectionError();
            }}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {view === "ui" ? (
        <section
          className={`tb-grid ${run ? "" : "tb-grid-ready"}`}
          aria-label="Four agent conversations"
        >
          {laneStates.map((lane) => (
            <ToolArenaLane key={lane.id} lane={lane} sample={sample} />
          ))}
          {!run && (
            <div className="tb-launch">
              <button onClick={() => void start()} disabled={!canStart}>
                {allReady ? (
                  <Play size={19} fill="currentColor" />
                ) : (
                  <LoaderCircle size={19} className="spin" />
                )}
                {allReady ? "Start the race" : "Connecting…"}
              </button>
              <span>
                {!sample && participating === 0
                  ? "Configure an agent or select Sample"
                  : `${participating} agents · 1 request · local tools`}
              </span>
            </div>
          )}
        </section>
      ) : (
        <ToolArenaGraph lanes={laneStates} sample={sample} />
      )}
      <ToolArenaSummary
        lanes={laneStates}
        sample={sample}
        complete={complete}
      />
    </main>
  );
}

/**
 * One CopilotKit agent per lane. The controller owns its own run, stop, and
 * fallback state so a failing lane can never interrupt the other three.
 */
function LaneAgent({
  definition,
  sample,
  run,
  register,
  onState,
  onReady,
  onError,
}: {
  definition: ArenaLaneDefinition;
  sample: boolean;
  run: ArenaRun | null;
  register: (controller: ArenaController) => () => void;
  onState: (lane: ArenaLane) => void;
  onReady: (laneId: string, isReady: boolean) => void;
  onError: (message: string) => void;
}): ReactNode {
  const { agent, isReady } = useAgent({ agentId: definition.agentId });
  const { copilotkit } = useCopilotKit();
  const [fallback, setFallback] = useState<ArenaLane | null>(null);
  const [overlay, setOverlay] = useState<RenderOverlay | null>(null);
  const cancelled = useRef(false);

  const idle = useMemo<ArenaLane>(
    () => idleArenaLane(definition, sample),
    [definition, sample],
  );
  const base = useMemo<ArenaLane>(
    () => run?.lanes.find((item) => item.id === definition.id) ?? idle,
    [run, definition.id, idle],
  );
  const streamed = useMemo<ArenaLaneState | null>(
    () =>
      isArenaLaneState(agent.state) && agent.state.runId === base.runId
        ? agent.state
        : null,
    [agent.state, base.runId],
  );
  const lane = useMemo<ArenaLane>(
    () => ({
      ...withRenderCommit(selectLaneState(streamed, fallback, base), overlay),
      agentId: definition.agentId,
    }),
    [streamed, fallback, base, overlay, definition.agentId],
  );

  const laneRef = useRef(lane);
  useEffect(() => {
    laneRef.current = lane;
  }, [lane]);

  useEffect(() => onState(lane), [lane, onState]);
  useEffect(
    () => onReady(definition.id, isReady),
    [definition.id, isReady, onReady],
  );

  // UI commit: from the moment the execution result is in state until React has
  // committed the lane. An application lifecycle measurement, not a paint metric.
  const committedRunId =
    lane.status === "complete" && lane.execution ? lane.runId : null;
  useEffect(() => {
    if (!committedRunId) return;
    const receivedAt = performance.now();
    const frame = requestAnimationFrame(() =>
      setOverlay((current) =>
        current?.runId === committedRunId
          ? current
          : { runId: committedRunId, renderMs: performance.now() - receivedAt },
      ),
    );
    return () => cancelAnimationFrame(frame);
  }, [committedRunId]);

  const launch = useCallback(
    async ({ config, runId, prompt }: ArenaRunProps) => {
      cancelled.current = false;
      setFallback(null);
      setOverlay(null);
      // launchArena only calls this for a participating lane, so it starts
      // running regardless of whether the lane carries live credentials.
      const initialState: ArenaLane = {
        ...idleArenaLane(definition, true),
        runId,
        caseId: config.caseId,
        prompt: prompt ?? "",
        status: "running",
      };
      agent.setState(initialState);
      await runWithLaneLifecycle({
        agent,
        initialState,
        isCancelled: () => cancelled.current,
        onError: (message) => onError(`${definition.name}: ${message}`),
        onFallback: setFallback,
        run: () =>
          copilotkit.runAgent({
            agent,
            forwardedProps: { config, runId },
            runId,
          }),
      });
    },
    [agent, copilotkit, definition, onError],
  );
  const launchRef = useRef(launch);
  useEffect(() => {
    launchRef.current = launch;
  }, [launch]);

  const stop = useCallback(() => {
    cancelled.current = true;
    setFallback(interruptLane(laneRef.current));
    copilotkit.stopAgent({ agent });
  }, [agent, copilotkit]);
  const stopRef = useRef(stop);
  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  const controller = useMemo<ArenaController>(
    () => ({
      definition,
      run: (props) => launchRef.current(props),
      stop: () => stopRef.current(),
      isRunning: () => !isTerminalLane(laneRef.current),
    }),
    [definition],
  );
  useEffect(() => register(controller), [register, controller]);
  return null;
}
