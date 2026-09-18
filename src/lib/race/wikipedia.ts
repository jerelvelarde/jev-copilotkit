import { z } from "zod";
import { articleUrl, type Article } from "./types";

const responseSchema = z.object({
  error: z.object({ info: z.string() }).optional(),
  continue: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  query: z
    .object({
      pages: z.array(
        z.object({
          pageid: z.number().optional(),
          title: z.string(),
          missing: z.boolean().optional(),
          extract: z.string().optional(),
          links: z
            .array(z.object({ ns: z.number(), title: z.string() }))
            .optional(),
        }),
      ),
    })
    .optional(),
});
export const MAX_PAGE_LINKS = 5000;

export async function loadWikipediaPage(
  title: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<Article> {
  let continuation: Record<string, string | number> = {};
  let article: Article | undefined;
  const links = new Set<string>();
  for (let batch = 0; batch < 20; batch++) {
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      formatversion: "2",
      redirects: "1",
      titles: title,
      prop: "extracts|links",
      exintro: "1",
      explaintext: "1",
      plnamespace: "0",
      pllimit: "500",
    });
    for (const [key, value] of Object.entries(continuation))
      params.set(key, String(value));
    const response = await fetcher(
      `https://en.wikipedia.org/w/api.php?${params}`,
      {
        signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
        headers: {
          "User-Agent":
            process.env.WIKIPEDIA_USER_AGENT ||
            "WikiRaceCopilotKit/0.1 (local development demo)",
        },
      },
    );
    if (!response.ok)
      throw new Error(
        `Wikipedia returned HTTP ${response.status}. Please retry.`,
      );
    const data = responseSchema.parse(await response.json());
    if (data.error) throw new Error(`Wikipedia: ${data.error.info}`);
    const page = data.query?.pages[0];
    if (!page || page.missing || !page.pageid || page.pageid < 0)
      throw new Error(
        `Wikipedia article “${title}” was not found. Check the title.`,
      );
    if (!article)
      article = {
        id: page.pageid,
        title: page.title,
        extract: (
          page.extract || "No introduction available for this article."
        ).slice(0, 850),
        url: articleUrl(page.title),
        links: [],
      };
    for (const link of page.links || [])
      if (link.ns === 0) links.add(link.title);
    if (links.size > MAX_PAGE_LINKS)
      throw new Error(
        `“${page.title}” exceeds the ${MAX_PAGE_LINKS}-link demo budget. No links were silently discarded.`,
      );
    if (!data.continue) return { ...article, links: [...links] };
    continuation = data.continue;
  }
  throw new Error(
    "Wikipedia pagination exceeded the demo retrieval budget. Try another article.",
  );
}
