import type { LaneDefinition } from "../race/types";

export const ARENA_LANES: LaneDefinition[] = [
  {
    id: "jev",
    name: "Jev",
    model: "jev-latest",
    provider: "jev",
    color: "mint",
    available: false,
  },
  {
    id: "gpt",
    name: "GPT-5.6 Luna",
    model: "gpt-5.6-luna",
    provider: "openai",
    color: "blue",
    available: false,
  },
  {
    id: "sonnet",
    name: "Claude Sonnet 5",
    model: "claude-sonnet-5",
    provider: "anthropic",
    color: "orange",
    available: false,
  },
  {
    id: "gemini",
    name: "Gemini 3.8 Flash",
    model: "gemini-3.8-flash",
    provider: "google",
    color: "purple",
    available: false,
  },
];

const settings = {
  jev: ["TYPESAFE_API_KEY", "JEV_MODEL"],
  openai: ["OPENAI_API_KEY", "OPENAI_MODEL"],
  anthropic: ["ANTHROPIC_API_KEY", "ANTHROPIC_MODEL"],
  google: ["GOOGLE_API_KEY", "GOOGLE_MODEL"],
  openrouter: ["OPENROUTER_API_KEY", ""],
} as const;

export function arenaKeyName(lane: LaneDefinition) {
  return settings[lane.provider][0];
}

export function getArenaLanes(): LaneDefinition[] {
  return ARENA_LANES.map((lane) => {
    const [keyName, modelName] = settings[lane.provider];
    const model = (modelName && process.env[modelName]) || lane.model;
    return {
      ...lane,
      model,
      name: model === lane.model ? lane.name : model,
      available: Boolean(process.env[keyName]?.trim()),
    };
  });
}
