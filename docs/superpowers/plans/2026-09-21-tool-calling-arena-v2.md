# Tool Calling Arena V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `/tool-bench` with a synchronized four-agent CopilotKit race that shows tool decisions, local tool results, prepared UI, execution traces, and separate decision/tool/total timings.

**Architecture:** Register four instances of one lane agent in the CopilotKit runtime, each configured with a provider adapter but sharing the same cases, tool schemas, local tool executor, evaluator, and AG-UI state contract. The browser launches the four agents together and derives the conversation and graph views from their normalized lane timelines. Sample mode uses authored decisions and controlled delays; Live mode calls Jev or OpenRouter and always uses the same local side-effect-free tools after a valid decision.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, CopilotKit v2, AG-UI, RxJS, Zod, Vitest, CSS.

---

## File map

**Create**

- `src/lib/tool-bench/executor.ts` — validate and execute deterministic local tools.
- `src/lib/tool-bench/executor.test.ts` — executor success, validation, and cancellation tests.
- `src/lib/tool-bench/lane-engine.ts` — run one provider decision and one tool execution while emitting timeline snapshots.
- `src/lib/tool-bench/lane-engine.test.ts` — timeline, scoring, error isolation, and cancellation tests.
- `src/components/tool-arena-lane.tsx` — one compact CopilotKit conversation surface.
- `src/components/tool-result-card.tsx` — prepared UI for typed local tool results.
- `src/components/tool-arena-graph.tsx` — shared-axis execution trace.
- `src/components/tool-arena-summary.tsx` — accuracy and timing results.
- `src/components/tool-arena.test.ts` — orchestration and server-rendered component tests.

**Modify**

- `src/lib/tool-bench/types.ts` — single-case run config, normalized lane state, events, timings, and execution result types.
- `src/lib/tool-bench/tools.ts` — add Zod argument schemas and stable tool metadata.
- `src/lib/tool-bench/providers.ts` — retain one normalized provider boundary and Jev evidence.
- `src/lib/tool-bench/sample.ts` — lane-specific authored sample decisions with controlled decision delay.
- `src/lib/tool-bench/agent.ts` — make the agent lane-specific.
- `src/app/api/copilotkit/[[...slug]]/route.ts` — register four tool-arena agent IDs.
- `src/components/tool-bench.tsx` — become the four-agent orchestrator and view switcher.
- `src/components/tool-bench-lifecycle.ts` — operate on one lane state per agent.
- `src/components/tool-bench-metrics.tsx` — keep shared timing helpers only; move arena summary into its own component.
- `src/components/tool-bench.css` — add conversation, tool-result, graph, and responsive styles.
- `src/app/api/config/route.ts` — return the stable agent IDs with lane definitions.
- `README.md` — document the redesigned arena and timing boundaries.

**Remove after replacements pass**

- `src/lib/tool-bench/engine.ts`
- `src/lib/tool-bench/engine.test.ts`
- `src/components/tool-bench-lane.tsx`

## Task 1: Define the single-lane arena contract

**Files:**

- Modify: `src/lib/tool-bench/types.ts`
- Modify: `src/lib/tool-bench/scoring.test.ts`

- [ ] **Step 1: Write failing contract tests**

Add tests that parse one case and reject batch-only configuration:

```ts
import { arenaConfigSchema, initialLaneState } from "./types";

it("uses one selected case per synchronized race", () => {
  expect(
    arenaConfigSchema.parse({ mode: "sample", caseId: "order-details" }),
  ).toEqual({ mode: "sample", caseId: "order-details" });
  expect(() =>
    arenaConfigSchema.parse({ mode: "sample", caseCount: 6 }),
  ).toThrow();
});

it("creates an idle lane with an empty normalized timeline", () => {
  const lane = initialLaneState(DEFAULT_LANES[0]);
  expect(lane).toMatchObject({
    status: "idle",
    runId: "",
    decision: null,
    execution: null,
    timings: { decisionMs: 0, toolMs: 0, renderMs: 0, totalMs: 0 },
    events: [],
  });
});
```

- [ ] **Step 2: Run the focused tests and verify failure**

Run: `pnpm vitest run src/lib/tool-bench/scoring.test.ts`

