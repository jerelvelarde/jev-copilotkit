# Wiki race — CopilotKit + Jev

The user selected the Wikiracing demonstration from Matthew Berman's video as the project direction, superseding the adaptive sales workspace proposal.

## Experience

Rebuild the side-by-side Wikipedia race shown at 2:25–3:09: choose a start article and target, start the race, and watch four lanes accumulate legitimate article hops. Each lane shows its current article, path, elapsed time, model time, and status. Jev is the primary racer; up to three configurable LLM baselines use OpenRouter. Unconfigured providers are visibly unavailable. A separate, clearly labeled sample mode works without credentials and does not claim to reproduce real inference or benchmark results.

CopilotKit is the actual application transport: one server-side AG-UI race agent streams shared race state to the React frontend through the CopilotKit runtime. The race controls invoke that agent; the UI observes its state. A headless CopilotKit integration is appropriate because the core experience is watching and controlling a race, rather than reading chat messages.

## Rules and decisions

- Only follow links returned by the current article's Wikipedia API response, restricted to article namespace. Resolve redirects and compare canonical page IDs to detect success.
- Fetch all link continuation pages; fail explicitly if the bounded retrieval limit is exceeded. Prevent revisiting canonical pages. A direct target link is a deterministic terminal move for every provider, recorded separately from model decisions.
- Jev makes a Choice among up to 255 candidate links. For larger sets, score links independently in bounded batches, then choose among the highest-ranked 255. All candidates participate in scoring. LLM baselines receive the full available set within the same explicit page limit, with their policy disclosed in the UI and README.
- Validate every returned choice against the offered candidate IDs. Never allow model text to become a URL or executable instruction.
- Use one race-local Wikipedia cache shared by lanes. Keep external fetch time separate from model request time; show end-to-end time and disclose caching. No claims about matching the source video's speed.
- Bound races by hop count, duration, and cancellation. Stop aborts outstanding provider/network work. A failed lane does not erase other lanes' results. A new race receives fresh state.
- API keys stay server-side. Live mode never silently falls back to sample mode.

## UI

A spacious, pale CopilotKit-branded surface with a compact header, large Wiki race title, start/target controls, curated challenge buttons, Live/Sample mode selection, a responsive two-by-two race grid, and an expandable decision log. Each lane has an article preview, a hop trail, timing counters, and an inspectable list of choices. Source links and Wikipedia attribution remain visible.

## Verification

Tests cover invalid moves, target redirects, same-page starts, cycles, deadlines, cancellation, per-lane errors, candidate limits, and provider response validation. Check CopilotKit state streaming end-to-end with the sample engine, then verify live Wikipedia retrieval separately. Run formatting, lint, typecheck, unit/integration tests, production build, desktop and narrow browser checks. Report live model verification as blocked unless credentials are configured.

## Sources

- Video: https://www.youtube.com/watch?v=2z-7pIj57f8&t=145s
- Original demo and 255-choice constraint: https://typesafe.ai/blog/introducing-system-one-models-and-jev
- Jev API: https://docs.typesafe.ai/introduction/quickstart
- Wikipedia links: https://www.mediawiki.org/wiki/API:Links
- CopilotKit: https://docs.copilotkit.ai/reference/v2

## Build scope

One local Next.js app, no account system or deployed service. Built-in sample scenarios demonstrate the interface only. Baseline model IDs are configurable and displayed exactly; this is a recreation of the interaction, not a reproduction of TypeSafe's benchmark conditions.
