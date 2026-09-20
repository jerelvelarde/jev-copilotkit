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
  ArrowLeft,
  FlaskConical,
  LoaderCircle,
  Play,
  Radio,
  RotateCcw,
  Square,
  TriangleAlert,
  X,
} from "lucide-react";
import { DEFAULT_LANES, type LaneDefinition } from "@/lib/race/types";
import {
  benchConfigSchema,
  DEFAULT_BENCH_CONFIG,
  initialBench,
  type BenchConfig,
  type BenchState,
} from "@/lib/tool-bench/types";
import { ToolBenchLane } from "./tool-bench-lane";
import { BenchClock, ToolBenchMetrics } from "./tool-bench-metrics";
import {
  interruptBench,
  runWithBenchLifecycle,
  selectBenchState,
} from "./tool-bench-lifecycle";
import "./tool-bench.css";

export function ToolBench() {
  const [connectionError, setConnectionError] = useState<string | null>(null);
  return (
    <CopilotKitProvider
      runtimeUrl="/api/copilotkit"
      agentId="tool_bench"
      enableInspector={false}
      onError={({ error }) => setConnectionError(error.message)}
    >
      <ToolBenchBoard
        connectionError={connectionError}
        clearConnectionError={() => setConnectionError(null)}
      />
    </CopilotKitProvider>
  );
}

function ToolBenchBoard({
  connectionError,
  clearConnectionError,
}: {
  connectionError: string | null;
  clearConnectionError: () => void;
}) {
  const { agent, isReady } = useAgent({ agentId: "tool_bench" });
  const { copilotkit } = useCopilotKit();
  const [config, setConfig] = useState<BenchConfig>(DEFAULT_BENCH_CONFIG);
  const [definitions, setDefinitions] =
    useState<LaneDefinition[]>(DEFAULT_LANES);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [fallback, setFallback] = useState<BenchState | null>(null);
  const activeRun = useRef(false);
  const cancelled = useRef(false);
  const bench = selectBenchState(
    agent.state,
    fallback,
    initialBench(config, definitions),
  );
  const running = pending || bench.status === "running";
  const idle = !bench.runId;
  const displayedConfig = bench.runId ? bench.config : config;
  const sample = displayedConfig.mode === "sample";
  const readyLanes = definitions.filter(
    (lane) => sample || lane.available,
  ).length;
  const canStart = isReady && (sample || (configLoaded && readyLanes > 0));
  const completeLanes = bench.lanes.filter(
    (lane) => lane.status === "complete",
  ).length;

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/config", { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            "Could not check provider configuration. Reload to retry.",
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

  function updateConfig(next: BenchConfig) {
    if (activeRun.current || running) return;
    setConfig(next);
    setFallback(null);
    setError(null);
    clearConnectionError();
    agent.setState(initialBench(next, definitions));
  }

  async function start() {
    if (activeRun.current) return;
    const parsed = benchConfigSchema.safeParse(config);
    if (!parsed.success) {
      setError("Choose a mode and number of requests.");
      return;
    }
    if (!isReady) {
      setError(
        "The benchmark runtime is still connecting. Try again in a moment.",
      );
      return;
    }
    if (!sample && (!configLoaded || readyLanes === 0)) {
      setError(
        "Set TYPESAFE_API_KEY for Jev or OPENROUTER_API_KEY for baselines on the server and restart, or select Sample.",
      );
      return;
    }
    const next = initialBench(parsed.data, definitions);
    next.runId = crypto.randomUUID();
    next.status = "running";
    next.lanes = next.lanes.map((lane) => ({
      ...lane,
      status: sample || lane.available ? "running" : "unavailable",
    }));
    activeRun.current = true;
    cancelled.current = false;
    setPending(true);
    setStopping(false);
    setFallback(null);
    setError(null);
    clearConnectionError();
    agent.setState(next);
    try {
      await runWithBenchLifecycle({
        agent,
        initialState: next,
        isCancelled: () => cancelled.current,
        onError: setError,
        onFallback: setFallback,
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

  function stop() {
    cancelled.current = true;
    setStopping(true);
    setFallback(interruptBench(bench));
    copilotkit.stopAgent({ agent });
  }

  return (
    <main className="tb-arena" aria-label="Tool calling benchmark arena">
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
          <h1>Tool benchmark</h1>
        </div>
        <div className="tb-controls">
          <fieldset disabled={running} className="tb-mode">
            <legend className="tb-sr-only">Benchmark mode</legend>
            <button
              aria-pressed={sample}
              onClick={() => updateConfig({ ...config, mode: "sample" })}
            >
              <FlaskConical size={12} />
              Sample
            </button>
            <button
              aria-pressed={!sample}
              onClick={() => updateConfig({ ...config, mode: "live" })}
            >
              <Radio size={12} />
              Live
            </button>
          </fieldset>
          <label className="tb-count">
            <span className="tb-sr-only">Requests per model</span>
            <select
              disabled={running}
              value={displayedConfig.caseCount}
              onChange={(event) =>
                updateConfig({
                  ...config,
                  caseCount: Number(event.target.value),
                })
              }
            >
              <option value={6}>6 requests</option>
              <option value={12}>12 requests</option>
            </select>
          </label>
        </div>
        <div className="tb-actions">
          <BenchClock bench={bench} running={running} />
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
            !idle && (
              <>
                <button
                  className="tb-button"
                  onClick={() => void start()}
                  disabled={!canStart}
                >
                  <RotateCcw size={13} />
                  Run again
                </button>
                <button
                  className="tb-button tb-reset"
                  onClick={() => updateConfig(config)}
                >
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
            ? "Sample · synthetic responses and equal simulated delays"
            : `Live · ${readyLanes}/${definitions.length} models configured · tools are simulated`}
        </span>
        <span role="status" aria-live="polite">
          {running
            ? "Benchmark in progress"
            : bench.status === "complete"
              ? `${completeLanes}/${readyLanes} lanes completed`
              : bench.status === "cancelled"
                ? "Stopped · completed results preserved"
                : "Same requests. Four models. Every call scored."}
        </span>
      </div>
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
      <section
        className={`tb-grid ${idle ? "tb-grid-ready" : ""}`}
        aria-label="Four model benchmark lanes"
      >
        {bench.lanes.map((lane) => (
          <ToolBenchLane
            key={`${bench.runId}-${lane.id}`}
            lane={lane}
            config={displayedConfig}
            totalCases={bench.totalCases}
          />
        ))}
        {idle && (
          <div className="tb-launch">
            <button onClick={() => void start()} disabled={!canStart}>
              {!isReady ? (
                <LoaderCircle size={19} className="spin" />
              ) : (
                <Play size={19} fill="currentColor" />
              )}
              {!isReady ? "Connecting…" : "Run benchmark"}
            </button>
            <span>
              {!sample && readyLanes === 0
                ? "Configure a model or select Sample"
                : `${displayedConfig.caseCount} requests per model`}
            </span>
          </div>
        )}
      </section>
      <ToolBenchMetrics bench={bench} />
    </main>
  );
}