Expected: FAIL because `arenaConfigSchema` and `initialLaneState` do not exist.

- [ ] **Step 3: Replace the batch state with the arena contract**

Define and export these shapes in `types.ts`:

```ts
export const arenaConfigSchema = z.object({
  mode: z.enum(["sample", "live"]),
  caseId: z.string().min(1),
});
export type ArenaConfig = z.infer<typeof arenaConfigSchema>;
export type ArenaPhase = "decision" | "tool" | "render";
export type ArenaEvent = {
  phase: ArenaPhase;
  status: "started" | "finished" | "error" | "cancelled";
  atMs: number;
  durationMs: number | null;
  message: string | null;
};
export type ToolExecution = {
  tool: string;
  arguments: Record<string, unknown>;
  result: Record<string, unknown>;
};
export type LaneTimings = {
  decisionMs: number;
  toolMs: number;
  renderMs: number;
  totalMs: number;
};
export type ArenaLaneState = LaneDefinition & {
  status:
    "idle" | "running" | "complete" | "cancelled" | "error" | "unavailable";
  runId: string;
  caseId: string | null;
  prompt: string;
  expected: ToolCall | null;
  decision: BenchDecision | null;
  execution: ToolExecution | null;
  score: ReturnType<typeof scoreCall> | null;
  timings: LaneTimings;
  events: ArenaEvent[];
  error: string | null;
};
export function initialLaneState(lane: LaneDefinition): ArenaLaneState {
  return {
    ...lane,
    status: lane.available ? "idle" : "unavailable",
    runId: "",
    caseId: null,
    prompt: "",
    expected: null,
    decision: null,
    execution: null,
    score: null,
    timings: { decisionMs: 0, toolMs: 0, renderMs: 0, totalMs: 0 },
    events: [],
    error: null,
  };
}
```

Import `LaneDefinition` and `scoreCall` explicitly. Preserve `BenchDecision`, `BenchProvider`, `BenchCase`, `BenchCaseInput`, and `ToolCall` because providers and cases still depend on them. Remove `BenchState`, `BenchLane`, `BenchDependencies`, `benchConfigSchema`, and `initialBench` after callers move in later tasks.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm vitest run src/lib/tool-bench/scoring.test.ts && pnpm typecheck`

Expected: contract tests and typecheck PASS. Keep the legacy aggregate types exported until Tasks 3–6 remove their final callers.

- [ ] **Step 5: Commit the contract**

```bash
git add src/lib/tool-bench/types.ts src/lib/tool-bench/scoring.test.ts
git commit -m "Define tool arena lane contract"
```

## Task 2: Execute the shared local tools

**Files:**

- Modify: `src/lib/tool-bench/tools.ts`
- Create: `src/lib/tool-bench/executor.ts`
- Create: `src/lib/tool-bench/executor.test.ts`

- [ ] **Step 1: Write executor tests**

Cover a prepared result, invalid arguments, unknown tools, and cancellation:

```ts
it("executes lookup_order into a typed prepared result", async () => {
  const result = await executeToolCall(
    { tool: "lookup_order", arguments: { order_id: "ORD-1042" } },
    new AbortController().signal,
    0,
  );
  expect(result).toEqual({
    tool: "lookup_order",
    arguments: { order_id: "ORD-1042" },
    result: {
      kind: "order",
      orderId: "ORD-1042",
      status: "Delivered",
      items: 2,
      total: "$84.00",
    },
  });
});

