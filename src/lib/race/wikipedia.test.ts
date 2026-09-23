import { describe, expect, it, vi } from "vitest";
import { loadWikipediaPage } from "./wikipedia";

const signal = new AbortController().signal;
const page = {
  id: 42,
  title: "Canonical",
  html: `<section><p>An introduction long enough to be selected as the article preview and shown to agents.</p>
    <a rel="mw:WikiLink" href="./Alpha">Alpha</a>
    <a rel="mw:WikiLink" href="./Star_Trek:_The_Next_Generation">Star Trek</a>
    <a rel="mw:WikiLink" href="./Category:Examples">Category</a>
    <a rel="mw:WikiLink" href="./Alpha#History">Duplicate</a></section>`,
};

describe("Wikipedia retrieval", () => {
  it("reads one canonical page and retains its article links", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(page));
    const result = await loadWikipediaPage("Alias", signal, fetcher);
    expect(result).toMatchObject({
      id: 42,
      title: "Canonical",
      links: ["Alpha", "Star Trek: The Next Generation"],
    });
    expect(result.extract).toContain("An introduction");
    expect(String(fetcher.mock.calls[0][0])).toContain("/page/Alias/with_html");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("reports missing articles and upstream errors", async () => {
    await expect(
      loadWikipediaPage(
        "Missing",
        signal,
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response("", { status: 404 })),
      ),
    ).rejects.toThrow("was not found");
    await expect(
      loadWikipediaPage(
        "Any",
        signal,
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(new Response("", { status: 400 })),
      ),
    ).rejects.toThrow("HTTP 400");
  });

  it("retries a rate-limited page request", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("", { status: 429, headers: { "Retry-After": "0" } }),
      )
      .mockResolvedValueOnce(Response.json(page));
    expect((await loadWikipediaPage("Alias", signal, fetcher)).title).toBe(
      "Canonical",
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("stops retrying after the bounded rate-limit budget", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response("", { status: 429, headers: { "Retry-After": "0" } }),
      );
    await expect(loadWikipediaPage("Alias", signal, fetcher)).rejects.toThrow(
      "HTTP 429",
    );
    expect(fetcher).toHaveBeenCalledTimes(6);
  });
});
