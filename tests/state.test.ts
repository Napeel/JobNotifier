import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { REDIS_POLL_LOCK_KEY, REDIS_STATE_KEY, RedisStateStore } from "../src/redis-state.ts";
import type { RedisSetOptions, RedisStateClient } from "../src/redis-state.ts";
import { FileStateStore, normalizeState } from "../src/state.ts";
import type { State } from "../src/state.ts";

class FakeRedis implements RedisStateClient {
  private readonly values = new Map<string, unknown>();
  readonly setOptions = new Map<string, RedisSetOptions | undefined>();

  async get<TData>(key: string): Promise<TData | null> {
    if (!this.values.has(key)) {
      return null;
    }

    return this.values.get(key) as TData;
  }

  async set<TData>(key: string, value: TData, options?: RedisSetOptions): Promise<"OK" | TData | null> {
    if (options?.nx && this.values.has(key)) {
      return null;
    }

    this.values.set(key, value);
    this.setOptions.set(key, options);
    return "OK";
  }

  async del(key: string): Promise<number> {
    const existed = this.values.delete(key);
    return existed ? 1 : 0;
  }

  setRaw(key: string, value: unknown): void {
    this.values.set(key, value);
  }
}

async function withTempStateFile(run: (filePath: string) => Promise<void>): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "jobnotifier-state-"));
  try {
    await run(join(directory, "state.json"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("normalizeState", () => {
  it("returns an empty object for invalid state values", () => {
    assert.deepEqual(normalizeState(null), {});
    assert.deepEqual(normalizeState(["hash"]), {});
    assert.deepEqual(normalizeState("not-state"), {});
  });

  it("preserves only repo keys with string hash arrays", () => {
    assert.deepEqual(
      normalizeState({
        "owner/repo": ["hash-1", "hash-2"],
        "owner/bad-array": ["hash-3", 4],
        "owner/bad-value": "hash-4",
      }),
      { "owner/repo": ["hash-1", "hash-2"] },
    );
  });
});

describe("FileStateStore", () => {
  it("loads missing state as empty and reports uninitialized until save", async () => {
    await withTempStateFile(async (filePath) => {
      const store = new FileStateStore(filePath);

      assert.deepEqual(await store.load(), {});
      assert.equal(await store.isInitialized(), false);

      await store.save({ "owner/repo": ["hash-1"] });

      assert.equal(await store.isInitialized(), true);
      assert.deepEqual(await store.load(), { "owner/repo": ["hash-1"] });
    });
  });

  it("writes pretty JSON state and reads it back", async () => {
    await withTempStateFile(async (filePath) => {
      const store = new FileStateStore(filePath);
      const state: State = { "owner/repo": ["hash-1", "hash-2"] };

      await store.save(state);

      assert.equal(await readFile(filePath, "utf-8"), `${JSON.stringify(state, null, 2)}`);
      assert.deepEqual(await store.load(), state);
    });
  });

  it("normalizes malformed JSON files to empty state", async () => {
    await withTempStateFile(async (filePath) => {
      const store = new FileStateStore(filePath);
      await writeFile(filePath, "{ malformed json", "utf-8");

      assert.deepEqual(await store.load(), {});
      assert.equal(await store.isInitialized(), true);
    });
  });
});

describe("RedisStateStore", () => {
  it("loads and saves state through the configured Redis key", async () => {
    const redis = new FakeRedis();
    const store = new RedisStateStore(redis);

    assert.equal(await store.isInitialized(), false);
    assert.deepEqual(await store.load(), {});

    const state: State = { "owner/repo": ["hash-1"] };
    await store.save(state);

    assert.deepEqual(await redis.get<State>(REDIS_STATE_KEY), state);
    assert.equal(await store.isInitialized(), true);
    assert.deepEqual(await store.load(), state);
  });

  it("normalizes malformed Redis state to empty state", async () => {
    const redis = new FakeRedis();
    const store = new RedisStateStore(redis);

    redis.setRaw(REDIS_STATE_KEY, { "owner/repo": ["hash-1"], invalid: [123] });

    assert.deepEqual(await store.load(), { "owner/repo": ["hash-1"] });
  });

  it("acquires locks with NX and EX options", async () => {
    const redis = new FakeRedis();
    const store = new RedisStateStore(redis);

    const lock = await store.acquireLock(REDIS_POLL_LOCK_KEY, 120);
    const token = await redis.get<string>(REDIS_POLL_LOCK_KEY);

    assert.notEqual(lock, null);
    assert.equal(typeof token, "string");
    assert.deepEqual(redis.setOptions.get(REDIS_POLL_LOCK_KEY), { nx: true, ex: 120 });
  });

  it("returns null when a Redis lock is already held", async () => {
    const redis = new FakeRedis();
    const store = new RedisStateStore(redis);

    const firstLock = await store.acquireLock(REDIS_POLL_LOCK_KEY, 120);
    const secondLock = await store.acquireLock(REDIS_POLL_LOCK_KEY, 120);

    assert.notEqual(firstLock, null);
    assert.equal(secondLock, null);

    await firstLock?.release();
    assert.notEqual(await store.acquireLock(REDIS_POLL_LOCK_KEY, 120), null);
  });

  it("only releases a Redis lock when the stored token still matches", async () => {
    const redis = new FakeRedis();
    const store = new RedisStateStore(redis);

    const lock = await store.acquireLock(REDIS_POLL_LOCK_KEY, 120);
    assert.notEqual(lock, null);

    redis.setRaw(REDIS_POLL_LOCK_KEY, "different-token");
    await lock?.release();

    assert.equal(await redis.get<string>(REDIS_POLL_LOCK_KEY), "different-token");
  });
});