it.each([
  [{ tool: "invented", arguments: {} }, "Unknown tool"],
  [{ tool: "lookup_order", arguments: { order_id: 42 } }, "Invalid arguments"],
])("rejects an unsafe call", async (call, message) => {
  await expect(
    executeToolCall(call, new AbortController().signal, 0),
  ).rejects.toThrow(message);
});
```

- [ ] **Step 2: Verify the tests fail**

Run: `pnpm vitest run src/lib/tool-bench/executor.test.ts`

Expected: FAIL because `executeToolCall` does not exist.

- [ ] **Step 3: Add stable schemas to the registry**

In `tools.ts`, add one strict Zod schema per tool and expose it through `getToolDefinition(name)`. Keep the existing descriptions and `createToolSchemas` output stable. For example:

```ts
const toolDefinitions = {
  lookup_order: z.object({ order_id: z.string().min(1) }).strict(),
  track_shipment: z.object({ order_id: z.string().min(1) }).strict(),
  refund_payment: z
    .object({
      payment_id: z.string().min(1),
      reason: z.enum(["duplicate", "not_received", "damaged"]),
    })
    .strict(),
  cancel_subscription: z
    .object({
      subscription_id: z.string().min(1),
      timing: z.enum(["now", "period_end"]),
    })
    .strict(),
  create_ticket: z
    .object({
      customer_id: z.string().min(1),
      category: z.enum(["billing", "technical", "delivery"]),
    })
    .strict(),
  escalate_to_human: z
    .object({
      customer_id: z.string().min(1),
      priority: z.enum(["normal", "urgent"]),
    })
    .strict(),
} as const;
```

- [ ] **Step 4: Implement deterministic tool execution**

In `executor.ts`, validate by tool name, wait through an abort-aware delay, and return a fixed typed result. Use stable fixture data for every tool and keep all operations in memory:

```ts
export async function executeToolCall(
  call: ToolCall,
  signal: AbortSignal,
  delayMs = 180,
): Promise<ToolExecution> {
  const definition = getToolDefinition(call.tool);
  if (!definition) throw new Error(`Unknown tool: ${call.tool}`);
  const parsed = definition.safeParse(call.arguments);
  if (!parsed.success) throw new Error(`Invalid arguments for ${call.tool}.`);
  await abortableDelay(delayMs, signal);
  return {
    tool: call.tool,
    arguments: parsed.data,
    result: buildFixtureResult(call.tool, parsed.data),
  };
}
```

Export `abortableDelay`; it must remove its listener on resolve and reject with `signal.reason` on abort. `buildFixtureResult` must use an exhaustive switch and `assertNever` so a new registry tool cannot silently lack a renderer result.

- [ ] **Step 5: Run executor tests**

Run: `pnpm vitest run src/lib/tool-bench/executor.test.ts`

Expected: PASS, including cancellation without a pending timer.

- [ ] **Step 6: Commit the executor**

```bash
git add src/lib/tool-bench/tools.ts src/lib/tool-bench/executor.ts src/lib/tool-bench/executor.test.ts
git commit -m "Execute deterministic benchmark tools"
```

## Task 3: Build the one-lane event engine

**Files:**

- Create: `src/lib/tool-bench/lane-engine.ts`
- Create: `src/lib/tool-bench/lane-engine.test.ts`
- Modify: `src/lib/tool-bench/sample.ts`
- Remove after tests pass: `src/lib/tool-bench/engine.ts`
- Remove after tests pass: `src/lib/tool-bench/engine.test.ts`

- [ ] **Step 1: Write timeline tests**

Use a deterministic clock injected through dependencies. Assert the exact phase order and scoring:

```ts
expect(final.events.map(({ phase, status }) => [phase, status])).toEqual([
  ["decision", "started"],
  ["decision", "finished"],
  ["tool", "started"],
  ["tool", "finished"],
]);
expect(final.score).toEqual({
  toolCorrect: true,
  argumentsCorrect: true,
  correct: true,
});
expect(final.execution?.result).toMatchObject({ kind: "order" });
expect(final.timings).toMatchObject({
  decisionMs: 20,
  toolMs: 10,
  totalMs: 30,
});
```

Add focused tests for invalid tool output, provider failure, tool failure, deadline, and parent cancellation. Each failure must produce a terminal state and a matching `error` or `cancelled` event while retaining prior events.

- [ ] **Step 2: Verify timeline tests fail**

Run: `pnpm vitest run src/lib/tool-bench/lane-engine.test.ts`

Expected: FAIL because `runArenaLane` does not exist.

- [ ] **Step 3: Implement `runArenaLane`**

Use this boundary:

```ts
export type LaneDependencies = {
  provider: BenchProvider;
  execute: typeof executeToolCall;
  now?: () => number;
  timeoutMs?: number;
};

