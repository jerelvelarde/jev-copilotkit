# CopilotKit + Jev: adaptive workspace

Status: superseded by the user's selection of the Wiki race demo. See [the Wiki race design](2026-09-18-wiki-race-design.md).

## Purpose

Build a small, runnable project that makes Jev's decisions visible through CopilotKit. A user describes the sales information they want to see, and the workspace selects useful components and filters over a supplied dataset. Follow-up requests adapt the existing view.

The first version demonstrates the central idea in the supplied json-render post without requiring its unreleased composer APIs. It uses CopilotKit's React components and shared agent state with a direct TypeSafe integration. Jev makes bounded decisions; application code owns the data, component props, and permitted actions.

## Approaches considered

1. **Adaptive workspace — recommended.** A visible demonstration of component selection, shared state, and follow-up interaction. A narrow catalog keeps decisions understandable and evaluation practical.
2. **Agent harness.** Add Jev routing and tool checks around a conventional generative agent. Closely follows the LangChain article, but requires a second model and a meaningful tool environment to demonstrate the benefit.
3. **Support inbox.** Classify tickets and expose a CopilotKit investigation workflow. Clear business use case, but it emphasizes triage more than the UI composition experiment.

## Proposed first experience

Use a synthetic sales dataset, clearly labeled as sample data. The opening screen shows a useful workspace and three example requests:

- "Show pipeline metrics and a deal table."
- "Focus on at-risk deals and show the breakdown by stage."
- "Hide the chart and keep the table."

The UI has a main canvas, a CopilotKit conversation panel, and a compact expandable decision inspector. It supports desktop and narrow layouts. The inspector shows the actual selected options, provider confidence when supplied, and measured request duration. It never presents model-generated explanations or invented benchmark numbers.

The component catalog contains a metrics strip, a stage breakdown chart, a deal table, a priority list, and a filter summary. These components are independently selectable, with a small set of layout choices. Their content and calculations come from the sample records. Clicking a deal reveals its details; selecting filters updates the same workspace state that the agent sees.

## Architecture and flow

- **Next.js and TypeScript:** one local application containing the UI and server endpoints.
- **CopilotKit v2:** conversation UI, agent connection, shared state, and rendering of decision feedback.
- **AG-UI agent endpoint:** validates input, calls the decision service, emits lifecycle and state events, and reports errors to the UI.
- **TypeSafe decision service:** sends the current user request, supported choices, and bounded workspace context to Jev using a server-only API key.
- **Workspace reducer and component registry:** validate typed decisions and apply deterministic changes to components, filters, and layout.

For each request, Jev evaluates atomic questions in a batch: which components to show, which supported filter to use, and which layout to choose. Follow-up decisions include preserve/show/hide options so unrelated parts of the workspace can remain intact. Code validates the entire result before applying it atomically. CopilotKit receives the new state and a short application-authored acknowledgement.

The core interaction needs only a TypeSafe API key. Open-ended prose generation, model routing, and a general-purpose agent are outside this first version. Unsupported requests receive a clear response describing the available operations.

## Configuration and failure behavior

- Store `TYPESAFE_API_KEY` only in an ignored server environment file; document setup with `.env.example`.
- If credentials are absent, show setup instructions. An explicitly labeled fixture mode may exercise the UI locally, but is never represented as live Jev inference.
- Preserve the last valid workspace after a provider failure, timeout, cancellation, or malformed response. Show an actionable error and retry control.
- Reject unknown component IDs, unsupported filters, and invalid response values. Do not silently substitute a guessed model answer.
- Display confidence as a provider estimate. Do not equate it with proven UI correctness or invent an uncalibrated approval threshold.
- Abort superseded requests and prevent stale responses from overwriting newer state.
- Keep this first version local, with synthetic records and reversible UI actions. There are no outgoing email, CRM, or deployment actions.

## Verification and acceptance

1. A documented install and dev command starts the app from this repository.
2. Fixture-backed integration checks exercise component selection, follow-up preservation, unknown values, provider failures, and stale request handling through the same application boundary used by live mode.
3. Typecheck, lint, and production build pass.
4. Browser checks confirm the example flows, clickable record details, filter synchronization, error recovery, and a usable narrow layout.
5. If a TypeSafe key is available, run the example prompts against Jev and record observed results and latency. If unavailable, explicitly report that live inference remains unverified.
6. Do not claim a latency target or model accuracy that has not been measured.

## References and findings

- [LangChain: Building a Harness with Jev](https://www.langchain.com/blog/building-a-harness-with-jev) — Jev as a classifier inside agent workflows, including model routing and tool checks.
- [Chris Tate's json-render + Jev experiment](https://x.com/ctatedev/status/2101022101750571357) — UI built from supplied components, actions, and a design system.
- [json-render's Jev guide](https://github.com/vercel-labs/json-render/blob/main/apps/web/app/%28main%29/docs/jev/page.mdx) — the composer APIs are currently unreleased; components also need concrete candidate values and bindings.
- [TypeSafe introduction](https://docs.typesafe.ai/introduction) — Choice, Score, and Noul questions return typed decisions; Jev does not generate prose.
- [CopilotKit v2 reference](https://docs.copilotkit.ai/reference/v2) and [shared agent state](https://docs.copilotkit.ai/reference/v2/hooks/useAgent).
- [AG-UI event protocol](https://docs.ag-ui.com/concepts/events) — lifecycle, tool, and state events connect the server agent to the frontend.

## Workspace findings

The repository is empty and has no commits or remote. Node is absent from the shell's default PATH, but the Codex bundled Node and pnpm runtimes are available. No existing application or framework constrains the proposed stack.

## Design review

The scope is one local demonstration with one dataset and five components. Application decisions, supplied data, and prose generation have distinct responsibilities. Live inference and fixture verification are reported separately. User selection of the project direction is pending.
