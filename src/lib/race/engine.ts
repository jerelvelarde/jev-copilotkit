import { abortable } from "../cancellation";
import {
  initialRace,
  normalizeTitle,
  raceConfigSchema,
  type Article,
  type Decision,
  type LaneDefinition,
  type RaceConfig,
  type RaceDependencies,
  type RaceState,
} from "./types";

export async function runRace(
  configInput: RaceConfig,
  definitions: LaneDefinition[],
  dependencies: RaceDependencies,
  parentSignal: AbortSignal,
  publish: (state: RaceState) => void,
): Promise<void> {
  const config = raceConfigSchema.parse(configInput);
  const deadline = AbortSignal.timeout(dependencies.durationMs ?? 90_000);
  const signal = AbortSignal.any([parentSignal, deadline]);
  const state = initialRace(config, definitions);
  state.runId = crypto.randomUUID();
  state.status = "running";
  const emit = () => publish(structuredClone(state));
  // A race-local cache gives all lanes the same article snapshot. Failed fetches
  // remain failures for this race; a new race gets a fresh cache.
  const cache = new Map<string, Promise<Article>>();
  const loadPage = (title: string) => {
    signal.throwIfAborted();
    const key = normalizeTitle(title);
    if (!cache.has(key)) cache.set(key, dependencies.loadPage(title, signal));
    return abortable(cache.get(key)!, signal);
  };
  for (const lane of state.lanes) {
    lane.status = dependencies.providers[lane.id] ? "loading" : "unavailable";
    if (lane.status === "unavailable")
      lane.error =
        lane.provider === "jev"
          ? "Add TYPESAFE_API_KEY to .env.local to enable Jev."
          : "Add OPENROUTER_API_KEY to .env.local to enable comparison models.";
  }
  emit();
  if (state.lanes.every((l) => l.status === "unavailable")) {
    state.status = "complete";
    emit();
    return;
  }
  const setupStart = performance.now();
  let start: Article, target: Article;
  try {
    [start, target] = await Promise.all([
      loadPage(config.start),
      loadPage(config.target),
    ]);
    state.setupMs = performance.now() - setupStart;
    state.targetTitle = target.title;
  } catch (error) {
    for (const lane of state.lanes.filter((l) => l.status !== "unavailable")) {
      lane.status = parentSignal.aborted ? "cancelled" : "error";
      lane.error = deadline.aborted
        ? "Race exceeded its 90-second time budget."
        : error instanceof Error
          ? error.message
          : "Could not load the starting articles.";
    }
    state.status = parentSignal.aborted ? "cancelled" : "complete";
    emit();
    return;
  }
  // All lanes start after the same start/target setup has completed.
  const started = performance.now();
  const wallStarted = Date.now();
  await Promise.all(
    state.lanes.map(async (lane) => {
      if (lane.status === "unavailable") return;
      lane.startedAt = wallStarted;
      lane.current = start;
      lane.path = [start.title];
      const visitedIds = new Set([start.id]);
      const visitedTitles = new Set([
        normalizeTitle(start.title),
        normalizeTitle(config.start),
      ]);
      try {
        while (lane.hops.length < config.maxHops) {
          signal.throwIfAborted();
          const current = lane.current!;
          if (current.id === target.id) {
            lane.status = "finished";
            break;
          }
          const candidates = [...new Set(current.links)].filter(
            (t) => !visitedTitles.has(normalizeTitle(t)),
          );
          if (!candidates.length) {
            lane.status = "exhausted";
            lane.error = "No unvisited article links remain.";
            break;
          }
          lane.status = "thinking";
          lane.elapsedMs = performance.now() - started;
          emit();
          const direct = candidates.find(
            (t) => normalizeTitle(t) === normalizeTitle(target.title),
          );
          const decisionBegan = performance.now();
          let selected: Decision;
          try {
            selected = direct
              ? {
                  title: direct,
                  confidence: null,
                  choices: [],
                  modelMs: 0,
                  inputTokens: 0,
                  modelCalls: 0,
                  method: "direct",
                }
              : await abortable(
                  dependencies.providers[lane.id](
                    {
                      page: current,
                      target,
                      visited: [...lane.path],
                      candidates,
                    },
                    signal,
                  ),
                  signal,
                );
          } catch (error) {
            lane.modelMs += performance.now() - decisionBegan;
            throw error;
          }
          signal.throwIfAborted();
          if (!candidates.includes(selected.title))
            throw new Error(
              "The model selected an article outside the current page's links.",
            );
          lane.modelMs += selected.modelMs;
          lane.status = "loading";
          lane.elapsedMs = performance.now() - started;
          emit();
          const fetchStart = performance.now();
          let next: Article;
          try {
            next = await loadPage(selected.title);
          } finally {
            lane.fetchMs += performance.now() - fetchStart;
          }
          signal.throwIfAborted();
          lane.elapsedMs = performance.now() - started;
          if (visitedIds.has(next.id)) {
            lane.status = "exhausted";
            lane.error = "A redirect returned to an already visited article.";
            break;
          }
          lane.hops.push({
            ...selected,
            from: current.title,
            to: next.title,
            elapsedMs: lane.elapsedMs,
            candidates: candidates.length,
          });
          lane.path.push(next.title);
          lane.current = next;
          if (next.id === target.id) {
            lane.status = "finished";
            emit();
            break;
          }
          visitedIds.add(next.id);
          visitedTitles.add(normalizeTitle(next.title));
          visitedTitles.add(normalizeTitle(selected.title));
          emit();
        }
        if (lane.status !== "finished" && lane.status !== "exhausted") {
          lane.status = "exhausted";
          lane.error = `Reached the ${config.maxHops}-hop limit.`;
        }
      } catch (error) {
        lane.status = parentSignal.aborted ? "cancelled" : "error";
        lane.error = parentSignal.aborted
          ? "Stopped by you."
          : deadline.aborted
            ? "Race exceeded its time budget."
            : error instanceof Error
              ? error.message
              : "The race could not continue.";
      }
      lane.elapsedMs = performance.now() - started;
      emit();
    }),
  );
  state.status = parentSignal.aborted ? "cancelled" : "complete";
  emit();
}
