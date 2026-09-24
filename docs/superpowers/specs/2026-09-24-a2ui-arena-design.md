# Shared A2UI tool-call arena design

The arena keeps four independent CopilotKit agents and one identical live lookup per run. Jev alone uses TypeSafe for its tool decision; the other agents use their configured models. After each selected tool fetches live public data, all four results render through the same CopilotKit A2UI v0.9 component schema and basic catalog. The data model is built from each validated tool execution. This makes the visual surface and rendering work comparable across lanes.

A per-lane toggle switches between A2UI and the existing fixed React result card without rerunning the agent. A2UI is the default. The graph, decision/tool timings, winner calculation, and wiki race remain unchanged. The existing UI-commit metric describes a React application lifecycle step, not a browser paint benchmark, and should continue to be labeled as such.

The schema is fixed while the bound data is live. The results identify the fastest correct tool decision separately from the total, so public API latency cannot hide the model-decision comparison. This is intentionally the fixed-schema A2UI approach, not dynamic-schema generation by a secondary LLM: Jev does not generate arbitrary component JSON, and adding the same secondary model to every lane would measure that model more than the agent's tool decision. A separate generative-UI demo can explore Jev choosing prepared controls and layouts.

Success means all four lanes visibly render A2UI surfaces after real tool calls, the fixed/A2UI toggle works, the result stays factual, and checks pass.
