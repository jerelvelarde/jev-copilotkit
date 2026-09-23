import type { ToolCall } from "./types";

/** A model answered, but did not produce one usable call. Score it and continue. */
export class BenchOutputError extends Error {
  constructor(
    message: string,
    readonly modelMs: number,
    readonly inputTokens: number | null = null,
    readonly outputTokens: number | null = null,
    readonly actual: ToolCall | null = null,
    readonly selectedTool: string | null = actual?.tool ?? null,
  ) {
    super(message);
    this.name = "BenchOutputError";
  }
}
