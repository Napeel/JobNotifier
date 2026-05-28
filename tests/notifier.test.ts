import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pollOnce, seedState } from "../src/notifier.ts";
import type { NotifierLogger } from "../src/notifier.ts";
import { fetchReadme } from "../src/poller.ts";
import type { LockRelease, State, StateStore } from "../src/state.ts";
import { hashPosting } from "../src/types.ts";
import type { PostingRow, RepoConfig } from "../src/types.ts";

const repoOne: RepoConfig = {
  owner: "owner",
  repo: "repo-one",
  branch: "main",
  columns: { company: 0, role: 1, location: 2, apply: 3 },
};

const repoTwo: RepoConfig = {
  owner: "owner",
  repo: "repo-two",
  branch: "main",
  columns: { company: 0, role: 1, location: 2, apply: 3 },
};

const repos = [repoOne, repoTwo];

const silentLogger: NotifierLogger = {
  log: () => {},
  error: () => {},
};

class FakeStateStore implements StateStore {
  readonly saveCalls: State[] = [];

  constructor(private state: State = {}) {}

  async load(): Promise<State> {
    return cloneState(this.state);
  }

  async save(state: State): Promise<void> {
    const saved = cloneState(state);
    this.saveCalls.push(saved);
    this.state = saved;
  }

  async isInitialized(): Promise<boolean> {
    return Object.keys(this.state).length > 0;
  }

  async acquireLock(_key: string, _ttlSeconds: number): Promise<LockRelease | null> {
    return { release: async () => {} };
  }

  snapshot(): State {
    return cloneState(this.state);
  }
}

function cloneState(state: State): State {
  return Object.fromEntries(Object.entries(state).map(([key, hashes]) => [key, [...hashes]]));
}

function repoKey(config: RepoConfig): string {
  return `${config.owner}/${config.repo}`;
}

function row(company: string, role: string, location: string, repoSource = "owner/repo-one"): PostingRow {
  return {
    company,
    role,
    location,
    applyUrl: `https://jobs.example.com/${company.toLowerCase()}`,
    repoSource,
  };
}

function hashes(rows: PostingRow[]): string[] {
  return rows.map(hashPosting);
}

function createFetchReadme(failingRepoKeys = new Set<string>()): (config: RepoConfig) => Promise<string> {
  return async (config) => {
    const key = repoKey(config);
    if (failingRepoKeys.has(key)) {
      throw new Error(`fetch failed for ${key}`);
    }

    return key;
  };
}

function createParseReadme(rowsByRepo: Record<string, PostingRow[]>): (markdown: string, config: RepoConfig) => PostingRow[] {
  return (markdown, config) => rowsByRepo[repoKey(config)] ?? rowsByRepo[markdown] ?? [];
}

describe("seedState", () => {
  it("seeds hashes for all repos without sending Discord notifications", async () => {
    const repoOneRows = [row("Acme", "SWE Intern", "Toronto")];
    const repoTwoRows = [row("Globex", "Data Intern", "Vancouver", repoKey(repoTwo))];
    const store = new FakeStateStore();
    const notificationCalls: PostingRow[][] = [];

    const result = await seedState({
      stateStore: store,
      repos,
      fetchReadme: createFetchReadme(),
      parseReadme: createParseReadme({
        [repoKey(repoOne)]: repoOneRows,
        [repoKey(repoTwo)]: repoTwoRows,
      }),
      sendDiscordNotifications: async (rowsToSend) => {
        notificationCalls.push(rowsToSend);
      },
      logger: silentLogger,
    });

    assert.deepEqual(result, {
      status: "seeded",
      repoCount: 2,
      newPostingCount: 0,
      errors: [],
    });
    assert.deepEqual(store.snapshot(), {
      [repoKey(repoOne)]: hashes(repoOneRows),
      [repoKey(repoTwo)]: hashes(repoTwoRows),
    });
    assert.equal(store.saveCalls.length, 1);
    assert.equal(notificationCalls.length, 0);
  });
});

describe("fetchReadme", () => {
  it("omits GitHub authorization without GITHUB_TOKEN and adds it when configured", async () => {
    const originalFetch = globalThis.fetch;
    const originalGitHubToken = process.env.GITHUB_TOKEN;
    const requests: Array<{ url: string; headers: Record<string, string> }> = [];

    globalThis.fetch = (async (url, init) => {
      requests.push({
        url: String(url),
        headers: init?.headers as Record<string, string>,
      });

      return new Response("readme", { status: 200 });
    }) as typeof fetch;

    try {
      delete process.env.GITHUB_TOKEN;
      assert.equal(await fetchReadme(repoOne), "readme");

      process.env.GITHUB_TOKEN = "github-token";
      assert.equal(await fetchReadme(repoTwo), "readme");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalGitHubToken === undefined) {
        delete process.env.GITHUB_TOKEN;
      } else {
        process.env.GITHUB_TOKEN = originalGitHubToken;
      }
    }

    assert.deepEqual(requests, [
      {
        url: "https://raw.githubusercontent.com/owner/repo-one/main/README.md",
        headers: { Accept: "text/plain" },
      },
      {
        url: "https://raw.githubusercontent.com/owner/repo-two/main/README.md",
        headers: { Accept: "text/plain", Authorization: "Bearer github-token" },
      },
    ]);
  });
});

