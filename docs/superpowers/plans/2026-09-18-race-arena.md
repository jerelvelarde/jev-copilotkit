# Wiki Race Arena Implementation Plan

> Execute inline with the executing-plans skill in the current authorized build.

**Goal:** Match the user's screenshot with a working dark four-pane race arena.

**Architecture:** Preserve the existing race lifecycle and backend. Replace presentation components and global styles; isolate setup, stopwatch, and timing bars from the shared-state controller.

**Tech stack:** Existing Next.js, React, CopilotKit, TypeScript, CSS.

- [x] Add the explicit Baseball → Sun sample course in `src/lib/race/sample.ts`; select it as the default and update the full-agent sample expectation.
- [x] Add a native setup dialog in `src/components/race-setup.tsx`; use `showModal()`/`close()` in an effect and `onCancel` for Escape, preserving editable Live titles and preset-only samples.
- [x] Replace the board layout in `src/components/wiki-race.tsx` with compact header, four quadrants, ready Go overlay, stop/replay/setup controls, and explicit sample disclosure. Keep `runWithRaceLifecycle` and `selectRaceState` unchanged.
- [x] Rebuild `src/components/lane-card.tsx` as a compact arena pane, retaining article source links and all prior decision inspection.
- [x] Add isolated clock and model-time comparison components in `src/components/race-metrics.tsx`; freeze at the terminal server timings and label sample metrics as simulated.
- [x] Replace legacy landing-page CSS in `src/app/globals.css` with the dark arena layout. Preserve the official logo artwork and responsive/keyboard/reduced-motion support.
- [x] Run `pnpm test`, `pnpm lint`, `pnpm typecheck`, `pnpm format:check`, and `pnpm build`. Browser-check Go, Stop, replay, setup, historical decisions, missing keys, desktop viewport fit, and mobile overflow. Record results and commit locally.

## Verification

All 29 tests, TypeScript, ESLint, Prettier, and the production build passed. Browser checks covered the Baseball → Sun sample to completion, changing courses, Live mode without credentials, native dialog Escape/focus behavior, Stop, replay after Stop, and selecting an earlier decision. Desktop geometry fits four equal panels and the timeline in one viewport; narrow-screen geometry stacks panels without horizontal overflow, with the setup dialog fitting the viewport. Temporary viewport overrides were reset.

Focused review found and resolved two issues: the race clock now extrapolates received durations using the browser's monotonic clock rather than comparing browser/server wall clocks, and the mobile icon-only Setup control has an explicit accessible name. No review findings remain.

Live model inference remains unverified while credentials are pending. The source screenshot's dark treatment is intentional; displayed model names reflect actual configured IDs, and sample routes/timings remain explicitly synthetic.
