# Tool Calling Arena V2 Design

**Date:** 2026-09-21  
**Status:** Approved for planning

## Goal

Turn the existing tool benchmark into a visual race between four real CopilotKit agents. Each agent receives the same request, agent instructions, tool definitions, candidate values, and local tool implementations. The arena makes each tool decision, tool result, rendered response, and timing phase visible so viewers can understand both accuracy and speed.

Jev is one of the four competitors. It receives distinctive magenta styling and exposes ranked tool choices when the API returns them, but the interface does not declare a winner before measuring the run. A separate solo Jev generative-UI example is intentionally outside this design.

## Product Experience

The arena has two synchronized views over the same run.

### UI view

The default view is a 2-by-2 grid of compact CopilotKit conversations. Each lane shows:

1. The identical user message.
2. A visible decision phase while the provider chooses a tool.
3. The selected tool and structured arguments.
4. The local tool's result.
5. The UI rendered from that result.

The four conversations start together from one race control. Viewers can inspect any completed request without pausing the other lanes. The Jev lane uses the existing magenta identity and, when available, adds a small ranked-choice disclosure below its selected tool.

### Graph view

The graph view renders one horizontal trace per agent:

`Prompt -> Tool decision -> Tool execution -> UI rendered`

Nodes appear as events arrive. Each node includes its phase duration and status. Correct tool choices and exact arguments use success styling; a wrong tool, invalid arguments, provider error, or tool error is visually distinct. A shared time axis makes the relative completion order readable without hiding accuracy.

Switching views does not start another run or reset state. Both views read the same normalized event timeline.

## Timing and Scoring

The header shows one global race clock from launch until every available lane reaches a terminal state. Each lane separately records:

- **Decision time:** request dispatch until a valid tool call or provider failure.
- **Tool time:** local tool invocation until a result or tool failure.
- **Render time:** tool result received until the lane commits its rendered result state.
- **Total time:** race launch until that lane reaches a terminal state.

Render time is an application lifecycle measurement, not a browser paint benchmark. The UI labels it accordingly.

Accuracy remains independent from timing:

- Tool accuracy checks the selected tool name.
- Argument accuracy checks the complete normalized argument object.
- Exact-call accuracy requires both.
- Completion requires a tool result and rendered output.
- Provider and tool failures count as incorrect attempts.

The result summary may identify the fastest exact lane and the highest-accuracy lane. It does not combine accuracy and latency into an unexplained composite score.

## Architecture

### Four CopilotKit agents

The CopilotKit runtime registers four agent IDs, one per provider lane. Each instance uses the same benchmark agent implementation with a provider adapter injected at construction. The frontend obtains each agent independently through CopilotKit and starts all available agents from the same immutable run specification.

The run specification contains a unique run ID, dataset version, selected case, tool schema version, and mode. Every lane validates this specification before beginning.

### Shared provider boundary

All providers implement one decision interface:

```ts
type ToolDecisionProvider = (
  input: ToolDecisionInput,
  signal: AbortSignal,
) => Promise<ToolDecision>;
```

Jev maps the tool name and each constrained argument to structured `choice` questions in one `systemOne` request. Baseline providers receive the same tool definitions through their native function-calling API. Provider-specific metadata is normalized into optional evidence such as ranked choices, confidence, and token usage.

The UI states clearly that Jev structured questions and native function-calling APIs differ even though the task, tools, candidates, and evaluation rules are held constant.

### Local tool execution

Tools execute through a shared in-process registry after a provider returns a valid call. The initial registry contains deterministic, side-effect-free support tools suitable for the existing dataset. Every tool validates arguments with a schema and returns a typed result used by a prepared React renderer.

Live and Sample modes use the same tool registry. Sample mode substitutes recorded provider decisions and controlled delays; it remains explicitly labeled synthetic. Local tools never contact external systems or mutate user data.

### Normalized event timeline

Each lane emits normalized events for decision start, decision finish, tool start, tool finish, render commit, cancellation, and failure. The conversation view and graph view derive their state from this event list. This keeps both presentations synchronized and makes timing calculations testable without reading DOM state.

AG-UI run events carry agent state and completion status. Provider and tool cancellation share one abort signal. A stopped race asks every active agent to abort and preserves completed timeline events for inspection.

## Components

- **Arena shell:** race controls, mode selector, case selector, global timer, view switcher, and aggregate result summary.
- **Agent conversation lane:** compact CopilotKit conversation for one agent with tool-call and result cards.
- **Tool-call card:** selected tool, arguments, correctness, and provider evidence.
- **Prepared result renderer:** deterministic UI for each supported local tool result.
- **Execution graph:** shared-axis traces generated from normalized events.
- **Metrics table:** exact calls, tool accuracy, decision latency, tool latency, total latency, and completion.
- **Methodology disclosure:** explains API differences, sample data, timing boundaries, and scoring.

## Data Flow

1. The user chooses Sample or Live and selects a benchmark case.
2. The arena creates one immutable run specification and initializes four lane states.
3. All available CopilotKit agents receive the same run specification concurrently.
4. Each provider adapter produces a normalized tool decision.
5. The shared evaluator records tool and argument correctness.
6. Valid calls execute through the local tool registry, including incorrect calls when their arguments still satisfy that tool's schema.
7. The lane renders the typed tool result through its prepared component.
8. The lane appends timing and status events throughout the run.
9. UI and Graph views render the same final timeline and metrics.

If a provider returns an unknown tool or invalid arguments, execution stops for that lane and the visible failure explains why. Other lanes continue.

## Error Handling

Provider, validation, execution, and rendering failures have distinct event types and user-facing labels. Failures are not replaced with fabricated tool results. A failure in one lane never cancels the other lanes.

The Stop control aborts provider requests and prevents tools that have not started from running. A tool already executing receives the same abort signal. Completed events and partial timings remain visible after cancellation.

Live mode disables unavailable lanes and identifies the required server-side environment variable without exposing its value. If every live provider is unavailable, the race cannot start and the UI points to Sample mode.

## Testing and Verification

Unit tests cover provider normalization, tool schemas, execution results, evaluation, event ordering, phase durations, cancellation, and terminal-state handling. Component tests cover synchronized race start, independent lane failure, view switching without state loss, timers, graph nodes, Jev evidence, and accessibility labels.

Verification includes formatting, lint, explicit TypeScript checking, the full test suite, and a production build. A manual browser pass checks the 2-by-2 UI at desktop and narrow widths, the graph time scale, live timer transitions, Stop behavior, and Sample/Live labeling.

## Scope Boundaries

This iteration redesigns `/tool-bench`. It does not build the separate solo Jev generative-UI application, add Automatic Learning, call external business tools, or claim general model performance from the small included dataset.