export async function runArenaLane(
  lane: LaneDefinition,
  config: ArenaConfig,
  runId: string,
  dependencies: LaneDependencies,
  parentSignal: AbortSignal,
  publish: (state: ArenaLaneState) => void,
): Promise<ArenaLaneState>;
```

Resolve the selected case by exact `caseId`, strip its expected label before the provider call, emit cloned snapshots at every phase boundary, evaluate the decision, execute any known schema-valid tool call even when it is not the expected call, and finish only after execution. Unknown tools and invalid arguments finish the lane as an error without a fabricated result. Apply one per-lane deadline with `AbortSignal.any`.

- [ ] **Step 4: Make samples lane-specific**

Replace `createSampleDependencies` with:

```ts
export function createSampleProvider(laneId: string): BenchProvider {
  return async (input, signal) => {
    const authored = BENCH_CASES.find((item) => item.id === input.id);
    if (!authored) throw new Error("Unknown sample case.");
    await abortableDelay(350 + sampleLaneIndex(laneId) * 140, signal);
    return {
      ...structuredClone(authored.expected),
      modelMs: 350 + sampleLaneIndex(laneId) * 140,
      inputTokens: null,
      outputTokens: null,
      confidence: laneId === "jev" ? 0.94 : null,
      choices:
        laneId === "jev" ? sampleRankedChoices(authored.expected.tool) : [],
    };
  };
}
```

Label every Sample result synthetic in the UI; the different authored delays demonstrate the race and are not benchmark claims.

- [ ] **Step 5: Run engine and provider tests**

Run: `pnpm vitest run src/lib/tool-bench/lane-engine.test.ts src/lib/tool-bench/providers.test.ts src/lib/tool-bench/sample.test.ts`

Expected: PASS.

- [ ] **Step 6: Remove the obsolete batch engine and commit**

```bash
git rm src/lib/tool-bench/engine.ts src/lib/tool-bench/engine.test.ts
git add src/lib/tool-bench/lane-engine.ts src/lib/tool-bench/lane-engine.test.ts src/lib/tool-bench/sample.ts
git commit -m "Run tool benchmark as independent agent lanes"
```

## Task 4: Register four real CopilotKit agents

**Files:**

- Modify: `src/lib/tool-bench/agent.ts`
- Modify: `src/lib/tool-bench/agent.test.ts`
- Modify: `src/app/api/copilotkit/[[...slug]]/route.ts`
- Modify: `src/app/api/config/route.ts`

- [ ] **Step 1: Write agent tests**

Construct `ToolArenaAgent` with a lane and provider factory, then verify the AG-UI sequence contains `RUN_STARTED`, progressive `STATE_SNAPSHOT` events, and `RUN_FINISHED`. Assert `agentId` equals `tool_bench_${lane.id}`. Add a cancellation test that calls the installed runner's stop path and expects a terminal cancelled snapshot.

- [ ] **Step 2: Verify agent tests fail**

Run: `pnpm vitest run src/lib/tool-bench/agent.test.ts`

Expected: FAIL because the current agent aggregates every lane under `tool_bench`.

- [ ] **Step 3: Make the agent lane-specific**

Use this constructor and forwarded-props schema:

```ts
const runPropsSchema = z.object({
  config: arenaConfigSchema,
  runId: z.string().uuid(),
});

export class ToolArenaAgent extends AbstractAgent {
  constructor(private readonly lane: LaneDefinition) {
    super({
      agentId: `tool_bench_${lane.id}`,
      description: `${lane.name} tool-calling arena lane`,
    });
  }
  override clone() {
    return new ToolArenaAgent(this.lane);
  }
}
```

Inside `run`, choose `createSampleProvider(lane.id)` for Sample mode. In Live mode, create only the lane's Jev or OpenRouter provider. Pass the lane, config, shared run ID, and controller signal into `runArenaLane`. Provider, tool, and cancellation outcomes publish a terminal lane snapshot followed by `RUN_FINISHED`; only invalid forwarded properties or a failure before lane state exists emits `RUN_ERROR`. Never swallow a rejected provider promise.

- [ ] **Step 4: Register the agents**

In the route, construct entries from `getLaneDefinitions()`:

```ts
const toolAgents = Object.fromEntries(
  getLaneDefinitions().map((lane) => [
    `tool_bench_${lane.id}`,
    new ToolArenaAgent(lane),
  ]),
);
const copilotRuntime = new CopilotRuntime({
  agents: { wiki_race: new WikiRaceAgent(), ...toolAgents },
  runner: new InMemoryAgentRunner(),
});
```

Update `/api/config` to return `{ lanes: definitions.map(lane => ({ ...lane, agentId: `tool_bench_${lane.id}` })) }`.

- [ ] **Step 5: Read the repository-local Next.js guides before editing the route**

Read:

- `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
- `node_modules/next/dist/docs/01-app/01-getting-started/02-project-structure.md`

