import { z } from "zod";
import { abortable } from "../cancellation";
import type { BenchDecision, BenchProvider } from "./types";
import { BenchOutputError } from "./errors";
import { createToolSchemas } from "./tools";

const systemPrompt =
  "CRITICAL: Select exactly one read-only tool that fulfills the user's explicit request and provide its required arguments. Use the offered entity candidates and enum values. The selected tool will fetch live public data. Do not explain your choice.";

const object = z.record(z.string(), z.unknown());
const openAIResponse = z.object({
  output: z.array(z.unknown()),
  usage: z
    .object({ input_tokens: z.number(), output_tokens: z.number() })
    .optional(),
});
const anthropicResponse = z.object({
  content: z.array(z.unknown()),
  usage: z
    .object({ input_tokens: z.number(), output_tokens: z.number() })
    .optional(),
});
const googleResponse = z.object({
  candidates: z
    .array(z.object({ content: z.object({ parts: z.array(z.unknown()) }) }))
    .min(1),
  usageMetadata: z
    .object({
      promptTokenCount: z.number().optional(),
      candidatesTokenCount: z.number().optional(),
    })
    .optional(),
});
const openAICall = z.object({
  type: z.literal("function_call"),
  name: z.string(),
  arguments: z.string(),
});
const anthropicCall = z.object({
  type: z.literal("tool_use"),
  name: z.string(),
  input: object,
});
const googleCall = z.object({
  functionCall: z.object({ name: z.string(), args: object.optional() }),
});

async function request(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal: AbortSignal,
  fetcher: typeof fetch,
) {
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
  requestSignal.throwIfAborted();
  const response = await abortable(
    fetcher(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: requestSignal,
    }),
    requestSignal,
  );
  if (!response.ok) {
    const detail =
      response.status === 401 || response.status === 403
        ? ": check provider key and model access"
        : response.status === 402
          ? ": check provider credits"
          : response.status === 429
            ? ": rate limited"
            : "";
    throw new Error(
      `Model provider returned HTTP ${response.status}${detail}.`,
    );
  }
  return abortable(response.json(), requestSignal);
}

function decision(
  name: string,
  args: unknown,
  began: number,
  inputTokens: number | null,
  outputTokens: number | null,
): BenchDecision {
  const parsed = object.safeParse(args);
  if (!parsed.success)
    throw new BenchOutputError(
      "The model returned malformed tool arguments.",
      performance.now() - began,
      inputTokens,
      outputTokens,
      null,
      name,
    );
  return {
    tool: name,
    arguments: parsed.data,
    modelMs: performance.now() - began,
    inputTokens,
    outputTokens,
    confidence: null,
    choices: [],
  };
}

function oneCall<T>(items: unknown[], schema: z.ZodType<T>, began: number): T {
  const matches = items
    .map((item) => schema.safeParse(item))
    .filter((item) => item.success);
  if (matches.length !== 1)
    throw new BenchOutputError(
      "The model did not return exactly one native tool call.",
      performance.now() - began,
    );
  return matches[0].data;
}

export function createOpenAIProvider(
  key: string,
  model: string,
  fetcher: typeof fetch = fetch,
): BenchProvider {
  return async (input, signal) => {
    if (!key.trim())
      throw new Error("OPENAI_API_KEY is required for live OpenAI.");
    const began = performance.now();
    const raw = await request(
      "https://api.openai.com/v1/responses",
      { Authorization: `Bearer ${key}` },
      {
        model,
        instructions: systemPrompt,
        input: JSON.stringify({
          prompt: input.prompt,
          entities: input.entities,
        }),
        tools: createToolSchemas(input).map(({ function: tool }) => ({
          type: "function",
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
          strict: true,
        })),
        tool_choice: "required",
        parallel_tool_calls: false,
        reasoning: { effort: "none" },
        max_output_tokens: 256,
      },
      signal,
      fetcher,
    );
    const parsed = openAIResponse.safeParse(raw);
    if (!parsed.success)
      throw new BenchOutputError(
        "OpenAI returned an invalid response.",
        performance.now() - began,
      );
    const call = oneCall(parsed.data.output, openAICall, began);
    let args: unknown;
    try {
      args = JSON.parse(call.arguments);
    } catch {
      throw new BenchOutputError(
        "The model returned malformed tool arguments.",
        performance.now() - began,
        parsed.data.usage?.input_tokens ?? null,
        parsed.data.usage?.output_tokens ?? null,
        null,
        call.name,
      );
    }
    return decision(
      call.name,
      args,
      began,
      parsed.data.usage?.input_tokens ?? null,
      parsed.data.usage?.output_tokens ?? null,
    );
  };
}

