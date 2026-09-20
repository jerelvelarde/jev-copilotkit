import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { BENCH_CASES } from "./cases";
import {
  BenchOutputError,
  createJevProvider,
  createOpenRouterProvider,
} from "./providers";
import { createToolSchemas } from "./tools";

const signal = new AbortController().signal;
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const choice = (selected: string) => ({
  type: "choice",
  choice: selected,
  confidence: 0.9,
  probabilities: { [selected]: 1 },
});
const jevRequestSchema = z.object({
  model: z.string(),
  state: z
    .object({
      prompt: z.string(),
      entities: z.record(z.string(), z.array(z.string())),
    })
    .strict(),
  questions: z.record(
    z.string(),
    z.object({
      type: z.literal("choice"),
      instructions: z.string(),
      criteria: z.record(z.string(), z.string()),
    }),
  ),
});
function jevFetcher(tool = "lookup_order") {
  return vi.fn<typeof fetch>(async (_url, init) => {
    const request = jevRequestSchema.parse(JSON.parse(String(init?.body)));
    return Response.json({
      answers: Object.fromEntries(
        Object.entries(request.questions).map(([id, q]) => [
          id,
          choice(
            Object.keys(q.criteria).find(
              (key) =>
                q.criteria[key] ===
                (id === "tool" ? tool : BENCH_CASES[0].entities[id]?.[0]),
            ) ?? Object.keys(q.criteria)[0],
          ),
        ]),
      ),
      usage: { input_tokens: 42 },
    });
  });
}
function routerResponse(name: string, args: string) {
  return Response.json({
    choices: [
      {
        message: {
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: { name, arguments: args },
            },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 37, completion_tokens: 8 },
  });
}
describe("benchmark provider contracts", () => {
  it("sends all typed choices once without labels and maps only required fields", async () => {
    const fetcher = jevFetcher();
    const decision = await createJevProvider(
      "test-key",
      "configured-jev",
      fetcher,
    )(BENCH_CASES[0], signal);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe(
      "https://api.typesafe.ai/v1/systemone",
    );
    const body = jevRequestSchema.parse(
      JSON.parse(String(fetcher.mock.calls[0][1]?.body)),
    );
    expect(body.model).toBe("configured-jev");
    expect(Object.keys(body.questions).sort()).toEqual(
      [
        "tool",
        "order_id",
        "payment_id",
        "reason",
        "subscription_id",
        "timing",
        "customer_id",
        "category",
        "priority",
      ].sort(),
    );
    expect(decision.tool).toBe("lookup_order");
    expect(decision.arguments).toEqual({
      order_id: BENCH_CASES[0].entities.order_id[0],
    });
    expect(decision.inputTokens).toBe(42);
    expect(decision.outputTokens).toBeNull();
    for (const tool of createToolSchemas(BENCH_CASES[0])) {
      for (const [field, schema] of Object.entries(
        tool.function.parameters.properties,
      )) {
        expect(Object.values(body.questions[field].criteria)).toEqual(
          schema.enum,
        );
      }
    }
  });
  it("uses the same candidate enums in native required function calling without labels", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        routerResponse("lookup_order", '{"order_id":"ORD-1042"}'),
      );
    const decision = await createOpenRouterProvider(
      "test-key",
      "configured-model",
      fetcher,
    )(BENCH_CASES[0], signal);
    const body = z
      .object({
        model: z.string(),
        tool_choice: z.literal("required"),
        parallel_tool_calls: z.literal(false),
        tools: z.array(z.unknown()),
        messages: z.array(z.object({ role: z.string(), content: z.string() })),
      })
      .parse(JSON.parse(String(fetcher.mock.calls[0][1]?.body)));
    expect(body.tools).toEqual(createToolSchemas(BENCH_CASES[0]));
    expect(JSON.parse(body.messages[1].content)).not.toHaveProperty("expected");
    expect(JSON.parse(body.messages[1].content)).not.toHaveProperty("id");
    expect(decision).toMatchObject({
      tool: "lookup_order",
      arguments: { order_id: "ORD-1042" },
      confidence: null,
      inputTokens: 37,
      outputTokens: 8,
    });
  });
  it("preserves unknown tools and wrong or extra arguments for scoring", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        routerResponse("invented", '{"order_id":42,"extra":true}'),
      );
    expect(
      await createOpenRouterProvider(
        "test-key",
        "model",
        fetcher,
      )(BENCH_CASES[0], signal),
    ).toMatchObject({
      tool: "invented",
      arguments: { order_id: 42, extra: true },
    });
  });
  it("distinguishes malformed model output from fatal HTTP errors", async () => {
    const badOutput = vi
      .fn<typeof fetch>()
      .mockResolvedValue(routerResponse("lookup_order", "invalid json"));
    await expect(
      createOpenRouterProvider(
        "test-key",
        "model",
        badOutput,
      )(BENCH_CASES[0], signal),
    ).rejects.toMatchObject({
      name: "BenchOutputError",
      selectedTool: "lookup_order",
    });
    const offline = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response("private upstream details", { status: 401 }),
      );
    await expect(
      createJevProvider("test-key", "model", offline)(BENCH_CASES[0], signal),
    ).rejects.toThrow("HTTP 401");
  });
  it("rejects unknown Jev criterion IDs as invalid output", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        Response.json({ answers: { tool: choice("unknown") } }),
      );
    await expect(
      createJevProvider("test-key", "model", fetcher)(BENCH_CASES[0], signal),
    ).rejects.toBeInstanceOf(BenchOutputError);
  });
  it.each([0, 2])(
    "rejects %i native calls instead of silently choosing one",
    async (count) => {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          choices: [
            {
              message: {
                tool_calls: Array.from({ length: count }, () => ({
                  type: "function",
                  function: {
                    name: "lookup_order",
                    arguments: '{"order_id":"ORD-1042"}',
                  },
                })),
              },
            },
          ],
        }),
      );
      await expect(
        createOpenRouterProvider(
          "test-key",
          "model",
          fetcher,
        )(BENCH_CASES[0], signal),
      ).rejects.toBeInstanceOf(BenchOutputError);
    },
  );
  it.each([
    ["Jev", 15_000, createJevProvider],
    ["OpenRouter", 20_000, createOpenRouterProvider],
  ])(
    "bounds a noncooperative %s request at %i ms",
    async (_name, limit, createProvider) => {
      vi.useFakeTimers();
      const timeout = vi
        .spyOn(AbortSignal, "timeout")
        .mockImplementation((ms) => {
          const controller = new AbortController();
          setTimeout(
            () =>
              controller.abort(
                new DOMException("Model request timed out", "TimeoutError"),
              ),
            ms,
          );
          return controller.signal;
        });
      const fetcher = vi.fn<typeof fetch>(() => new Promise(() => {}));
      const outcome = expect(
        createProvider("test-key", "model", fetcher)(BENCH_CASES[0], signal),
      ).rejects.toThrow("timed out");
      expect(timeout).toHaveBeenCalledWith(limit);
      await vi.advanceTimersByTimeAsync(limit);
      await outcome;
      expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
    },
  );
  it("bounds noncooperative fetches and propagates abort", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<typeof fetch>(() => new Promise(() => {}));
    const pending = createJevProvider(
      "test-key",
      "model",
      fetcher,
    )(BENCH_CASES[0], controller.signal);
    controller.abort(new Error("cancelled test"));
    await expect(pending).rejects.toThrow("cancelled test");
    expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });
  it("rejects missing credentials before making requests", async () => {
    const fetcher = jevFetcher();
    await expect(
      createJevProvider("", "model", fetcher)(BENCH_CASES[0], signal),
    ).rejects.toThrow("TYPESAFE_API_KEY");
    await expect(
      createOpenRouterProvider("", "model", fetcher)(BENCH_CASES[0], signal),
    ).rejects.toThrow("OPENROUTER_API_KEY");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
