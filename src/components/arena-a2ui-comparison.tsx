"use client";

import { useEffect, useMemo, useState } from "react";
import {
  A2UIProvider,
  A2UIRenderer,
  useA2UI,
  useA2UIError,
} from "@copilotkit/a2ui-renderer";
import { buildA2UIMessages } from "../lib/tool-bench/a2ui-surface";
import type { ArenaLaneState } from "@/lib/tool-bench/types";
import { ToolResultCard } from "./tool-result-card";

function Surface({
  messages,
  surfaceId,
}: {
  messages: Array<Record<string, unknown>>;
  surfaceId: string;
}) {
  const { processMessages, clearSurfaces } = useA2UI();
  const error = useA2UIError();
  useEffect(() => {
    clearSurfaces();
    processMessages(messages);
  }, [messages, clearSurfaces, processMessages]);
  if (error) return <p role="alert">A2UI render failed: {error}</p>;
  return (
    <A2UIRenderer
      surfaceId={surfaceId}
      fallback={<p>Rendering A2UI surface…</p>}
    />
  );
}

export function ArenaA2UIComparison({ lane }: { lane: ArenaLaneState }) {
  const [view, setView] = useState<"a2ui" | "fixed">("a2ui");
  const messages = useMemo(
    () =>
      lane.execution
        ? buildA2UIMessages(lane.runId, lane.id, lane.execution)
        : null,
    [lane.execution, lane.id, lane.runId],
  );
  if (!lane.execution || !messages) return null;

  return (
    <div className="tb-a2ui-comparison">
      <div className="tb-a2ui-toolbar">
        <span>A2UI result</span>
        <div role="group" aria-label={`${lane.name} result view`}>
          <button
            type="button"
            aria-pressed={view === "a2ui"}
            onClick={() => setView("a2ui")}
          >
            A2UI
          </button>
          <button
            type="button"
            aria-pressed={view === "fixed"}
            onClick={() => setView("fixed")}
          >
            Fixed UI
          </button>
        </div>
      </div>
      <p className="tb-a2ui-note">
        Same A2UI schema for every agent · live tool data
      </p>
      {view === "fixed" ? (
        <ToolResultCard execution={lane.execution} />
      ) : (
        <div
          className="tb-a2ui-surface"
          aria-label={`${lane.name} A2UI result`}
        >
          <A2UIProvider>
            <Surface
              messages={messages}
              surfaceId={`${lane.id}-${lane.runId}`}
            />
          </A2UIProvider>
        </div>
      )}
    </div>
  );
}
