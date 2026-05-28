import assert from "node:assert/strict";
import { handleWorkerRequest } from "../src/serverless.ts";
import type { ServerlessRequest, ServerlessResponse, WorkerResponseBody } from "../src/serverless.ts";
import type { NotifierOptions, NotifierResult } from "../src/notifier.ts";
import { DEFAULT_LOCK_TTL_SECONDS, REDIS_POLL_LOCK_KEY } from "../src/redis-state.ts";
import type { LockRelease, State, StateStore } from "../src/state.ts";

const env = {
  CRON_SECRET: "test-secret",
  DISCORD_WEBHOOK_URL: "https://discord.example/webhook",
  UPSTASH_REDIS_REST_URL: "https://redis.example",
  UPSTASH_REDIS_REST_TOKEN: "redis-token",
};

const seededResult: NotifierResult = {
  status: "seeded",
  repoCount: 2,
  newPostingCount: 0,
  errors: [],
};

const noChangesResult: NotifierResult = {
  status: "no_changes",
  repoCount: 2,
  newPostingCount: 0,
  errors: [],
};

const silentLogger = {
  log: () => {},
  error: () => {},
};

class SmokeResponse implements ServerlessResponse {
  statusCode = 0;
  body: WorkerResponseBody | undefined;

  status(statusCode: number): ServerlessResponse {
    this.statusCode = statusCode;
    return this;
  }

  json(body: WorkerResponseBody): void {
    this.body = body;
  }
}

class SmokeStateStore implements StateStore {
  readonly events: string[] = [];
  readonly acquiredLocks: Array<{ key: string; ttlSeconds: number }> = [];
  releaseCount = 0;

  constructor(private readonly initialized: boolean, private readonly lockAvailable = true) {}

  async load(): Promise<State> {
    return {};
  }

  async save(_state: State): Promise<void> {}

  async isInitialized(): Promise<boolean> {
    this.events.push("isInitialized");
    return this.initialized;
  }

  async acquireLock(key: string, ttlSeconds: number): Promise<LockRelease | null> {
    this.events.push("acquireLock");
    this.acquiredLocks.push({ key, ttlSeconds });

    if (!this.lockAvailable) {
      return null;
    }

    return {
      release: async () => {
        this.releaseCount += 1;
        this.events.push("release");
      },
    };
  }
}

function request(method = "GET", authorization = `Bearer ${env.CRON_SECRET}`): ServerlessRequest {
  return {
    method,
    headers: authorization ? { authorization } : {},
  };
}

async function runHandler(options: {
  request?: ServerlessRequest;
  env?: Record<string, string | undefined>;
  store?: SmokeStateStore;
  seedState?: (options: NotifierOptions) => Promise<NotifierResult>;
  pollOnce?: (options: NotifierOptions) => Promise<NotifierResult>;
}): Promise<{ response: SmokeResponse; store?: SmokeStateStore }> {
  const response = new SmokeResponse();
  const store = options.store;

  await handleWorkerRequest({
    request: options.request ?? request(),
    response,
    env: options.env ?? env,
    createStateStore: store ? async () => store : undefined,
    seedState: options.seedState,
    pollOnce: options.pollOnce,
    logger: silentLogger,
  });

  return { response, store };
}

async function main(): Promise<void> {
  const seededStore = new SmokeStateStore(false);
  const pollCalls: Array<{ webhookUrl: string | undefined }> = [];

  const seeded = await runHandler({
    store: seededStore,
    seedState: async () => {
      seededStore.events.push("seedState");
      return seededResult;
    },
    pollOnce: async () => {
      throw new Error("poll should not run during seeding");
    },
  });

  assert.equal(seeded.response.statusCode, 200);
  assert.deepEqual(seeded.response.body, {
    ok: true,
    status: "seeded",
    repoCount: 2,
    newPostingCount: 0,
    errors: [],
  });
  assert.deepEqual(seededStore.acquiredLocks, [{ key: REDIS_POLL_LOCK_KEY, ttlSeconds: DEFAULT_LOCK_TTL_SECONDS }]);
  assert.deepEqual(seededStore.events, ["acquireLock", "isInitialized", "seedState", "release"]);
  assert.equal(seededStore.releaseCount, 1);

  const pollingStore = new SmokeStateStore(true);
  const polled = await runHandler({
    store: pollingStore,
    seedState: async () => {
      throw new Error("seed should not run for initialized state");
    },
    pollOnce: async (options) => {
      pollingStore.events.push("pollOnce");
      pollCalls.push({ webhookUrl: options.webhookUrl });
      return noChangesResult;
    },
  });

  assert.equal(polled.response.statusCode, 200);
  assert.deepEqual(polled.response.body, {
    ok: true,
    status: "no_changes",
    repoCount: 2,
    newPostingCount: 0,
    errors: [],
  });
  assert.deepEqual(pollingStore.acquiredLocks, [{ key: REDIS_POLL_LOCK_KEY, ttlSeconds: DEFAULT_LOCK_TTL_SECONDS }]);
  assert.deepEqual(pollingStore.events, ["acquireLock", "isInitialized", "pollOnce", "release"]);
  assert.equal(pollingStore.releaseCount, 1);
  assert.deepEqual(pollCalls, [{ webhookUrl: env.DISCORD_WEBHOOK_URL }]);

  const missingAuthorization = await runHandler({
    request: request("GET", ""),
    store: new SmokeStateStore(true),
  });
  assert.equal(missingAuthorization.response.statusCode, 401);
  assert.deepEqual(missingAuthorization.response.body, { ok: false });

  console.log("worker smoke ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