export function createAnthropicProvider(
  key: string,
  model: string,
  fetcher: typeof fetch = fetch,
): BenchProvider {
  return async (input, signal) => {
    if (!key.trim())
      throw new Error("ANTHROPIC_API_KEY is required for live Claude.");
    const began = performance.now();
    const raw = await request(
      "https://api.anthropic.com/v1/messages",
      { "x-api-key": key, "anthropic-version": "2023-06-01" },
      {
        model,
        max_tokens: 256,
        thinking: { type: "disabled" },
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content: JSON.stringify({
              prompt: input.prompt,
              entities: input.entities,
            }),
          },
        ],
        tools: createToolSchemas(input).map(({ function: tool }) => ({
          name: tool.name,
          description: tool.description,
          input_schema: tool.parameters,
        })),
        tool_choice: { type: "any", disable_parallel_tool_use: true },
      },
      signal,
      fetcher,
    );
    const parsed = anthropicResponse.safeParse(raw);
    if (!parsed.success)
      throw new BenchOutputError(
        "Anthropic returned an invalid response.",
        performance.now() - began,
      );
    const call = oneCall(parsed.data.content, anthropicCall, began);
    return decision(
      call.name,
      call.input,
      began,
      parsed.data.usage?.input_tokens ?? null,
      parsed.data.usage?.output_tokens ?? null,
    );
  };
}

export function createGoogleProvider(
  key: string,
  model: string,
  fetcher: typeof fetch = fetch,
): BenchProvider {
  return async (input, signal) => {
    if (!key.trim())
      throw new Error("GOOGLE_API_KEY is required for live Gemini.");
    const began = performance.now();
    const raw = await request(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      { "x-goog-api-key": key },
      {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [
          {
            role: "user",
            parts: [
              {
                text: JSON.stringify({
                  prompt: input.prompt,
                  entities: input.entities,
                }),
              },
            ],
          },
        ],
        tools: [
          {
            functionDeclarations: createToolSchemas(input).map(
              ({ function: tool }) => {
                // Gemini's FunctionDeclaration.parameters omits this OpenAI-only flag.
                // The same fields and enums still reach every model; scoring stays strict.
                const parameters: Record<string, unknown> = {
                  ...tool.parameters,
                };
                delete parameters.additionalProperties;
                return {
                  name: tool.name,
                  description: tool.description,
                  parameters,
                };
              },
            ),
          },
        ],
        toolConfig: { functionCallingConfig: { mode: "ANY" } },
        generationConfig: {
          maxOutputTokens: 256,
          thinkingConfig: { thinkingLevel: "low" },
        },
      },
      signal,
      fetcher,
    );
    const parsed = googleResponse.safeParse(raw);
    if (!parsed.success)
      throw new BenchOutputError(
        "Google returned an invalid response.",
        performance.now() - began,
      );
    const call = oneCall(
      parsed.data.candidates[0].content.parts,
      googleCall,
      began,
    ).functionCall;
    return decision(
      call.name,
      call.args ?? {},
      began,
      parsed.data.usageMetadata?.promptTokenCount ?? null,
      parsed.data.usageMetadata?.candidatesTokenCount ?? null,
    );
  };
}
