import { z } from "zod";
import { loadWikipediaPage } from "../race/wikipedia";
import { getToolDefinition } from "./tools";
import type { ToolCall, ToolExecution } from "./types";

export type ToolResult =
  | {
      kind: "article";
      title: string;
      extract: string;
      linkCount: number;
      url: string;
    }
  | {
      kind: "repository";
      name: string;
      description: string;
      stars: number;
      language: string;
      url: string;
    }
  | {
      kind: "release";
      repository: string;
      tag: string;
      name: string;
      publishedAt: string;
      url: string;
    };

const repositorySchema = z.object({
  full_name: z.string(),
  description: z.string().nullable(),
  stargazers_count: z.number(),
  language: z.string().nullable(),
  html_url: z.url(),
});
const releaseSchema = z.object({
  tag_name: z.string(),
  name: z.string().nullable(),
  published_at: z.string().nullable(),
  html_url: z.url(),
});

async function github(
  path: string,
  signal: AbortSignal,
  fetcher: typeof fetch,
) {
  const response = await fetcher(`https://api.github.com/repos/${path}`, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "JevCopilotKitToolArena/1.0",
    },
  });
  if (!response.ok)
    throw new Error(`GitHub returned HTTP ${response.status} for ${path}.`);
  return response.json();
}

/** Execute the model's validated call against public, read-only APIs. */
export async function executeToolCall(
  call: ToolCall,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<ToolExecution> {
  const definition = getToolDefinition(call.tool);
  if (!definition) throw new Error(`Unknown tool: ${call.tool}`);
  const parsed = definition.safeParse(call.arguments);
  if (!parsed.success) throw new Error(`Invalid arguments for ${call.tool}.`);
  signal.throwIfAborted();
  let result: ToolResult;
  switch (call.tool) {
    case "get_wikipedia_article": {
      const { title } = parsed.data as { title: string };
      const article = await loadWikipediaPage(title, signal, fetcher);
      result = {
        kind: "article",
        title: article.title,
        extract: article.extract,
        linkCount: article.links.length,
        url: article.url,
      };
      break;
    }
    case "get_github_repository": {
      const { repository } = parsed.data as { repository: string };
      const data = repositorySchema.parse(
        await github(repository, signal, fetcher),
      );
      result = {
        kind: "repository",
        name: data.full_name,
        description: data.description ?? "No description",
        stars: data.stargazers_count,
        language: data.language ?? "Unknown",
        url: data.html_url,
      };
      break;
    }
    case "get_github_latest_release": {
      const { repository } = parsed.data as { repository: string };
      const data = releaseSchema.parse(
        await github(`${repository}/releases/latest`, signal, fetcher),
      );
      result = {
        kind: "release",
        repository,
        tag: data.tag_name,
        name: data.name ?? data.tag_name,
        publishedAt: data.published_at ?? "Unknown",
        url: data.html_url,
      };
      break;
    }
    default:
      throw new Error(`Unknown tool: ${call.tool}`);
  }
  return { tool: call.tool, arguments: structuredClone(parsed.data), result };
}
