import { z } from "zod";
import type { ToolExecution } from "./types";

const fieldNames = [
  "eyebrow",
  "title",
  "subtitle",
  "metricLabel",
  "metric",
  "detailLabel",
  "detail",
  "sourceLabel",
] as const;
const textValue = z
  .object({
    path: z.enum(fieldNames.map((name) => `/${name}`) as [string, ...string[]]),
  })
  .strict();
const id = z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,63}$/);
const card = z.object({ id, component: z.literal("Card"), child: id }).strict();
const group = z
  .object({
    id,
    component: z.enum(["Column", "Row"]),
    children: z.array(id).min(1).max(16),
  })
  .strict();
const text = z
  .object({
    id,
    component: z.literal("Text"),
    text: textValue,
    variant: z.enum(["h1", "h2", "h3", "body", "caption"]).optional(),
  })
  .strict();
const divider = z
  .object({
    id,
    component: z.literal("Divider"),
    axis: z.literal("horizontal"),
  })
  .strict();
export const a2uiLayoutSchema = z
  .object({
    components: z
      .array(z.discriminatedUnion("component", [card, group, text, divider]))
      .min(5)
      .max(24),
  })
  .strict();
export type A2UILayout = z.infer<typeof a2uiLayoutSchema>;

const resultSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("article"),
    title: z.string(),
    extract: z.string(),
    linkCount: z.number(),
    url: z.url(),
  }),
  z.object({
    kind: z.literal("repository"),
    name: z.string(),
    description: z.string(),
    stars: z.number(),
    language: z.string(),
    url: z.url(),
  }),
  z.object({
    kind: z.literal("release"),
    repository: z.string(),
    tag: z.string(),
    name: z.string(),
    publishedAt: z.string(),
    url: z.url(),
  }),
]);
export function previewData(execution: ToolExecution) {
  const result = resultSchema.parse(execution.result);
  switch (result.kind) {
    case "article":
      return {
        eyebrow: "LIVE WIKIPEDIA ARTICLE",
        title: result.title,
        subtitle: "Current encyclopedia introduction",
        metricLabel: "ARTICLE LINKS",
        metric: result.linkCount.toLocaleString(),
        detailLabel: "INTRODUCTION",
        detail: result.extract,
        sourceLabel: "Source: Wikipedia",
      };
    case "repository":
      return {
        eyebrow: "LIVE GITHUB REPOSITORY",
        title: result.name,
        subtitle: result.description,
        metricLabel: "STARS",
        metric: result.stars.toLocaleString(),
        detailLabel: "LANGUAGE",
        detail: result.language,
        sourceLabel: "Source: GitHub",
      };
    case "release":
      return {
        eyebrow: "LIVE GITHUB RELEASE",
        title: result.tag,
        subtitle: result.name,
        metricLabel: "PUBLISHED",
        metric: result.publishedAt,
        detailLabel: "REPOSITORY",
        detail: result.repository,
        sourceLabel: "Source: GitHub",
      };
  }
}

export function validateA2UILayout(input: unknown): A2UILayout {
  const layout = a2uiLayoutSchema.parse(input);
  const nodes = new Map(layout.components.map((node) => [node.id, node]));
  if (nodes.size !== layout.components.length)
    throw new Error("A2UI component IDs must be unique.");
  if (
    layout.components[0].id !== "root" ||
    !["Card", "Column"].includes(layout.components[0].component)
  )
    throw new Error("A2UI root must be a Card or Column.");
  const seen = new Set<string>();
  const visit = (nodeId: string, stack: Set<string>, depth: number) => {
    if (depth > 8) throw new Error("A2UI layout is too deep.");
    if (stack.has(nodeId)) throw new Error("A2UI layout contains a cycle.");
    const node = nodes.get(nodeId);
    if (!node) throw new Error(`A2UI references unknown component ${nodeId}.`);
    seen.add(nodeId);
    const next = new Set(stack).add(nodeId);
    if (node.component === "Card") visit(node.child, next, depth + 1);
    if (node.component === "Column" || node.component === "Row")
      for (const child of node.children) visit(child, next, depth + 1);
  };
  visit("root", new Set(), 0);
  if (seen.size !== nodes.size)
    throw new Error("A2UI layout contains unreachable components.");
  const paths = new Set(
    layout.components
      .filter((node) => node.component === "Text")
      .map((node) => node.text.path),
  );
  if (!["/title", "/metric", "/detail"].every((path) => paths.has(path)))
    throw new Error("A2UI layout must show the title, metric, and detail.");
  return layout;
}

const sharedLayout = validateA2UILayout({
  components: [
    {
      id: "root",
      component: "Column",
      children: [
        "eyebrow",
        "title",
        "subtitle",
        "divider",
        "metrics",
        "detailLabel",
        "detail",
        "source",
      ],
    },
    {
      id: "eyebrow",
      component: "Text",
      text: { path: "/eyebrow" },
      variant: "caption",
    },
    { id: "title", component: "Text", text: { path: "/title" }, variant: "h2" },
    {
      id: "subtitle",
      component: "Text",
      text: { path: "/subtitle" },
      variant: "body",
    },
    { id: "divider", component: "Divider", axis: "horizontal" },
    { id: "metrics", component: "Row", children: ["metricLabel", "metric"] },
    {
      id: "metricLabel",
      component: "Text",
      text: { path: "/metricLabel" },
      variant: "caption",
    },
    {
      id: "metric",
      component: "Text",
      text: { path: "/metric" },
      variant: "h3",
    },
    {
      id: "detailLabel",
      component: "Text",
      text: { path: "/detailLabel" },
      variant: "caption",
    },
    {
      id: "detail",
      component: "Text",
      text: { path: "/detail" },
      variant: "body",
    },
    {
      id: "source",
      component: "Text",
      text: { path: "/sourceLabel" },
      variant: "caption",
    },
  ],
});

/** Every lane uses the same A2UI schema. Only validated live data changes. */
export function buildA2UIMessages(
  runId: string,
  laneId: string,
  execution: ToolExecution,
) {
  const surfaceId = `${laneId}-${runId}`;
  return [
    {
      version: "v0.9",
      createSurface: {
        surfaceId,
        catalogId: "https://a2ui.org/specification/v0_9/basic_catalog.json",
      },
    },
    {
      version: "v0.9",
      updateComponents: { surfaceId, components: sharedLayout.components },
    },
    {
      version: "v0.9",
      updateDataModel: { surfaceId, path: "/", value: previewData(execution) },
    },
  ];
}
