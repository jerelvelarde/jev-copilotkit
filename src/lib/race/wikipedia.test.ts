import { describe, expect, it, vi } from "vitest";
import { loadWikipediaPage } from "./wikipedia";
const signal = new AbortController().signal;
describe("Wikipedia retrieval", () => {
  it("follows continuation and canonical titles, retaining all article links", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          continue: { continue: "||", plcontinue: "1|0|Middle" },
          query: {
            pages: [
              {
                pageid: 1,
                title: "Canonical",
                extract: "An intro",
                links: [
                  { ns: 0, title: "Alpha" },
                  { ns: 1, title: "Talk:Alpha" },
                ],
              },
            ],
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          query: {
            pages: [
              {
                pageid: 1,
                title: "Canonical",
                links: [{ ns: 0, title: "Zulu" }],
              },
            ],
          },
        }),
      );
    const result = await loadWikipediaPage("Alias", signal, fetcher);
    expect(result.title).toBe("Canonical");
    expect(result.links).toEqual(["Alpha", "Zulu"]);
    expect(String(fetcher.mock.calls[1][0])).toContain(
      "plcontinue=1%7C0%7CMiddle",
    );
  });
  it("reports missing articles and upstream errors", async () => {
    await expect(
      loadWikipediaPage(
        "Missing",
        signal,
        vi.fn<typeof fetch>().mockResolvedValue(
          Response.json({
            query: { pages: [{ title: "Missing", missing: true }] },
          }),
        ),
      ),
    ).rejects.toThrow("was not found");
    await expect(
      loadWikipediaPage(
        "Any",
        signal,
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response("", { status: 429 })),
      ),
    ).rejects.toThrow("HTTP 429");
  });
});
