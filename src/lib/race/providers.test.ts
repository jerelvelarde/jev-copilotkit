import { describe, expect, it, vi } from "vitest";
import {
  createAnthropicWikiProvider,
  createGoogleWikiProvider,
  createJevProvider,
  createOpenAIWikiProvider,
  createOpenRouterProvider,
} from "./providers";
import { type DecisionContext } from "./types";
const context: DecisionContext = {
  page: { id: 1, title: "Start", extract: "Start", url: "", links: ["Bridge"] },
  target: { id: 2, title: "Goal", extract: "Goal", url: "", links: [] },
  visited: ["Start"],
  candidates: ["Bridge"],
};
const signal = new AbortController().signal;
describe("Jev integration contract", () => {
  it("sends typed questions and maps the returned option to a known title", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        answers: {
          next: {
            type: "choice",
            choice: "link_0",
            confidence: 0.9,
            probabilities: { link_0: 1 },
          },
        },
        usage: { input_tokens: 42 },
      }),
    );
    const result = await createJevProvider(
      "test-key",
      "jev-latest",
      fetcher,
    )(context, signal);
    expect(result.title).toBe("Bridge");
    expect(result.inputTokens).toBe(42);
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body.questions.next.criteria).toEqual({ link_0: "Bridge" });
    expect(body.model).toBe("jev-latest");
  });
  it("fails closed on an unknown option or missing credential", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        answers: {
          next: {
            type: "choice",
            choice: "invented",
            confidence: 0.9,
            probabilities: {},
          },
        },
      }),
    );
    await expect(
      createJevProvider("test-key", undefined, fetcher)(context, signal),
    ).rejects.toThrow("valid offered link");
    await expect(createJevProvider("")(context, signal)).rejects.toThrow(
      "TYPESAFE_API_KEY",
    );
  });
  it("shortlists every candidate with bounded Choice calls", async () => {
    const groupSizes: number[] = [];
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      expect(Object.keys(body.questions)).toEqual(["next"]);
      const criteria = body.questions.next.criteria as Record<string, string>;
      const keys = Object.keys(criteria);
      groupSizes.push(keys.length);
      return Response.json({
        answers: {
          next: {
            type: "choice",
            choice: keys.find((id) => criteria[id] === "Page 299") ?? keys[0],
            confidence: 0.9,
            probabilities: Object.fromEntries(
              keys.map((id, index) => [
                id,
                criteria[id] === "Page 299"
                  ? 0.9
                  : (keys.length - index) / 1000,
              ]),
            ),
          },
        },
      });
    });
    const result = await createJevProvider(
      "test-key",
      undefined,
      fetcher,
    )(
      {
        ...context,
        candidates: Array.from({ length: 300 }, (_, i) => `Page ${i}`),
      },
      signal,
    );
    expect(groupSizes).toEqual([255, 45, 64]);
    expect(groupSizes.every((size) => size <= 255)).toBe(true);
    expect(result.title).toBe("Page 299");
    expect(result.method).toBe("rank+choice");
    expect(result.modelCalls).toBe(3);
    expect(result.inputTokens).toBeNull();
  });
  it("keeps a late candidate eligible across multiple shortlist rounds", async () => {
    const groups: string[][] = [];
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const criteria = body.questions.next.criteria as Record<string, string>;
      const entries = Object.entries(criteria);
      groups.push(entries.map(([, title]) => title));
      const selected = entries.find(([, title]) => title === "Page 4999")?.[0];
      return Response.json({
        answers: {
          next: {
            type: "choice",
            choice: selected ?? entries[0][0],
            confidence: 0.9,
            probabilities: Object.fromEntries(
              entries.map(([id, title], index) => [
                id,
                title === "Page 4999" ? 0.9 : (entries.length - index) / 1000,
              ]),
            ),
          },
        },
      });
    });
    const result = await createJevProvider(
      "test-key",
      undefined,
      fetcher,
    )(
      {
        ...context,
        candidates: Array.from({ length: 5000 }, (_, i) => `Page ${i}`),
      },
      signal,
    );
    expect(groups.slice(0, 20).flat()).toEqual(
      Array.from({ length: 5000 }, (_, i) => `Page ${i}`),
    );
    expect(groups.every((group) => group.length <= 255)).toBe(true);
    expect(result.title).toBe("Page 4999");
    expect(result.modelCalls).toBe(24);
  });
});
describe("comparison provider", () => {
  it("rejects invented indexes and does not invent confidence", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ choices: [{ message: { content: '{"index":0}' } }] }),
      )
      .mockResolvedValueOnce(
        Response.json({ choices: [{ message: { content: '{"index":7}' } }] }),
      );
    const provider = createOpenRouterProvider("test-key", "model", fetcher);
    expect((await provider(context, signal)).confidence).toBeNull();
    await expect(provider(context, signal)).rejects.toThrow();
  });
});

describe("native wiki comparison providers", () => {
  it("accepts one indexed OpenAI tool call", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        output: [
          {
            type: "function_call",
            name: "choose_link",
            arguments: '{"index":0}',
          },
        ],
        usage: { input_tokens: 21 },
      }),
    );
    const result = await createOpenAIWikiProvider(
      "key",
      "model",
      fetcher,
    )(context, signal);
    expect(result).toMatchObject({
      title: "Bridge",
      inputTokens: 21,
      modelCalls: 1,
    });
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body.tools[0].parameters.properties.index.maximum).toBe(0);
    expect(body.input).toContain("Bridge");
  });

  it("accepts Anthropic's native tool use and rejects an invented index", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          content: [
            { type: "tool_use", name: "choose_link", input: { index: 0 } },
          ],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          content: [
            { type: "tool_use", name: "choose_link", input: { index: 2 } },
          ],
        }),
      );
    const provider = createAnthropicWikiProvider("key", "model", fetcher);
    expect((await provider(context, signal)).title).toBe("Bridge");
    await expect(provider(context, signal)).rejects.toThrow(
      "outside the offered list",
    );
  });

  it("accepts Gemini's native function call", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        candidates: [
          {
            content: {
              parts: [
                { functionCall: { name: "choose_link", args: { index: 0 } } },
              ],
            },
          },
        ],
      }),
    );
    const result = await createGoogleWikiProvider(
      "key",
      "model",
      fetcher,
    )(context, signal);
    expect(result.title).toBe("Bridge");
    const body = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(body.tools[0].functionDeclarations[0].parameters).not.toHaveProperty(
      "additionalProperties",
    );
  });
});
