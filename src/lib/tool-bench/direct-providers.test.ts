import { describe, expect, it, vi } from "vitest";
import { BENCH_CASES } from "./cases";
import {
  createAnthropicProvider,
  createGoogleProvider,
  createOpenAIProvider,
} from "./direct-providers";
import { createToolSchemas } from "./tools";
import { BenchOutputError } from "./providers";

const input = BENCH_CASES[0];
const signal = new AbortController().signal;
const call = { name: "get_wikipedia_article", args: { title: "Earth" } };

describe("direct provider tool calls", () => {
  it("uses the Responses API and preserves OpenAI's native call", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        output: [
          {
            type: "function_call",
            name: call.name,
            arguments: JSON.stringify(call.args),
          },
        ],
        usage: { input_tokens: 44, output_tokens: 9 },
      }),
    );
    const result = await createOpenAIProvider(
      "key",
      "gpt-5.6-luna",
      fetcher,
    )(input, signal);
    const [url, init] = fetcher.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(body).toMatchObject({
      model: "gpt-5.6-luna",
      tool_choice: "required",
      parallel_tool_calls: false,
    });
    expect(body.tools[0].parameters).toEqual(
      createToolSchemas(input)[0].function.parameters,
    );
    expect(result).toMatchObject({
      tool: call.name,
      arguments: call.args,
      inputTokens: 44,
      outputTokens: 9,
    });
  });

  it("forces one Sonnet 5 tool call with thinking disabled", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        content: [{ type: "tool_use", name: call.name, input: call.args }],
        usage: { input_tokens: 55, output_tokens: 11 },
      }),
    );
    const result = await createAnthropicProvider(
      "key",
      "claude-sonnet-5",
      fetcher,
    )(input, signal);
    const [url, init] = fetcher.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(body).toMatchObject({
      model: "claude-sonnet-5",
      thinking: { type: "disabled" },
      tool_choice: { type: "any", disable_parallel_tool_use: true },
    });
    expect(body.tools[0].input_schema).toEqual(
      createToolSchemas(input)[0].function.parameters,
    );
    expect(result).toMatchObject({
      tool: call.name,
      arguments: call.args,
      inputTokens: 55,
      outputTokens: 11,
    });
  });

  it("uses Gemini function declarations and parses the returned function call", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        candidates: [{ content: { parts: [{ functionCall: call }] } }],
        usageMetadata: { promptTokenCount: 66, candidatesTokenCount: 12 },
      }),
    );
    const result = await createGoogleProvider(
      "key",
      "gemini-3.8-flash",
      fetcher,
    )(input, signal);
    const [url, init] = fetcher.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(url).toContain("gemini-3.8-flash:generateContent");
    expect(body.toolConfig.functionCallingConfig.mode).toBe("ANY");
    const geminiParameters: Record<string, unknown> = {
      ...createToolSchemas(input)[0].function.parameters,
    };
    delete geminiParameters.additionalProperties;
    expect(body.tools[0].functionDeclarations[0].parameters).toEqual(
      geminiParameters,
    );
    expect(result).toMatchObject({
      tool: call.name,
      arguments: call.args,
      inputTokens: 66,
      outputTokens: 12,
    });
  });

  it("scores missing or multiple native calls as invalid output", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        content: [{ type: "text", text: "I can help" }],
      }),
    );
    await expect(
      createAnthropicProvider("key", "claude-sonnet-5", fetcher)(input, signal),
    ).rejects.toBeInstanceOf(BenchOutputError);
    fetcher.mockResolvedValue(
      Response.json({
        candidates: [
          {
            content: {
              parts: [{ functionCall: call }, { functionCall: call }],
            },
          },
        ],
      }),
    );
    await expect(
      createGoogleProvider("key", "gemini-3.8-flash", fetcher)(input, signal),
    ).rejects.toBeInstanceOf(BenchOutputError);
  });

  it("requires the corresponding key before a request", async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      createOpenAIProvider("", "gpt-5.6-luna", fetcher)(input, signal),
    ).rejects.toThrow("OPENAI_API_KEY");
    await expect(
      createAnthropicProvider("", "claude-sonnet-5", fetcher)(input, signal),
    ).rejects.toThrow("ANTHROPIC_API_KEY");
    await expect(
      createGoogleProvider("", "gemini-3.8-flash", fetcher)(input, signal),
    ).rejects.toThrow("GOOGLE_API_KEY");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
