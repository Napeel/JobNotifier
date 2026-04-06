import type { PostingRow } from "./types.ts";

interface DiscordEmbed {
  title: string;
  description: string;
  url?: string;
  color: number;
  timestamp: string;
  footer?: { text: string };
}

function buildEmbed(row: PostingRow): DiscordEmbed {
  return {
    title: `${row.company} — ${row.role}`,
    description: [
      row.location,
      row.datePosted ? `Posted: ${row.datePosted}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    url: row.applyUrl || undefined,
    color: 0x5865f2, // Discord blurple
    timestamp: new Date().toISOString(),
    footer: { text: row.repoSource },
  };
}

export async function sendDiscordNotifications(
  rows: PostingRow[],
  webhookUrl: string
): Promise<void> {
  // Discord allows max 10 embeds per message
  const batchSize = 10;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    const embeds = batch.map(buildEmbed);

    const body = JSON.stringify({
      username: "Internship Notifier",
      embeds,
    });

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      console.error(
        `Discord webhook failed (${response.status}): ${text}`
      );
      throw new Error(`Discord webhook failed: ${response.status}`);
    }

    // Rate limit: small delay between batches
    if (i + batchSize < rows.length) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
