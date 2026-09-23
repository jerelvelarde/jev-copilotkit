import { z } from "zod";

const title = z
  .string()
  .trim()
  .min(1, "Enter an article title.")
  .max(200)
  .refine(
    (v) => !/[\u0000-\u001f|#]/.test(v),
    "Use a Wikipedia article title, without fragments or separators.",
  );
export const raceConfigSchema = z.object({
  start: title,
  target: title,
  mode: z.literal("live"),
  maxHops: z.number().int().min(1).max(20).default(12),
});
export type RaceConfig = z.infer<typeof raceConfigSchema>;
export type LaneDefinition = {
  id: string;
  name: string;
  model: string;
  provider: "jev" | "openrouter" | "openai" | "anthropic" | "google";
  available: boolean;
  color: "mint" | "blue" | "orange" | "purple";
};
export type Article = {
  id: number;
  title: string;
  extract: string;
  url: string;
  links: string[];
};
export type Choice = { title: string; probability: number };
export type Decision = {
  title: string;
  confidence: number | null;
  choices: Choice[];
  modelMs: number;
  inputTokens: number | null;
  modelCalls: number;
  method: "choice" | "rank+choice" | "direct";
};
export type Hop = Decision & {
  from: string;
  to: string;
  elapsedMs: number;
  candidates: number;
};
export type LaneStatus =
  | "ready"
  | "loading"
  | "thinking"
  | "finished"
  | "exhausted"
  | "error"
  | "cancelled"
  | "unavailable";
export type LaneState = LaneDefinition & {
  status: LaneStatus;
  current: Article | null;
  path: string[];
  hops: Hop[];
  elapsedMs: number;
  modelMs: number;
  fetchMs: number;
  startedAt: number | null;
  error: string | null;
};
export type RaceState = {
  config: RaceConfig;
  status: "idle" | "running" | "complete" | "cancelled";
  lanes: LaneState[];
  setupMs: number;
  targetTitle: string;
  runId: string;
};
export type DecisionContext = {
  page: Article;
  target: Article;
  visited: string[];
  candidates: string[];
};
export type DecisionProvider = (
  context: DecisionContext,
  signal: AbortSignal,
) => Promise<Decision>;
export type RaceDependencies = {
  loadPage: (title: string, signal: AbortSignal) => Promise<Article>;
  providers: Record<string, DecisionProvider>;
  durationMs?: number;
};

// English Wikipedia normalizes the first letter, but the rest is case-sensitive:
// "US" and "Us" are different articles.
export const normalizeTitle = (value: string) => {
  const title = value.replaceAll("_", " ").trim().normalize("NFC");
  return title.charAt(0).toLocaleUpperCase("en") + title.slice(1);
};
export const articleUrl = (value: string) =>
  `https://en.wikipedia.org/wiki/${encodeURIComponent(value.replaceAll(" ", "_"))}`;
export const DEFAULT_CONFIG: RaceConfig = {
  start: "Baseball",
  target: "Sun",
  mode: "live",
  maxHops: 12,
};
export const DEFAULT_LANES: LaneDefinition[] = [
  {
    id: "jev",
    name: "Jev",
    model: "jev-latest",
    provider: "jev",
    available: false,
    color: "mint",
  },
  {
    id: "gpt",
    name: "GPT-5.6 Luna",
    model: "gpt-5.6-luna",
    provider: "openai",
    available: false,
    color: "blue",
  },
  {
    id: "sonnet",
    name: "Claude Sonnet 5",
    model: "claude-sonnet-5",
    provider: "anthropic",
    available: false,
    color: "orange",
  },
  {
    id: "gemini",
    name: "Gemini 3.8 Flash",
    model: "gemini-3.8-flash",
    provider: "google",
    available: false,
    color: "purple",
  },
];
export function initialRace(
  config = DEFAULT_CONFIG,
  definitions = DEFAULT_LANES,
): RaceState {
  return {
    config,
    status: "idle",
    setupMs: 0,
    targetTitle: config.target,
    runId: "",
    lanes: definitions.map((lane) => ({
      ...lane,
      status: "ready",
      current: null,
      path: [],
      hops: [],
      elapsedMs: 0,
      modelMs: 0,
      fetchMs: 0,
      startedAt: null,
      error: null,
    })),
  };
}