Confirm the existing Node runtime and catch-all route conventions remain valid for Next.js 16.3.5.

- [ ] **Step 6: Run agent tests and typecheck**

Run: `pnpm vitest run src/lib/tool-bench/agent.test.ts && pnpm typecheck`

Expected: PASS.

- [ ] **Step 7: Commit runtime registration**

```bash
git add 'src/app/api/copilotkit/[[...slug]]/route.ts' src/app/api/config/route.ts src/lib/tool-bench/agent.ts src/lib/tool-bench/agent.test.ts
git commit -m "Register four CopilotKit arena agents"
```

## Task 5: Orchestrate four agents in the browser

**Files:**

- Modify: `src/components/tool-bench-lifecycle.ts`
- Modify: `src/components/race-lifecycle.test.ts`
- Modify: `src/components/tool-bench.tsx`
- Create: `src/components/tool-arena.test.ts`

- [ ] **Step 1: Write lifecycle and orchestration tests**

Test one lane lifecycle with the installed SDK, then test pure orchestration helpers:

```ts
expect(createArenaRun("sample", "order-details", definitions)).toMatchObject({
  config: { mode: "sample", caseId: "order-details" },
  lanes: definitions.map((lane) => ({ agentId: `tool_bench_${lane.id}` })),
});
expect(
  isArenaComplete([
    state("complete"),
    state("error"),
    state("cancelled"),
    state("unavailable"),
  ]),
).toBe(true);
```

Add a test proving a failed lane does not stop other lane promises and a Stop action targets every running agent.

- [ ] **Step 2: Verify the tests fail**

Run: `pnpm vitest run src/components/race-lifecycle.test.ts src/components/tool-arena.test.ts`

Expected: FAIL because the lifecycle expects one aggregate benchmark agent.

- [ ] **Step 3: Convert lifecycle helpers to one lane**

Export `selectLaneState`, `interruptLane`, `isTerminalLane`, and `runWithLaneLifecycle`. A fallback may replace SDK state only when it belongs to the same run and the authoritative state has not already reached a terminal state.

- [ ] **Step 4: Build the four-agent controller**

In `ToolBench`, keep one outer `CopilotKitProvider runtimeUrl="/api/copilotkit"`. Render a child controller per definition that calls `useAgent({ agentId })`, then registers `{ agent, state, run, stop }` with the arena shell. Launch with one UUID and:

```ts
await Promise.allSettled(
  controllers
    .filter(({ definition }) => sample || definition.available)
    .map(({ run }) => run({ config, runId })),
);
```

Do not reject the arena because one lane rejects. Surface each error inside its lane and mark the global race complete when every available lane is terminal.

- [ ] **Step 5: Add the case selector and view state**

Replace request-count selection with a selector sourced from `/api/config`. That route must return only `BENCH_CASES.map(({ id, prompt }) => ({ id, prompt }))`; do not expose expected labels to the client before evaluation. Store `view: "ui" | "graph"` locally. Switching view must preserve the current run ID, lane states, and global timer.

- [ ] **Step 6: Run orchestration tests**

