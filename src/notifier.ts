import { sendDiscordNotifications as defaultSendDiscordNotifications } from "./discord.ts";
import { parseReadme as defaultParseReadme } from "./parser.ts";
import { fetchReadme as defaultFetchReadme } from "./poller.ts";
import type { State, StateStore } from "./state.ts";
import { REPOS, hashPosting } from "./types.ts";
import type { PostingRow, RepoConfig } from "./types.ts";

export type NotifierStatus = "seeded" | "notified" | "no_changes" | "skipped" | "error";

export interface NotifierResult {
  status: NotifierStatus;
  repoCount: number;
  newPostingCount: number;
  errors: string[];
}

export interface NotifierLogger {
  log(message?: unknown, ...optionalParams: unknown[]): void;
  error(message?: unknown, ...optionalParams: unknown[]): void;
}

export interface NotifierOptions {
  stateStore: StateStore;
  webhookUrl?: string;
  repos?: RepoConfig[];
  fetchReadme?: (config: RepoConfig) => Promise<string>;
  parseReadme?: (markdown: string, config: RepoConfig) => PostingRow[];
  sendDiscordNotifications?: (rows: PostingRow[], webhookUrl: string) => Promise<void>;
  logger?: NotifierLogger;
}

function repoKey(config: RepoConfig): string {
  return `${config.owner}/${config.repo}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function cloneState(state: State): State {
  return Object.fromEntries(Object.entries(state).map(([key, hashes]) => [key, [...hashes]]));
}

export async function seedState(options: NotifierOptions): Promise<NotifierResult> {
  const {
    stateStore,
    repos = REPOS,
    fetchReadme = defaultFetchReadme,
    parseReadme = defaultParseReadme,
    logger = console,
  } = options;

  logger.log("Seeding state (no notifications will be sent)...");

  try {
    const state = cloneState(await stateStore.load());

    for (const config of repos) {
      const key = repoKey(config);
      logger.log(`Fetching ${key}...`);

      const markdown = await fetchReadme(config);
      const postings = parseReadme(markdown, config);
      state[key] = postings.map(hashPosting);

      logger.log(`  ${postings.length} postings hashed.`);
    }

    await stateStore.save(state);
    logger.log("State seeded. Future runs will only notify NEW postings.");

    return {
      status: "seeded",
      repoCount: repos.length,
      newPostingCount: 0,
      errors: [],
    };
  } catch (error) {
    const message = errorMessage(error);
    logger.error("Failed to seed state:", error);

    return {
      status: "error",
      repoCount: repos.length,
      newPostingCount: 0,
      errors: [message],
    };
  }
}

export async function pollOnce(options: NotifierOptions): Promise<NotifierResult> {
  const {
    stateStore,
    webhookUrl,
    repos = REPOS,
    fetchReadme = defaultFetchReadme,
    parseReadme = defaultParseReadme,
    sendDiscordNotifications = defaultSendDiscordNotifications,
    logger = console,
  } = options;

  const state = await stateStore.load();
  const nextState = cloneState(state);
  const allNewPostings: PostingRow[] = [];
  const errors: string[] = [];
  let successfulRepoCount = 0;

  for (const config of repos) {
    const key = repoKey(config);
    logger.log(`Polling ${key}...`);

    try {
      const markdown = await fetchReadme(config);
      const postings = parseReadme(markdown, config);
      logger.log(`  Found ${postings.length} total postings.`);

      const knownHashes = new Set(state[key] ?? []);
      const currentHashes: string[] = [];
      const newPostings: PostingRow[] = [];

      for (const row of postings) {
        const hash = hashPosting(row);
        currentHashes.push(hash);
        if (!knownHashes.has(hash)) {
          newPostings.push(row);
        }
      }

      logger.log(`  ${newPostings.length} new posting(s).`);
      allNewPostings.push(...newPostings);
      nextState[key] = currentHashes;
      successfulRepoCount += 1;
    } catch (error) {
      const message = `Error polling ${key}: ${errorMessage(error)}`;
      errors.push(message);
      logger.error(`  ${message}`, error);
    }
  }

  if (successfulRepoCount === 0 && errors.length > 0) {
    return {
      status: "error",
      repoCount: repos.length,
      newPostingCount: 0,
      errors,
    };
  }

  if (allNewPostings.length === 0) {
    await stateStore.save(nextState);
    logger.log("No new postings.");
    logger.log("State saved.\n");

    return {
      status: "no_changes",
      repoCount: repos.length,
      newPostingCount: 0,
      errors,
    };
  }

  if (!webhookUrl) {
    const message = "DISCORD_WEBHOOK_URL not set. Skipping.";
    errors.push(message);
    logger.error(message);

    return {
      status: "error",
      repoCount: repos.length,
      newPostingCount: allNewPostings.length,
      errors,
    };
  }

  logger.log(`Sending ${allNewPostings.length} notification(s) to Discord...`);

  try {
    await sendDiscordNotifications(allNewPostings, webhookUrl);
    logger.log("Notifications sent.");
  } catch (error) {
    const message = `Failed to send Discord notifications: ${errorMessage(error)}`;
    errors.push(message);
    logger.error("Failed to send Discord notifications:", error);

    return {
      status: "error",
      repoCount: repos.length,
      newPostingCount: allNewPostings.length,
      errors,
    };
  }

  await stateStore.save(nextState);
  logger.log("State saved.\n");

  return {
    status: "notified",
    repoCount: repos.length,
    newPostingCount: allNewPostings.length,
    errors,
  };
}
