import assert from "node:assert/strict";
import { describe, it } from "node:test";
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

class FakeResponse implements ServerlessResponse {
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

class FakeStateStore implements StateStore {
  readonly events: string[] = [];
  readonly acquiredLocks: Array<{ key: string; ttlSeconds: number }> = [];
  releaseCount = 0;

  constructor(
    private readonly initialized: boolean,
    private readonly lockAvailable = true,
  ) {}

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
  store?: FakeStateStore;
  seedState?: (options: NotifierOptions) => Promise<NotifierResult>;
  pollOnce?: (options: NotifierOptions) => Promise<NotifierResult>;
}): Promise<{ response: FakeResponse; store?: FakeStateStore }> {
  const response = new FakeResponse();
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

describe("handleWorkerRequest", () => {
  it("rejects non-GET requests", async () => {
    const store = new FakeStateStore(true);

    const { response } = await runHandler({ request: request("POST"), store });

    assert.equal(response.statusCode, 405);
    assert.deepEqual(response.body, { ok: false, error: "Method not allowed" });
    assert.deepEqual(store.events, []);
  });

  it("fails closed when CRON_SECRET is missing", async () => {
    const store = new FakeStateStore(true);

    const { response } = await runHandler({
      env: { ...env, CRON_SECRET: undefined },
      store,
    });

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.body, { ok: false, error: "CRON_SECRET not configured" });
    assert.deepEqual(store.events, []);
    assert.doesNotMatch(JSON.stringify(response.body), /test-secret|redis-token/);
  });

  it("rejects missing and invalid Authorization before creating state", async () => {
    let createStateCalls = 0;

    async function runUnauthorized(authorization: string): Promise<FakeResponse> {
      const response = new FakeResponse();

      await handleWorkerRequest({
        request: request("GET", authorization),
        response,
        env,
        createStateStore: async () => {
          createStateCalls += 1;
          throw new Error("state should not be created");
        },
        logger: silentLogger,
      });

      return response;
    }

    const missing = await runUnauthorized("");
    const invalid = await runUnauthorized("Bearer wrong-secret");

    assert.equal(missing.statusCode, 401);
    assert.deepEqual(missing.body, { ok: false });
    assert.equal(invalid.statusCode, 403);
    assert.deepEqual(invalid.body, { ok: false });
    assert.equal(createStateCalls, 0);
  });

  it("names missing Redis configuration keys without exposing values", async () => {
    const response = new FakeResponse();

    await handleWorkerRequest({
      request: request(),
      response,
      env: {
        CRON_SECRET: env.CRON_SECRET,
        DISCORD_WEBHOOK_URL: env.DISCORD_WEBHOOK_URL,
      },
      seedState: async () => seededResult,
      pollOnce: async () => noChangesResult,
      logger: silentLogger,
    });

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.body, {
      ok: false,
      error: "Redis configuration missing",
      missing: ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"],
    });
    assert.doesNotMatch(JSON.stringify(response.body), /test-secret/);
  });

  it("polls once for a valid initialized request", async () => {
    const store = new FakeStateStore(true);
    const pollCalls: Array<{ webhookUrl: string | undefined }> = [];

    const { response } = await runHandler({
      store,
      seedState: async () => {
        throw new Error("seed should not run");
      },
      pollOnce: async (options) => {
        store.events.push("pollOnce");
        pollCalls.push({ webhookUrl: options.webhookUrl });
        return noChangesResult;
      },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, {
      ok: true,
      status: "no_changes",
      repoCount: 2,
      newPostingCount: 0,
      errors: [],
    });
    assert.deepEqual(pollCalls, [{ webhookUrl: env.DISCORD_WEBHOOK_URL }]);
    assert.deepEqual(store.acquiredLocks, [{ key: REDIS_POLL_LOCK_KEY, ttlSeconds: DEFAULT_LOCK_TTL_SECONDS }]);
    assert.deepEqual(store.events, ["acquireLock", "isInitialized", "pollOnce", "release"]);
    assert.equal(store.releaseCount, 1);
  });

  it("seeds silently for missing state and returns seeded", async () => {
    const store = new FakeStateStore(false);
    let pollCalls = 0;

    const { response } = await runHandler({
      store,
      seedState: async () => {
        store.events.push("seedState");
        return seededResult;
      },
      pollOnce: async () => {
        pollCalls += 1;
        return noChangesResult;
      },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, {
      ok: true,
      status: "seeded",
      repoCount: 2,
      newPostingCount: 0,
      errors: [],
    });
    assert.equal(pollCalls, 0);
    assert.deepEqual(store.events, ["acquireLock", "isInitialized", "seedState", "release"]);
    assert.equal(store.releaseCount, 1);
  });

  it("skips when the poll lock is already held", async () => {
    const store = new FakeStateStore(true, false);

    const { response } = await runHandler({
      store,
      seedState: async () => {
        throw new Error("seed should not run");
      },
      pollOnce: async () => {
        throw new Error("poll should not run");
      },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { ok: true, status: "skipped" });
    assert.deepEqual(store.events, ["acquireLock"]);
    assert.equal(store.releaseCount, 0);
  });

  it("releases the lock when poll throws", async () => {
    const store = new FakeStateStore(true);

    const { response } = await runHandler({
      store,
      pollOnce: async () => {
        store.events.push("pollOnce");
        throw new Error("poll exploded");
      },
    });

    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.body, { ok: false, error: "Worker execution failed" });
    assert.deepEqual(store.events, ["acquireLock", "isInitialized", "pollOnce", "release"]);
    assert.equal(store.releaseCount, 1);
  });
});