Run: `pnpm vitest run src/components/race-lifecycle.test.ts src/components/tool-arena.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit orchestration**

```bash
git add src/components/tool-bench-lifecycle.ts src/components/race-lifecycle.test.ts src/components/tool-bench.tsx src/components/tool-arena.test.ts
git commit -m "Orchestrate synchronized CopilotKit agent lanes"
```

## Task 6: Render four conversation surfaces and prepared results

**Files:**

- Create: `src/components/tool-arena-lane.tsx`
- Create: `src/components/tool-result-card.tsx`
- Modify: `src/components/tool-arena.test.ts`
- Remove after replacement passes: `src/components/tool-bench-lane.tsx`

- [ ] **Step 1: Write server-rendering assertions**

Render a complete Jev state and assert the markup contains the identical prompt, selected tool, argument value, prepared result, exact-match status, decision time, tool time, and ranked Jev choices. Render an error state and assert it contains no fabricated result card.

- [ ] **Step 2: Verify the assertions fail**

Run: `pnpm vitest run src/components/tool-arena.test.ts`

Expected: FAIL because the conversation and prepared result components do not exist.

- [ ] **Step 3: Implement `ToolResultCard`**

Switch exhaustively on `result.kind` and render fixed labels from application code. For example, an order result renders order ID, delivery status, item count, and total; a shipment renders carrier status and ETA; a refund renders payment and refund status; cancellation, ticket, and escalation render their corresponding confirmation fields. Never render arbitrary HTML returned by a provider.

- [ ] **Step 4: Implement `ToolArenaLane`**

Render a compact conversation in this order:

```tsx
<article aria-label={`${lane.name} CopilotKit agent`}>
  <LaneHeader lane={lane} />
  <UserBubble>{lane.prompt || "Ready for the shared request."}</UserBubble>
  <AgentBubble>
    <PhaseStatus state={lane} />
    {lane.decision && (
      <ToolCallCard decision={lane.decision} score={lane.score} />
    )}
    {lane.execution && <ToolResultCard execution={lane.execution} />}
    {lane.provider === "jev" && lane.decision?.choices.length > 0 && (
      <RankedChoices choices={lane.decision.choices} />
    )}
  </AgentBubble>
  <LaneTimers timings={lane.timings} />
</article>
```

Use magenta emphasis for Jev and existing lane colors for the other agents. Label Sample decisions as synthetic. Keep tool correctness and argument correctness visible beside the selected call.

- [ ] **Step 5: Remove the old JSON-first lane**

Delete `tool-bench-lane.tsx` only after no imports remain.

- [ ] **Step 6: Run component tests and accessibility lint**

Run: `pnpm vitest run src/components/tool-arena.test.ts && pnpm lint`

Expected: PASS with no accessibility lint errors.

- [ ] **Step 7: Commit conversation UI**

```bash
git rm src/components/tool-bench-lane.tsx
git add src/components/tool-arena-lane.tsx src/components/tool-result-card.tsx src/components/tool-arena.test.ts
git commit -m "Show tool calls as CopilotKit conversations"
```

## Task 7: Add the synchronized execution graph and timers

**Files:**

- Create: `src/components/tool-arena-graph.tsx`
- Modify: `src/components/tool-bench-metrics.tsx`
- Modify: `src/components/tool-arena.test.ts`

- [ ] **Step 1: Write graph and timer tests**

Assert `buildTrace(events, totalMs)` produces ordered decision, tool, and render nodes with percentages clamped from 0 to 100. Assert zero-duration and cancelled lanes remain renderable. Test the global clock with fake timers and confirm it freezes when all available lanes are terminal.

- [ ] **Step 2: Verify graph tests fail**

Run: `pnpm vitest run src/components/tool-arena.test.ts`

Expected: FAIL because the trace builder and arena clock do not exist.

- [ ] **Step 3: Implement a pure trace builder**

```ts
export function buildTrace(events: ArenaEvent[], scaleMs: number) {
  const safeScale = Math.max(1, scaleMs);
  return events.map((event) => ({
    ...event,
    left: Math.min(100, Math.max(0, (event.atMs / safeScale) * 100)),
    width:
      event.durationMs === null
        ? 0
        : Math.min(100, Math.max(1, (event.durationMs / safeScale) * 100)),
  }));
}
```

- [ ] **Step 4: Implement `ToolArenaGraph`**

Use the largest available `totalMs` as the shared scale. Render one labelled row per agent and nodes for Prompt, Decision, Tool, and UI. The Prompt node begins at zero. Use semantic text alongside visual bars so phase, status, and duration remain readable without color.

- [ ] **Step 5: Split the timers**

Keep the global race timer in the header. In every lane and graph row display Decision, Tool, and Total. Record render lifecycle time in the client controller as the interval from receiving an execution result until the next `requestAnimationFrame`. Store it in a `{ runId, renderMs }` overlay keyed by lane ID and merge it through a pure `withRenderCommit(state, overlay)` helper so a later AG-UI snapshot cannot erase the client measurement. Append the render-finished event once per run and label the phase `UI commit` in the methodology and state contract.

- [ ] **Step 6: Run graph tests**

Run: `pnpm vitest run src/components/tool-arena.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit graph and timing UI**

