import type { BenchCase, BenchCaseInput } from "./types";

// Ground-truth labels are used only for scoring. Every selected tool fetches live data.
const entities = {
  title: ["Earth", "Mars", "Sun", "Moon"],
  repository: [
    "vercel/next.js",
    "facebook/react",
    "microsoft/vscode",
    "cli/cli",
  ],
};
const article = (id: string, prompt: string, title: string): BenchCase => ({
  id,
  prompt,
  entities,
  expected: { tool: "get_wikipedia_article", arguments: { title } },
});
const repo = (id: string, prompt: string, repository: string): BenchCase => ({
  id,
  prompt,
  entities,
  expected: { tool: "get_github_repository", arguments: { repository } },
});
const release = (
  id: string,
  prompt: string,
  repository: string,
): BenchCase => ({
  id,
  prompt,
  entities,
  expected: { tool: "get_github_latest_release", arguments: { repository } },
});
export const BENCH_CASES: BenchCase[] = [
  article(
    "earth-article",
    "Get the current Wikipedia introduction for Earth, not Mars.",
    "Earth",
  ),
  repo(
    "nextjs-repository",
    "Check the current GitHub description and star count for vercel/next.js, not facebook/react.",
    "vercel/next.js",
  ),
  release(
    "nextjs-release",
    "Find the latest published GitHub release tag for vercel/next.js; I don't need the repository's star count.",
    "vercel/next.js",
  ),
  article(
    "mars-article",
    "Look up the Wikipedia article for Mars. The Sun is only mentioned for context.",
    "Mars",
  ),
  repo(
    "react-repository",
    "Retrieve live GitHub repository metadata for facebook/react, not microsoft/vscode.",
    "facebook/react",
  ),
  release(
    "react-release",
    "What is the latest published release of facebook/react? Please use the release endpoint, not repository metadata.",
    "facebook/react",
  ),
  article(
    "sun-article",
    "Show the current Wikipedia introduction and link count for the Sun, not the Moon.",
    "Sun",
  ),
  repo(
    "vscode-repository",
    "Check the live GitHub repository details and stars for microsoft/vscode; cli/cli is unrelated.",
    "microsoft/vscode",
  ),
  release(
    "vscode-release",
    "Fetch the latest published GitHub release tag for microsoft/vscode, not cli/cli.",
    "microsoft/vscode",
  ),
  article(
    "moon-article",
    "Get the current Wikipedia article introduction for the Moon; Earth is just context.",
    "Moon",
  ),
  repo(
    "cli-repository",
    "Retrieve current description and stars for the cli/cli GitHub repository, not vercel/next.js.",
    "cli/cli",
  ),
  release(
    "cli-release",
    "Find the latest published GitHub release for cli/cli, not the repository's star count.",
    "cli/cli",
  ),
];

export function toCaseInput(input: BenchCaseInput): BenchCaseInput {
  return structuredClone({
    id: input.id,
    prompt: input.prompt,
    entities: input.entities,
  });
}
