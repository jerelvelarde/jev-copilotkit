import { setTimeout as delay } from "node:timers/promises";
import { load } from "cheerio";
import { z } from "zod";
import { articleUrl, type Article } from "./types";

const pageSchema = z.object({
  id: z.number().positive(),
  title: z.string(),
  html: z.string(),
});

export const MAX_PAGE_LINKS = 5000;
const excludedNamespaces = new Set([
  "book",
  "category",
  "draft",
  "file",
  "help",
  "media",
  "mediawiki",
  "module",
  "portal",
  "special",
  "talk",
  "template",
  "timedtext",
  "user",
  "user talk",
  "wikipedia",
  "wikipedia talk",
]);

export async function loadWikipediaPage(
  title: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<Article> {
  const url = `https://en.wikipedia.org/w/rest.php/v1/page/${encodeURIComponent(title.replaceAll(" ", "_"))}/with_html`;
  let response: Response;
  let body: unknown;
  let transportRetries = 0;
  let rateRetries = 0;
  for (;;) {
    try {
      response = await fetcher(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(12_000)]),
        headers: {
          "User-Agent":
            process.env.WIKIPEDIA_USER_AGENT ||
            "JevCopilotKitWikiRace/0.1 (https://github.com/jerelvelarde/jev-copilotkit)",
        },
      });
      // The fetch promise may resolve before the large HTML body has arrived.
      // Keep body consumption inside the retry boundary as well.
      if (response.ok) body = await response.json();
    } catch (error) {
      if (signal.aborted || transportRetries >= 2) throw error;
      transportRetries++;
      await delay(250 * transportRetries, undefined, { signal });
      continue;
    }
    if (response.status !== 429 && response.status !== 503) break;
    if (rateRetries >= 5) break;
    const retryAfter = Number(response.headers.get("Retry-After"));
    const waitMs =
      response.headers.has("Retry-After") && Number.isFinite(retryAfter)
        ? Math.max(0, Math.min(4000, retryAfter * 1000))
        : 700 * 2 ** rateRetries;
    rateRetries++;
    await delay(waitMs, undefined, { signal });
  }
  if (response.status === 404)
    throw new Error(
      `Wikipedia article “${title}” was not found. Check the title.`,
    );
  if (!response.ok)
    throw new Error(
      `Wikipedia returned HTTP ${response.status}. Please retry.`,
    );

  const page = pageSchema.parse(body);
  const $ = load(page.html);
  const intro = $("section p")
    .map((_, element) => $(element).text().trim())
    .get()
    .find((paragraph) => paragraph.length > 60);
  const links = new Set<string>();
  $('a[rel="mw:WikiLink"]').each((_, element) => {
    const href = $(element).attr("href");
    if (!href?.startsWith("./")) return;
    const encoded = href.slice(2).split(/[?#]/, 1)[0];
    let linkedTitle: string;
    try {
      linkedTitle = decodeURIComponent(encoded).replaceAll("_", " ");
    } catch {
      return;
    }
    if (
      !linkedTitle ||
      excludedNamespaces.has(linkedTitle.split(":", 1)[0].toLowerCase())
    )
      return;
    links.add(linkedTitle);
  });
  if (links.size > MAX_PAGE_LINKS)
    throw new Error(
      `“${page.title}” exceeds the ${MAX_PAGE_LINKS}-link demo budget. No links were silently discarded.`,
    );
  return {
    id: page.id,
    title: page.title,
    extract: (intro || "No introduction available for this article.").slice(
      0,
      850,
    ),
    url: articleUrl(page.title),
    links: [...links],
  };
}
