# Wiki race arena

The user supplied a screenshot of the source demo after the first implementation. Treat it as the visual direction for the existing authorized build: a dark viewport-sized arena, four equal quadrants, compact lane metadata, a central Go button, a top race clock, and bottom model-time bars. The face-camera overlay belongs to the video and is not app UI.

The screenshot's dark palette takes precedence over the default light CopilotKit styling. Retain the official logo artwork, legible typography, and accurate configured model names. Use magenta for Jev, mint for GPT, and warm accents for the two Claude lanes. These arena colors are implementation choices derived from the reference, not new brand tokens.

Keep existing CopilotKit shared-state/run/stop integration and all engine rules. Setup opens in a native modal dialog for titles, presets, Sample/Live, and hop count. Start in the ready arena on Baseball → Sun, with a clearly disclosed synthetic course added for that pairing. During a run, each pane shows its current article, trail, status, and inspectable prior decisions. Completed panels retain results. A header replay control starts a fresh race; Stop retains the existing verified cancellation behavior.

Desktop fits all four panels and timing bars in one viewport; panel content scrolls internally. Narrow screens stack panels and allow normal page scrolling. Sample mode remains visibly labeled in the header and footer. Unavailable providers and errors remain explicit. No model IDs or live inference results are fabricated to match labels in the image.

Verify ready/running/completed views, settings keyboard dismissal, preset changes, stop/restart, decision history, unavailable live providers, and narrow layout. Run existing tests, lint, TypeScript, formatting, and build.
