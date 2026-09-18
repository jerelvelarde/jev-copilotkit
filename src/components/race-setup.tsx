"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowRight, Flag, FlaskConical, Radio, X } from "lucide-react";
import { raceConfigSchema, type RaceConfig } from "@/lib/race/types";

type RaceSetupProps = {
  open: boolean;
  onClose: () => void;
  config: RaceConfig;
  onConfigChange: (next: RaceConfig) => void;
  readyLanes: number;
};

const PRESETS = [
  { start: "Baseball", target: "Sun" },
  { start: "Coffee", target: "Napoleon" },
  { start: "Rubber duck", target: "Moon" },
  { start: "Jazz", target: "Antarctica" },
];

export function RaceSetup({
  open,
  onClose,
  config,
  onConfigChange,
  readyLanes,
}: RaceSetupProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [error, setError] = useState<string | null>(null);
  const sample = config.mode === "sample";

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) element.close();
  }, [open]);

  function update(next: RaceConfig) {
    setError(null);
    onConfigChange(next);
  }

  function changeMode(mode: RaceConfig["mode"]) {
    const hasSample = PRESETS.some(
      (preset) =>
        preset.start === config.start && preset.target === config.target,
    );
    update({
      ...config,
      ...(mode === "sample" && !hasSample ? PRESETS[0] : {}),
      mode,
    });
  }

  return (
    <dialog
      ref={dialog}
      className="arena-setup"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
    >
      <form
        className="arena-setup-form"
        onSubmit={(event) => {
          event.preventDefault();
          const parsed = raceConfigSchema.safeParse(config);
          if (!parsed.success) {
            setError(
              parsed.error.issues[0]?.message ?? "Check the article titles.",
            );
            return;
          }
          update(parsed.data);
          onClose();
        }}
      >
        <header className="arena-setup-header">
          <div>
            <h2 id={`${id}-title`} className="arena-setup-title">
              Set up your race
            </h2>
            <p id={`${id}-description`}>
              Same starting article. Same destination. Four different paths.
            </p>
          </div>
          <button
            type="button"
            className="arena-setup-close"
            onClick={onClose}
            aria-label="Close race setup"
          >
            <X size={19} />
          </button>
        </header>

        <div className="arena-setup-mode" role="group" aria-label="Race mode">
          <button
            type="button"
            className={sample ? "arena-mode-active" : ""}
            aria-pressed={sample}
            onClick={() => changeMode("sample")}
          >
            <FlaskConical size={14} />
            Sample
          </button>
          <button
            type="button"
            className={!sample ? "arena-mode-active" : ""}
            aria-pressed={!sample}
            onClick={() => changeMode("live")}
          >
            <Radio size={14} />
            Live
          </button>
        </div>

        <div className="arena-setup-route">
          <label className="arena-setup-field" htmlFor={`${id}-start`}>
            <span>Starting article</span>
            <input
              id={`${id}-start`}
              value={config.start}
              onChange={(event) =>
                update({ ...config, start: event.target.value })
              }
              readOnly={sample}
              required
              maxLength={200}
              autoComplete="off"
              spellCheck={false}
              placeholder="Baseball"
            />
          </label>
          <ArrowRight size={20} aria-hidden="true" />
          <label className="arena-setup-field" htmlFor={`${id}-target`}>
            <span>
              <Flag size={12} />
              Destination
            </span>
            <input
              id={`${id}-target`}
              value={config.target}
              onChange={(event) =>
                update({ ...config, target: event.target.value })
              }
              readOnly={sample}
              required
              maxLength={200}
              autoComplete="off"
              spellCheck={false}
              placeholder="Sun"
            />
          </label>
        </div>

        <div
          className="arena-setup-presets"
          role="group"
          aria-label="Preset challenges"
        >
          {PRESETS.map((preset) => (
            <button
              type="button"
              key={preset.start}
              className={
                config.start === preset.start && config.target === preset.target
                  ? "arena-preset-active"
                  : ""
              }
              aria-pressed={
                config.start === preset.start && config.target === preset.target
              }
              onClick={() => update({ ...config, ...preset })}
            >
              {preset.start}
              <ArrowRight size={12} aria-hidden="true" />
              {preset.target}
            </button>
          ))}
        </div>

        <p className="arena-setup-note">
          {sample ? (
            <>
              <strong>Sample mode.</strong> These four preset courses use
              scripted paths and simulated timings. They illustrate the
              interface; they are not verified Wikipedia routes or model
              benchmarks.
            </>
          ) : (
            <>
              <strong>Live mode.</strong> Choose any two English Wikipedia
              articles. Models follow real article links, and request times are
              measured. {readyLanes} of 4 models are configured.
            </>
          )}
        </p>
        {!sample && readyLanes < 4 && (
          <p className="arena-setup-note">
            To connect models, add <code>TYPESAFE_API_KEY</code> for Jev or{" "}
            <code>OPENROUTER_API_KEY</code> for the other models to the server’s{" "}
            <code>.env.local</code>, then restart the app. Keys stay on the
            server.{" "}
            {readyLanes > 0
              ? "Configured models can race independently."
              : "Connect a provider before starting a live race, or try Sample mode."}
          </p>
        )}
        {error && (
          <p className="arena-setup-error" role="alert">
            {error}
          </p>
        )}

        <div className="arena-setup-bottom">
          <label className="arena-setup-field" htmlFor={`${id}-hops`}>
            <span>Maximum hops</span>
            <select
              id={`${id}-hops`}
              value={config.maxHops}
              onChange={(event) =>
                update({ ...config, maxHops: Number(event.target.value) })
              }
            >
              {[8, 12, 20].map((value) => (
                <option value={value} key={value}>
                  {value} hops
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="arena-setup-submit">
            Ready to race
            <ArrowRight size={15} />
          </button>
        </div>
      </form>
    </dialog>
  );
}
