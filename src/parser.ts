import type { PostingRow, RepoConfig } from "./types.ts";

/**
 * Extract the URL from various markdown link formats:
 * - Shield badge: [![Apply](badge-url)](actual-url)
 * - Plain link: [Apply](<url>) or [Apply](url)
 */
function extractUrl(cell: string): string {
  // Shield badge format: [![...](badge)](URL)
  const badgeMatch = cell.match(/\]\]\((https?:\/\/[^)]+)\)/);
  if (badgeMatch) return badgeMatch[1];

  // Plain markdown link: [text](<url>) or [text](url)
  const linkMatch = cell.match(/\]\(<?([^>)]+)>?\)/);
  if (linkMatch) return linkMatch[1];

  // Raw URL
  const rawMatch = cell.match(/(https?:\/\/\S+)/);
  if (rawMatch) return rawMatch[1];

  return "";
}

/**
 * Strip markdown formatting, HTML comments, and emoji from a cell value.
 */
function cleanCell(cell: string): string {
  return cell
    .replace(/<!--.*?-->/g, "")           // HTML comments
    .replace(/!\[.*?\]\(.*?\)/g, "")      // images
    .replace(/\[([^\]]*)\]\(.*?\)/g, "$1") // links → text
    .replace(/[↳🔥💤🏆⭐✅❌🆕]/gu, "")   // common emoji
    .trim();
}

export function parseReadme(
  markdown: string,
  config: RepoConfig
): PostingRow[] {
  const lines = markdown.split("\n");
  const rows: PostingRow[] = [];

  let inTable = false;
  let headerSkipped = false;

  for (const line of lines) {
    const trimmed = line.trim();

    // Detect table rows (lines starting and ending with |)
    if (!trimmed.startsWith("|")) {
      if (inTable) {
        // Table ended
        inTable = false;
        headerSkipped = false;
      }
      continue;
    }

    if (!inTable) {
      // First | line is the header row — skip it
      inTable = true;
      continue;
    }

    if (!headerSkipped) {
      // Second | line is the separator (|---|---|...) — skip it
      if (trimmed.includes("---")) {
        headerSkipped = true;
        continue;
      }
    }

    // Parse data row
    const cells = trimmed
      .split("|")
      .slice(1, -1) // remove empty first/last from leading/trailing |
      .map((c) => c.trim());

    const { columns } = config;

    if (cells.length <= Math.max(columns.company, columns.role, columns.location, columns.apply)) {
      continue; // malformed row
    }

    const company = cleanCell(cells[columns.company]);
    const role = cleanCell(cells[columns.role]);
    const location = cleanCell(cells[columns.location]);
    const applyUrl = extractUrl(cells[columns.apply]);
    const datePosted =
      columns.datePosted !== undefined
        ? cleanCell(cells[columns.datePosted])
        : undefined;

    // Skip rows with empty essential fields
    if (!company || !role) continue;

    rows.push({
      company,
      role,
      location,
      applyUrl,
      datePosted,
      repoSource: `${config.owner}/${config.repo}`,
    });
  }

  return rows;
}
