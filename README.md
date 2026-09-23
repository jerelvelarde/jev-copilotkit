# Agent arenas · CopilotKit × Jev

A side-by-side Wikipedia link race inspired by the [Wikiracing segment in Matthew Berman's video](https://www.youtube.com/watch?v=2z-7pIj57f8&t=145s) and [TypeSafe's original demonstration](https://typesafe.ai/blog/introducing-system-one-models-and-jev).

Choose a starting article and a destination. Jev and optional comparison models choose links, and CopilotKit streams their paths into a live race interface.

A second demo, the **[Tool-call arena](http://localhost:3000/tool-bench)**, races four CopilotKit agents through one support request: each picks a tool, runs the same local tool, and renders the result. Both demos use the same configured providers and the same dark, four-pane arena layout.

## Run locally

Requires Node.js 22+ and pnpm.

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

Open [localhost:3000](http://localhost:3000). Both arenas run live provider requests. Configure at least one provider key before starting; lanes without a key remain visibly unavailable.

## Enable live Jev

1. Open the [TypeSafe console](https://console.typesafe.ai) and sign in. If your account needs early-access approval, complete that flow first.
2. Create an API key through the account's API-key controls once access is enabled. See the [official quickstart](https://docs.typesafe.ai/introduction/quickstart).
3. Add `TYPESAFE_API_KEY` to the ignored `.env.local` file. Keep it server-side and out of chat, screenshots, logs, and git. A process-injected environment variable works too.
4. Restart the dev server and reload the app.

```dotenv
TYPESAFE_API_KEY=your-key-here
JEV_MODEL=jev-latest
```

Jev can run alone. The other lanes clearly show that they are unavailable until you configure their provider.

## Comparison models

Both arenas use direct provider keys: `OPENAI_API_KEY` for GPT-5.6 Luna, `ANTHROPIC_API_KEY` for Claude Sonnet 5, and `GOOGLE_API_KEY` for Gemini 3.8 Flash. Each lane runs independently; missing keys leave only that lane unavailable. Override model IDs with `OPENAI_MODEL`, `ANTHROPIC_MODEL`, and `GOOGLE_MODEL`. Timing comes from real provider requests.

These are configurable baselines, **not the exact benchmark setup in the source video**. Live runs use your provider balance. The app does not estimate costs from missing usage or promise a speed advantage.

## Race arena

The screenshot-inspired dark arena keeps all four racers on screen on desktop. Press **Go!** to start; use **Setup** for the course and hop limit. Each lane highlights **Complete** when it reaches the destination. After all lanes settle, the fastest finisher is revealed as the winner. The top clock tracks elapsed race time, while the bottom bars compare model time. Each pane retains its article trail and previous decisions after completion. Narrow screens stack the panels.

## How CopilotKit is used

The frontend uses `CopilotKitProvider`, `useAgent`, and `useCopilotKit` from the published `@copilotkit/react-core/v2` entry point. Race controls invoke `copilotkit.runAgent`, and the entire board renders the agent's shared state. Stop uses `copilotkit.stopAgent`.

The server registers `WikiRaceAgent` and one `ToolArenaAgent` per tool-arena lane (`tool_bench_jev`, `tool_bench_gpt`, `tool_bench_sonnet`, `tool_bench_gemini`), all AG-UI `AbstractAgent` implementations, with `CopilotRuntime`. They emit `RUN_STARTED`, successive `STATE_SNAPSHOT` events, and `RUN_FINISHED` or `RUN_ERROR`. The tool arena starts all four agents from one run specification, so each lane runs, fails, and stops independently. No chat LLM is needed to control the arenas, and there is no separate custom SSE client behind the UI.

Main files:

- [Race engine](src/lib/race/engine.ts): legal moves, cancellation, deadlines, visited-page tracking, per-lane state, and race-local caching.
- [Wikipedia integration](src/lib/race/wikipedia.ts): canonical page IDs, introductions, and article links from one MediaWiki REST page request.
- [Model adapters](src/lib/race/providers.ts): Jev's typed decisions and native OpenAI, Anthropic, and Google link-choice calls.
- [CopilotKit agent](src/lib/race/agent.ts): engine-to-AG-UI connection.
- [Arena lane engine](src/lib/tool-bench/lane-engine.ts): one decision, one tool execution, the normalized event timeline, exact scoring, cancellation, and per-lane deadlines.
- [Local tool executor](src/lib/tool-bench/executor.ts): strict argument schemas and deterministic, side-effect-free tool results.
- [Tool benchmark adapters](src/lib/tool-bench/providers.ts): typed Jev questions and direct provider function calls.
- [Labeled support cases](src/lib/tool-bench/cases.ts): the versioned `support-v1` dataset.

## Tool-call arena

Open `/tool-bench`, pick one support request, and press **Start the race**. Four CopilotKit agents receive the same run specification at the same moment and each one:

1. Shows the identical user message.
2. Chooses a tool and its arguments.
3. Runs that tool through the shared local registry.
4. Renders the typed tool result in a prepared card.

The six tools cover order lookup, shipment tracking, refunds, subscription cancellation, support tickets, and human escalation. They execute in memory, are deterministic, and have no side effects: no refunds, cancellations, or external calls happen. A provider can influence which tool runs, never what the result card renders.

Switch between **UI** and **Graph** without restarting. The graph draws one `Prompt → Decision → Tool → UI` trace per agent on a shared time axis, with each node repeating its phase, status, and duration as text so it stays readable without color. Each panel highlights **Complete** when it finishes; the fastest exact-call winner appears after all lanes settle. **Stop** aborts every running agent and keeps the completed events visible.

Jev selects the tool and candidate-bound argument fields in one request using typed Choice questions. The comparison models use native function calling through their direct APIs. They receive the same tool descriptions, entity candidates, and support request; labeled answers are excluded from every provider input. This compares two practical integration approaches, not identical model protocols.

**Timing boundaries**

- **Decision**: request dispatch until a valid tool call or a provider failure.
- **Tool**: local tool invocation until a result or a tool failure.
- **UI commit**: tool result received until the browser commits the rendered lane. This is an application lifecycle measurement, not a browser paint benchmark. It is measured in the client and merged into the lane state, so a later server snapshot cannot erase it.
- **Total**: the sum of that lane's phases. The header clock is wall-clock race time from launch until every participating agent settled.

**Scoring**

- **Tool accuracy** checks the selected tool name; **exact-call accuracy** also requires every argument key and value, with no extra or missing arguments.
- After every lane settles, the summary names the fastest **exact** lane as winner and reports accuracy separately. A faster incorrect lane wins nothing. Ties list every tied agent.
- A provider failure, an unknown tool, or invalid arguments ends that lane as a visible error with no fabricated result. One failing lane never stops the other three.

This is a small, curated demonstration. It is useful for inspecting behavior and recording a demo. A single request on this suite does not establish general model performance.

## Race rules and measurement

- Only article-namespace links returned by the current Wikipedia page are offered. Redirects resolve to canonical page IDs. Models cannot invent a navigable URL.
- The target is reached only when its canonical ID matches. Direct target links are followed deterministically by **every** lane and are marked `direct` in the trace; no inference is billed for that move.
- Visited articles are excluded. A redirect back to a visited page terminates that lane. There is no hidden search, lookahead, backtracking, or cached winning route in Live mode.
- Jev accepts at most 255 choices. Larger link sets are all scored with independent Noul questions in batches of 128 (up to three batches concurrently); the top 255 enter a final Choice call. Ties retain source order. LLM baselines receive the full available set and return one validated index. The policies differ and are disclosed rather than presented as a controlled benchmark.
- Wikipedia retrieval uses one MediaWiki REST page-with-HTML response and is capped at 5,000 links per article. An oversized article fails explicitly; the app never silently drops the rest of its links. Transient rate limits receive bounded retries.
- All lanes start after the same start/target setup. The setup duration is separate. A cache shared only within each race prevents repeated Wikipedia fetches; later lanes can benefit from earlier reads. Cached data is not a shortest-path solver.
- **Elapsed time** covers a lane's full run after setup. **Model time** measures wall-clock time in its decision adapter, including all scoring and choice requests. Parallel scoring times are not added together. Wikipedia wait time is tracked separately. Network conditions, caching, and hop count all affect the results.
- Confidence is shown only when a provider returns it. The direct comparison models do not fabricate confidence. Jev confidence is not proof that a link is optimal.
- Races default to 12 hops (maximum 20), have a 90-second overall deadline, and can be stopped. Wikipedia requests time out after 12 seconds; model requests have provider-specific timeouts. Provider and Wikipedia errors remain visible.

## Verification

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
```

Tests cover legal and invalid moves, redirects, cycles, hop/deadline limits, cancellation, lane isolation, Wikipedia page parsing and rate-limit retries, provider schema validation, Jev's two-stage selection, native provider link calls, and the AG-UI agent lifecycle. Tool arena tests cover exact argument scoring, label exclusion, native-call contracts, strict local tool schemas and their typed results, event ordering and phase durations, provider/tool/deadline/cancellation outcomes, per-lane agent identity, cancellation through the actual agent runner, independent lane failure during a synchronized launch, the UI-commit overlay, trace geometry, the race clock, conversation and result rendering, and the accuracy/speed summary.

This is a local prototype, served on `127.0.0.1` by default. Before public hosting, add authentication, per-user quotas, persistence, and a suitable deployment timeout. Do not expose a credential-backed demo endpoint without access controls.

## Credits

[CopilotKit](https://www.copilotkit.ai) provides the agent–UI connection. [TypeSafe](https://typesafe.ai) provides Jev. Live article text and links come from [Wikipedia](https://en.wikipedia.org), with source links retained in the UI; text is available under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). This project is an independent recreation, not an official benchmark from TypeSafe or Wikimedia.
