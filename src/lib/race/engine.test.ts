import { describe, expect, it, vi } from "vitest";
import { runRace } from "./engine";
import {
  articleUrl,
  DEFAULT_LANES,
  type Article,
  type Decision,
  type RaceDependencies,
  type RaceState,
} from "./types";

const page = (id: number, title: string, links: string[]): Article => ({
  id,
  title,
  links,
  extract: title,
  url: articleUrl(title),
});
const decision = (title: string): Decision => ({
  title,
  confidence: 0.8,
  choices: [],
  modelMs: 12,
  inputTokens: 10,
  modelCalls: 1,
  method: "choice",
});
const defs = DEFAULT_LANES.slice(0, 1).map((l) => ({ ...l, available: true }));
const config = {
  start: "Start",
  target: "Goal",
  mode: "live" as const,
  maxHops: 3,
};
const graph: Record<string, Article> = {
  Start: page(1, "Start", ["Middle", "Wrong"]),
  Middle: page(2, "Middle", ["Goal"]),
  Goal: page(3, "Goal", []),
  Alias: page(3, "Goal", []),
  Wrong: page(4, "Wrong", ["Start"]),
};
function dependencies(): RaceDependencies {
  return {
    loadPage: vi.fn(async (title) => {
      if (!graph[title]) throw new Error("Missing article");
      return graph[title];
    }),
    providers: { jev: vi.fn(async () => decision("Middle")) },
  };
}
async function race(
  deps = dependencies(),
  overrides = {},
  signal = new AbortController().signal,
) {
  const snapshots: RaceState[] = [];
  await runRace({ ...config, ...overrides }, defs, deps, signal, (s) =>
    snapshots.push(structuredClone(s)),
  );
  return { result: snapshots.at(-1)!, snapshots };
}
describe("Wikipedia race rules", () => {
  it("streams progress and wins through legal links", async () => {
    const { result, snapshots } = await race();
    expect(result.lanes[0].path).toEqual(["Start", "Middle", "Goal"]);
    expect(result.lanes[0].status).toBe("finished");
    expect(result.lanes[0].hops[1].method).toBe("direct");
    expect(snapshots.some((s) => s.lanes[0].status === "thinking")).toBe(true);
    expect(result.lanes[0].modelMs).toBe(12);
  });
  it("rejects hallucinated links before navigation", async () => {
    const deps = dependencies();
    deps.providers.jev = async () => decision("Invented");
    const { result } = await race(deps);
    expect(result.lanes[0].status).toBe("error");
    expect(result.lanes[0].path).toEqual(["Start"]);
    expect(deps.loadPage).not.toHaveBeenCalledWith(
      "Invented",
      expect.anything(),
    );
  });
  it("recognizes canonical redirects as the target", async () => {
    const deps = dependencies();
    deps.loadPage = async (title) =>
      title === "Start" ? page(1, "Start", ["Alias"]) : graph[title];
    deps.providers.jev = async () => decision("Alias");
    expect((await race(deps)).result.lanes[0].status).toBe("finished");
  });
  it("same-page starts finish with zero decisions", async () => {
    const deps = dependencies();
    const { result } = await race(deps, { start: "Goal" });
    expect(result.lanes[0].status).toBe("finished");
    expect(result.lanes[0].hops).toHaveLength(0);
    expect(deps.providers.jev).not.toHaveBeenCalled();
  });
  it("respects the hop budget", async () => {
    const { result } = await race(dependencies(), { maxHops: 1 });
    expect(result.lanes[0].status).toBe("exhausted");
    expect(result.lanes[0].hops).toHaveLength(1);
  });
  it("does not revisit pages through cycles", async () => {
    const deps = dependencies();
    deps.providers.jev = async () => decision("Wrong");
    const { result } = await race(deps);
    expect(result.lanes[0].status).toBe("exhausted");
    expect(result.lanes[0].path).toEqual(["Start", "Wrong"]);
  });
  it("distinguishes titles that differ after the first letter", async () => {
    const deps = dependencies();
    deps.loadPage = async (title) =>
      title === "US" ? page(100, "United States", []) : page(200, "Us", []);
    const { result } = await race(deps, { start: "US", target: "Us" });
    expect(result.targetTitle).toBe("Us");
    expect(result.lanes[0].status).toBe("exhausted");
  });
  it("does not count a redirect back to a visited canonical page as progress", async () => {
    const deps = dependencies();
    deps.loadPage = async (title) =>
      title === "Goal" ? graph.Goal : page(1, "Start", ["Alias"]);
    deps.providers.jev = async () => decision("Alias");
    const { result } = await race(deps);
    expect(result.lanes[0].path).toEqual(["Start"]);
    expect(result.lanes[0].hops).toHaveLength(0);
    expect(result.lanes[0].status).toBe("exhausted");
  });
  it("cancels without making a later hop", async () => {
    const controller = new AbortController();
    const deps = dependencies();
    deps.providers.jev = async () => {
      controller.abort();
      return decision("Middle");
    };
    const { result } = await race(deps, {}, controller.signal);
    expect(result.status).toBe("cancelled");
    expect(result.lanes[0].path).toEqual(["Start"]);
  });
  it("marks missing providers unavailable", async () => {
    const deps = dependencies();
    deps.providers = {};
    expect((await race(deps)).result.lanes[0].status).toBe("unavailable");
  });
  it("keeps a failed lane from stopping other racers", async () => {
    const deps = dependencies();
    deps.providers.gpt = async () => {
      throw new Error("Provider offline");
    };
    let result: RaceState | undefined;
    await runRace(
      config,
      DEFAULT_LANES.slice(0, 2),
      deps,
      new AbortController().signal,
      (s) => {
        result = s;
      },
    );
    expect(result?.lanes[0].status).toBe("finished");
    expect(result?.lanes[1].status).toBe("error");
  });
  it("terminates a provider that never resolves when its time budget expires", async () => {
    const deps = dependencies();
    deps.durationMs = 15;
    deps.providers.jev = () => new Promise(() => {});
    const { result } = await race(deps);
    expect(result.lanes[0].status).toBe("error");
    expect(result.lanes[0].error).toContain("time budget");
  });
});
