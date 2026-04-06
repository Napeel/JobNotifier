import { readFile, writeFile } from "node:fs/promises";
import cron from "node-cron";
import { REPOS, hashPosting } from "./types.ts";
import type { PostingRow } from "./types.ts";
import { fetchReadme } from "./poller.ts";
import { parseReadme } from "./parser.ts";
import { sendDiscordNotifications } from "./discord.ts";

const STATE_FILE = new URL("../state.json", import.meta.url).pathname;

interface State {
  [repoKey: string]: string[]; // array of known hashes per repo
}

async function loadState(): Promise<State> {
  try {
    const data = await readFile(STATE_FILE, "utf-8");
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function saveState(state: State): Promise<void> {
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

async function pollOnce(): Promise<void> {
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error("DISCORD_WEBHOOK_URL not set. Skipping.");
    return;
  }

  const state = await loadState();
  let allNewPostings: PostingRow[] = [];

  for (const repoConfig of REPOS) {
    const repoKey = `${repoConfig.owner}/${repoConfig.repo}`;
    console.log(`Polling ${repoKey}...`);

    try {
      const markdown = await fetchReadme(repoConfig);
      const postings = parseReadme(markdown, repoConfig);
      console.log(`  Found ${postings.length} total postings.`);

      const knownHashes = new Set(state[repoKey] ?? []);
      const currentHashes: string[] = [];
      const newPostings: PostingRow[] = [];

      for (const row of postings) {
        const hash = hashPosting(row);
        currentHashes.push(hash);
        if (!knownHashes.has(hash)) {
          newPostings.push(row);
        }
      }

      console.log(`  ${newPostings.length} new posting(s).`);
      allNewPostings.push(...newPostings);
      state[repoKey] = currentHashes;
    } catch (err) {
      console.error(`  Error polling ${repoKey}:`, err);
      // Skip this repo, try again next cycle
    }
  }

  if (allNewPostings.length > 0) {
    console.log(`Sending ${allNewPostings.length} notification(s) to Discord...`);
    try {
      await sendDiscordNotifications(allNewPostings, webhookUrl);
      console.log("Notifications sent.");
    } catch (err) {
      console.error("Failed to send Discord notifications:", err);
      // Don't save state — retry these postings next cycle
      return;
    }
  } else {
    console.log("No new postings.");
  }

  await saveState(state);
  console.log("State saved.\n");
}

// --- Main ---

const intervalMinutes = parseInt(process.env.POLL_INTERVAL_MINUTES ?? "15", 10);
console.log(`Internship Job Notifier starting. Polling every ${intervalMinutes} minutes.`);

// Run immediately on start
pollOnce();

// Then schedule
cron.schedule(`*/${intervalMinutes} * * * *`, () => {
  pollOnce();
});
