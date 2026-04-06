import type { RepoConfig } from "./types.ts";

export async function fetchReadme(config: RepoConfig): Promise<string> {
  const url = `https://raw.githubusercontent.com/${config.owner}/${config.repo}/${config.branch}/README.md`;

  const headers: Record<string, string> = {
    "Accept": "text/plain",
  };

  if (process.env.GITHUB_TOKEN) {
    headers["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const response = await fetch(url, { headers });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${config.owner}/${config.repo}: ${response.status} ${response.statusText}`
    );
  }

  return response.text();
}
