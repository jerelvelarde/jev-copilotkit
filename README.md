# Wiki race · CopilotKit × Jev

A side-by-side Wikipedia link race inspired by the [Wikiracing segment in Matthew Berman's video](https://www.youtube.com/watch?v=2z-7pIj57f8&t=145s) and [TypeSafe's original demonstration](https://typesafe.ai/blog/introducing-system-one-models-and-jev).

Choose a starting article and a destination. Jev and optional comparison models choose links, and CopilotKit streams their paths into a live race interface.

## Run locally

Requires Node.js 22+ and pnpm.

```sh
pnpm install --frozen-lockfile
cp .env.example .env.local
pnpm dev
```

Open [localhost:3000](http://localhost:3000). **Sample mode works without keys.** Its routes, article introductions, and delays are authored illustrations—not recorded model runs, verified Wikipedia routes, or benchmark results. Three preset challenges demonstrate the interface. Sample mode never calls an AI provider.

## Enable live Jev

1. Open the [TypeSafe console](https://console.typesafe.ai) and sign in. If your account needs early-access approval, complete that flow first.
2. Create an API key through the account's API-key controls once access is enabled. See the [official quickstart](https://docs.typesafe.ai/introduction/quickstart).
3. Add `TYPESAFE_API_KEY` to the ignored `.env.local` file. Keep it server-side and out of chat, screenshots, logs, and git. A process-injected environment variable works too.
4. Restart the dev server, reload the app, and select **Live**.

```dotenv
TYPESAFE_API_KEY=your-key-here
JEV_MODEL=jev-latest
```

Jev can run alone. The other lanes clearly show that they are unavailable until you configure their provider.

## Optional comparison models

Set `OPENROUTER_API_KEY` to enable all three LLM lanes through [OpenRouter](https://openrouter.ai). The defaults are `openai/gpt-4.1-mini`, `anthropic/claude-haiku-4.5`, and `anthropic/claude-sonnet-4.6`. Override them using `BASELINE_MODEL_1`, `BASELINE_MODEL_2`, and `BASELINE_MODEL_3`; exact model IDs appear in the interface.

These are configurable baselines, **not the exact benchmark setup in the source video**. Live runs use your provider balance. The app does not estimate costs from missing usage or promise a speed advantage.

## How CopilotKit is used

The frontend uses `CopilotKitProvider`, `useAgent`, and `useCopilotKit` from the published `@copilotkit/react-core/v2` entry point. Race controls invoke `copilotkit.runAgent`, and the entire board renders the agent's shared state. Stop uses `copilotkit.stopAgent`.

The server registers `WikiRaceAgent`, an AG-UI `AbstractAgent`, with `CopilotRuntime`. It emits `RUN_STARTED`, successive `STATE_SNAPSHOT` events, and `RUN_FINISHED` or `RUN_ERROR`. No chat LLM is needed to control the race, and there is no separate custom SSE client behind the UI.

Main files:

- [Race engine](src/lib/race/engine.ts): legal moves, cancellation, deadlines, visited-page tracking, per-lane state, and race-local caching.
- [Wikipedia integration](src/lib/race/wikipedia.ts): canonical page IDs, introductions, article links, and complete pagination.
- [Model adapters](src/lib/race/providers.ts): Jev's typed decisions and optional OpenRouter responses.
- [CopilotKit agent](src/lib/race/agent.ts): engine-to-AG-UI connection.
- [Sample environment](src/lib/race/sample.ts): clearly synthetic, credential-free demonstration.

## Race rules and measurement

- Only article-namespace links returned by the current Wikipedia page are offered. Redirects resolve to canonical page IDs. Models cannot invent a navigable URL.
- The target is reached only when its canonical ID matches. Direct target links are followed deterministically by **every** lane and are marked `direct` in the trace; no inference is billed for that move.
- Visited articles are excluded. A redirect back to a visited page terminates that lane. There is no hidden search, lookahead, backtracking, or cached winning route in Live mode.
- Jev accepts at most 255 choices. Larger link sets are all scored with independent Noul questions in batches of 128 (up to three batches concurrently); the top 255 enter a final Choice call. Ties retain source order. LLM baselines receive the full available set and return one validated index. The policies differ and are disclosed rather than presented as a controlled benchmark.
- Wikipedia retrieval is capped at 5,000 links per article and 20 pagination calls. An oversized article fails explicitly; the app never silently drops the rest of its links.
- All lanes start after the same start/target setup. The setup duration is separate. A cache shared only within each race prevents repeated Wikipedia fetches; later lanes can benefit from earlier reads. Cached data is not a shortest-path solver.
- **Elapsed time** covers a lane's full run after setup. **Model time** measures wall-clock time in its decision adapter, including all scoring and choice requests. Parallel scoring times are not added together. Wikipedia wait time is tracked separately. Network conditions, caching, and hop count all affect the results.
- Confidence is shown only when a provider returns it. OpenRouter and sample mode do not fabricate confidence. Jev confidence is not proof that a link is optimal.
- Races default to 12 hops (maximum 20), have a 90-second overall deadline, and can be stopped. Wikipedia requests time out after 12 seconds; model requests after 20 seconds. Live errors remain errors and never become sample results.

## Verification

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
```

Tests cover legal and invalid moves, redirects, cycles, hop/deadline limits, cancellation, lane isolation, Wikipedia pagination, provider schema validation, Jev's two-stage selection, and an entire sample race through the AG-UI agent.

This is a local prototype, served on `127.0.0.1` by default. Before public hosting, add authentication, per-user quotas, persistence, and a suitable deployment timeout. Do not expose a credential-backed demo endpoint without access controls.

## Credits

[CopilotKit](https://www.copilotkit.ai) provides the agent–UI connection. [TypeSafe](https://typesafe.ai) provides Jev. Live article text and links come from [Wikipedia](https://en.wikipedia.org), with source links retained in the UI; text is available under [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/). Sample introductions are locally authored. This project is an independent recreation, not an official benchmark from TypeSafe or Wikimedia.
