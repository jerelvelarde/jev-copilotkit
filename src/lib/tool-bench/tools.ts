import { z } from "zod";
import type { BenchCaseInput } from "./types";

export const ARGUMENT_FIELDS = {
  title: {
    description: "The Wikipedia article title to retrieve.",
    values: null,
  },
  repository: {
    description: "The GitHub owner/repository to inspect.",
    values: null,
  },
} satisfies Record<string, { description: string; values: string[] | null }>;
export type ArgumentField = keyof typeof ARGUMENT_FIELDS;

export const TOOL_REGISTRY = [
  {
    name: "get_wikipedia_article",
    description:
      "Retrieve the current introduction and link count of a Wikipedia article.",
    fields: ["title"],
  },
  {
    name: "get_github_repository",
    description:
      "Retrieve current metadata, description, and stars for a public GitHub repository.",
    fields: ["repository"],
  },
  {
    name: "get_github_latest_release",
    description:
      "Retrieve the latest published release and tag of a public GitHub repository.",
    fields: ["repository"],
  },
] as const;

const repository = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/);
const toolDefinitions = {
  get_wikipedia_article: z
    .object({ title: z.string().min(1).max(200) })
    .strict(),
  get_github_repository: z.object({ repository }).strict(),
  get_github_latest_release: z.object({ repository }).strict(),
} as const;
export type ToolName = keyof typeof toolDefinitions;
export type ToolArguments = {
  [Name in ToolName]: z.infer<(typeof toolDefinitions)[Name]>;
};
export function getToolDefinition(
  name: string,
): (typeof toolDefinitions)[ToolName] | null {
  return Object.hasOwn(toolDefinitions, name)
    ? toolDefinitions[name as ToolName]
    : null;
}
export function argumentCandidates(
  input: BenchCaseInput,
  field: ArgumentField,
): string[] {
  const candidates = ARGUMENT_FIELDS[field].values ?? input.entities[field];
  if (!candidates?.length)
    throw new Error(`No candidates supplied for ${field}.`);
  return [...candidates];
}
export function createToolSchemas(input: BenchCaseInput) {
  return TOOL_REGISTRY.map((tool) => ({
    type: "function" as const,
    function: {
      name: tool.name,
      description: tool.description,
      strict: true,
      parameters: {
        type: "object" as const,
        properties: Object.fromEntries(
          tool.fields.map((field) => [
            field,
            {
              type: "string" as const,
              enum: argumentCandidates(input, field),
              description: ARGUMENT_FIELDS[field].description,
            },
          ]),
        ),
        required: [...tool.fields],
        additionalProperties: false,
      },
    },
  }));
}