```bash
git add src/components/tool-arena-graph.tsx src/components/tool-bench-metrics.tsx src/components/tool-arena.test.ts
git commit -m "Add synchronized tool execution graph"
```

## Task 8: Finish results, styling, documentation, and verification

**Files:**

- Create: `src/components/tool-arena-summary.tsx`
- Modify: `src/components/tool-bench.css`
- Modify: `src/components/tool-bench.tsx`
- Modify: `src/components/tool-arena.test.ts`
- Modify: `README.md`

- [ ] **Step 1: Write summary tests**

Assert the summary independently identifies highest accuracy and fastest exact completion. A faster incorrect lane must never receive the fastest-exact label. Ties must list every tied lane.

- [ ] **Step 2: Verify summary tests fail**

Run: `pnpm vitest run src/components/tool-arena.test.ts`

Expected: FAIL because `summarizeArena` does not exist.

- [ ] **Step 3: Implement the summary**

Create a pure `summarizeArena(states)` helper that returns:

```ts
type ArenaSummary = {
  highestAccuracy: string[];
  fastestExact: string[];
  completed: number;
  available: number;
};
```

Compute accuracy from exact-call booleans and compute fastest only among exact completed lanes. Render both outcomes with their measured values and retain the small-suite methodology warning.

- [ ] **Step 4: Apply the arena layout**

In `tool-bench.css`, keep the current dark visual language and add:

- A desktop 2-by-2 grid and a single-column layout below 900px.
- Compact user and agent bubbles with a maximum lane body height and internal scrolling.
- Magenta Jev border, phase pulse, and graph trace.
- Tool-call and tool-result cards that remain legible at 320px lane width.
- A segmented UI/Graph switch with visible focus styles.
- A graph viewport with a fixed agent-label column and scrollable shared time axis.
- `prefers-reduced-motion` rules that remove pulses and animated bar transitions.

- [ ] **Step 5: Update methodology and README**

Document that Jev uses structured choice questions while comparison providers use native function calling; all lanes share prompts, tools, candidates, evaluation, and local execution. Define Decision, Tool, UI commit, and Total timing boundaries. State that Sample timings are synthetic and the included cases do not establish general model performance.

- [ ] **Step 6: Run the focused suite**

Run:

```bash
pnpm vitest run src/lib/tool-bench src/components/tool-arena.test.ts src/components/race-lifecycle.test.ts
```

Expected: all focused tests PASS with no skipped tests.

- [ ] **Step 7: Run the full quality gate**

Run in order:

```bash
pnpm format
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
git diff --check
```

Expected: every command exits zero.

- [ ] **Step 8: Perform the browser verification**

Start `pnpm dev`, open `http://127.0.0.1:3000/tool-bench`, and verify:

1. Sample starts all four lanes from one request.
2. Decision and Tool timers advance independently; Total freezes per lane.
3. Jev shows ranked choices and remains visually distinct.
4. UI and Graph switches preserve the run.
5. A lane failure does not stop the remaining agents.
6. Stop cancels active agents and preserves completed events.
7. The layout is readable at 1440px and 390px widths.
8. Live mode exposes no API key in browser requests or rendered markup.

- [ ] **Step 9: Commit the finished arena**

```bash
git add src/components/tool-arena-summary.tsx src/components/tool-bench.css src/components/tool-bench.tsx src/components/tool-arena.test.ts README.md
git commit -m "Complete visual tool-calling arena"
```

- [ ] **Step 10: Re-run final repository checks**

Run: `git status --short --branch && git log --oneline -8`

Expected: clean feature branch with focused commits and no `.env.local`, generated artifact, or recording file tracked.
