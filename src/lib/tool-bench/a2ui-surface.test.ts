import { describe, expect, it } from "vitest";
import { buildA2UIMessages, validateA2UILayout } from "./a2ui-surface";

const layout = {
  components: [
    { id: "root", component: "Card", child: "body" },
    {
      id: "body",
      component: "Column",
      children: ["title", "metric", "detail"],
    },
    { id: "title", component: "Text", text: { path: "/title" }, variant: "h2" },
    { id: "metric", component: "Text", text: { path: "/metric" } },
    { id: "detail", component: "Text", text: { path: "/detail" } },
  ],
};

describe("shared A2UI surface", () => {
  it("accepts a component tree and binds facts to the live result", () => {
    const valid = validateA2UILayout(layout);
    expect(valid.components).toHaveLength(5);
    const messages = buildA2UIMessages("run-1", "jev", {
      tool: "get_github_repository",
      arguments: { repository: "vercel/next.js" },
      result: {
        kind: "repository",
        name: "vercel/next.js",
        description: "Framework",
        stars: 42,
        language: "TypeScript",
        url: "https://github.com/vercel/next.js",
      },
    });
    expect(messages).toHaveLength(3);
    expect(messages[1].updateComponents?.components?.[0]).toMatchObject({
      id: "root",
      component: "Column",
    });
    expect(messages[2].updateDataModel?.value).toMatchObject({
      title: "vercel/next.js",
      metric: "42",
      detail: "TypeScript",
    });
  });

  it("rejects cycles, missing facts, and invented literals", () => {
    expect(() =>
      validateA2UILayout({
        components: [
          ...layout.components.slice(0, 2),
          { id: "title", component: "Text", text: "Made up" },
          ...layout.components.slice(3),
        ],
      }),
    ).toThrow();
    expect(() =>
      validateA2UILayout({
        components: layout.components.map((node) =>
          node.id === "body"
            ? { ...node, children: ["root", "title", "metric", "detail"] }
            : node,
        ),
      }),
    ).toThrow(/cycle/);
    expect(() =>
      validateA2UILayout({
        components: layout.components.filter((node) => node.id !== "metric"),
      }),
    ).toThrow();
  });

  it("uses the same schema for every lane with separate surface IDs", () => {
    const execution = {
      tool: "get_github_repository",
      arguments: { repository: "vercel/next.js" },
      result: {
        kind: "repository",
        name: "vercel/next.js",
        description: "Framework",
        stars: 42,
        language: "TypeScript",
        url: "https://github.com/vercel/next.js",
      },
    };
    const jev = buildA2UIMessages("run-1", "jev", execution);
    const luna = buildA2UIMessages("run-1", "gpt", execution);
    expect(jev[1].updateComponents?.components).toEqual(
      luna[1].updateComponents?.components,
    );
    expect(jev[0].createSurface?.surfaceId).not.toBe(
      luna[0].createSurface?.surfaceId,
    );
    expect(jev[2].updateDataModel?.value).toEqual(
      luna[2].updateDataModel?.value,
    );
  });
});
