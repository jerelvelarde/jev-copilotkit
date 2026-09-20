# Tool-call Arena Implementation Plan

> Use subagent-driven-development for the independent backend and UI tasks, then focused spec/code review.

**Goal:** Add a live Jev tool-selection/argument benchmark beside Wiki Race.

**Architecture:** Shared typed contract in `src/lib/tool-bench/types.ts`; versioned labeled dataset and injectable benchmark engine; server-only Jev/native OpenRouter adapters; custom AG-UI agent; independent page rendering CopilotKit shared state. Existing Wiki Race remains functional.

**Tech stack:** Existing Next.js, CopilotKit v2 exports, AG-UI, Zod, RxJS, CSS, Vitest.

- [x] Verify the supplied Jev key with a small real typed request; inject it into the local server without logging or committing its value. Persistent storage awaits the user's 1Password unlock or explicit local-file preference.
- [x] Define the shared benchmark state/provider contracts in `src/lib/tool-bench/types.ts`.
- [x] Backend: implement dataset, safe simulated tool schemas, exact scoring, bounded engine, sample and live adapters, `ToolBenchAgent`, and meaningful regression tests under `src/lib/tool-bench/`.
- [x] UI: implement dark four-lane benchmark controls, streamed request/call/results, historical inspection, latency/accuracy comparisons, disclosures, and mobile layout in `src/components/tool-bench*`.
- [x] Integration: register `tool_bench` in the existing CopilotKit route, add `/tool-bench`, link both demos, and document setup and methodology.
- [x] Run a small live Jev benchmark and preserve non-secret measured results. Verify Wiki Race remains reachable and correctly configured. Six-case API run: 6/6 exact, p50 317 ms; twelve-case browser run: 12/12 exact, p50 306 ms, p95 857 ms, elapsed 4.7 seconds. Single-run observations, not general performance claims. Baseline live inference awaits OpenRouter configuration.
- [x] Review and fix findings. Browser checks passed for run/stop/replay, missing keys, history, and 390px mobile layout. Independent spec and quality reviews passed. All 70 tests, lint, and TypeScript passed; final formatting and production build checks are recorded in the task completion report.