describe("pollOnce", () => {
  it("saves current hashes and sends no notifications when there are no new postings", async () => {
    const currentRows = [row("Acme", "SWE Intern", "Toronto")];
    const store = new FakeStateStore({ [repoKey(repoOne)]: hashes(currentRows) });
    const notificationCalls: PostingRow[][] = [];

    const result = await pollOnce({
      stateStore: store,
      repos: [repoOne],
      fetchReadme: createFetchReadme(),
      parseReadme: createParseReadme({ [repoKey(repoOne)]: currentRows }),
      sendDiscordNotifications: async (rowsToSend) => {
        notificationCalls.push(rowsToSend);
      },
      logger: silentLogger,
    });

    assert.equal(result.status, "no_changes");
    assert.equal(result.newPostingCount, 0);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(store.snapshot(), { [repoKey(repoOne)]: hashes(currentRows) });
    assert.equal(store.saveCalls.length, 1);
    assert.equal(notificationCalls.length, 0);
  });

  it("sends new notifications and saves current hashes when Discord succeeds", async () => {
    const knownRow = row("Acme", "SWE Intern", "Toronto");
    const newRow = row("Globex", "Platform Intern", "Remote");
    const currentRows = [knownRow, newRow];
    const store = new FakeStateStore({ [repoKey(repoOne)]: hashes([knownRow]) });
    const notificationCalls: Array<{ rows: PostingRow[]; webhookUrl: string }> = [];

    const result = await pollOnce({
      stateStore: store,
      webhookUrl: "https://discord.example/webhook",
      repos: [repoOne],
      fetchReadme: createFetchReadme(),
      parseReadme: createParseReadme({ [repoKey(repoOne)]: currentRows }),
      sendDiscordNotifications: async (rowsToSend, webhookUrl) => {
        notificationCalls.push({ rows: rowsToSend, webhookUrl });
      },
      logger: silentLogger,
    });

    assert.equal(result.status, "notified");
    assert.equal(result.newPostingCount, 1);
    assert.deepEqual(result.errors, []);
    assert.deepEqual(notificationCalls, [{ rows: [newRow], webhookUrl: "https://discord.example/webhook" }]);
    assert.deepEqual(store.snapshot(), { [repoKey(repoOne)]: hashes(currentRows) });
    assert.equal(store.saveCalls.length, 1);
  });

  it("does not advance state when Discord notification fails for new postings", async () => {
    const knownRow = row("Acme", "SWE Intern", "Toronto");
    const newRow = row("Globex", "Platform Intern", "Remote");
    const initialState = { [repoKey(repoOne)]: hashes([knownRow]) };
    const store = new FakeStateStore(initialState);

    const result = await pollOnce({
      stateStore: store,
      webhookUrl: "https://discord.example/webhook",
      repos: [repoOne],
      fetchReadme: createFetchReadme(),
      parseReadme: createParseReadme({ [repoKey(repoOne)]: [knownRow, newRow] }),
      sendDiscordNotifications: async () => {
        throw new Error("discord unavailable");
      },
      logger: silentLogger,
    });

    assert.equal(result.status, "error");
    assert.equal(result.newPostingCount, 1);
    assert.match(result.errors[0], /discord unavailable/);
    assert.deepEqual(store.snapshot(), initialState);
    assert.equal(store.saveCalls.length, 0);
  });

  it("continues polling other repos after one repo fetch failure", async () => {
    const existingFailedRepoState = ["unchanged-failed-repo-hash"];
    const currentRows = [row("Acme", "SWE Intern", "Toronto")];
    const store = new FakeStateStore({
      [repoKey(repoOne)]: hashes(currentRows),
      [repoKey(repoTwo)]: existingFailedRepoState,
    });

    const result = await pollOnce({
      stateStore: store,
      repos,
      fetchReadme: createFetchReadme(new Set([repoKey(repoTwo)])),
      parseReadme: createParseReadme({ [repoKey(repoOne)]: currentRows }),
      logger: silentLogger,
    });

    assert.equal(result.status, "no_changes");
    assert.equal(result.repoCount, 2);
    assert.equal(result.newPostingCount, 0);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /owner\/repo-two/);
    assert.deepEqual(store.snapshot(), {
      [repoKey(repoOne)]: hashes(currentRows),
      [repoKey(repoTwo)]: existingFailedRepoState,
    });
    assert.equal(store.saveCalls.length, 1);
  });

  it("returns an error without saving when new postings exist and webhookUrl is missing", async () => {
    const knownRow = row("Acme", "SWE Intern", "Toronto");
    const newRow = row("Globex", "Platform Intern", "Remote");
    const initialState = { [repoKey(repoOne)]: hashes([knownRow]) };
    const store = new FakeStateStore(initialState);
    const notificationCalls: PostingRow[][] = [];

    const result = await pollOnce({
      stateStore: store,
      repos: [repoOne],
      fetchReadme: createFetchReadme(),
      parseReadme: createParseReadme({ [repoKey(repoOne)]: [knownRow, newRow] }),
      sendDiscordNotifications: async (rowsToSend) => {
        notificationCalls.push(rowsToSend);
      },
      logger: silentLogger,
    });

    assert.equal(result.status, "error");
    assert.equal(result.newPostingCount, 1);
    assert.match(result.errors[0], /DISCORD_WEBHOOK_URL not set/);
    assert.deepEqual(store.snapshot(), initialState);
    assert.equal(store.saveCalls.length, 0);
    assert.equal(notificationCalls.length, 0);
  });
});
