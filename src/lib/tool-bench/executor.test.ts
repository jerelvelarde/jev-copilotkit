import { describe, expect, it, vi } from "vitest";
import { executeToolCall } from "./executor";

const signal = new AbortController().signal;
describe("live read-only tool execution", () => {
  it("fetches and validates current GitHub repository data", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        full_name: "vercel/next.js",
        description: "The React Framework",
        stargazers_count: 123,
        language: "TypeScript",
        html_url: "https://github.com/vercel/next.js",
      }),
    );
    const call = {
      tool: "get_github_repository",
      arguments: { repository: "vercel/next.js" },
    };
    const execution = await executeToolCall(call, signal, fetcher);
    expect(fetcher.mock.calls[0][0]).toBe(
      "https://api.github.com/repos/vercel/next.js",
    );
    expect(execution.result).toMatchObject({ kind: "repository", stars: 123 });
    expect(execution.arguments).not.toBe(call.arguments);
  });
  it("fetches a real release endpoint", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        tag_name: "v1",
        name: "Release 1",
        published_at: "2026-01-01T00:00:00Z",
        html_url: "https://github.com/cli/cli/releases/tag/v1",
      }),
    );
    const execution = await executeToolCall(
      {
        tool: "get_github_latest_release",
        arguments: { repository: "cli/cli" },
      },
      signal,
      fetcher,
    );
    expect(fetcher.mock.calls[0][0]).toBe(
      "https://api.github.com/repos/cli/cli/releases/latest",
    );
    expect(execution.result).toMatchObject({ kind: "release", tag: "v1" });
  });
  it("rejects unsafe calls and upstream failures", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("", { status: 429 }));
    await expect(
      executeToolCall(
        { tool: "get_github_repository", arguments: { repository: "../bad" } },
        signal,
        fetcher,
      ),
    ).rejects.toThrow("Invalid arguments");
    await expect(
      executeToolCall({ tool: "invented", arguments: {} }, signal, fetcher),
    ).rejects.toThrow("Unknown tool");
    await expect(
      executeToolCall(
        { tool: "get_github_repository", arguments: { repository: "cli/cli" } },
        signal,
        fetcher,
      ),
    ).rejects.toThrow("HTTP 429");
  });
  it("honors cancellation before a request", async () => {
    const controller = new AbortController();
    controller.abort(new Error("Stopped"));
    const fetcher = vi.fn<typeof fetch>();
    await expect(
      executeToolCall(
        { tool: "get_github_repository", arguments: { repository: "cli/cli" } },
        controller.signal,
        fetcher,
      ),
    ).rejects.toThrow("Stopped");
    expect(fetcher).not.toHaveBeenCalled();
  });
});
