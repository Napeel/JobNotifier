import { randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";
import type { LockRelease, State, StateStore } from "./state.ts";
import { normalizeState } from "./state.ts";

export const REDIS_STATE_KEY = "jobnotifier:state";
export const REDIS_POLL_LOCK_KEY = "jobnotifier:poll-lock";
export const REDIS_LOCK_KEY = REDIS_POLL_LOCK_KEY;
export const DEFAULT_LOCK_TTL_SECONDS = 120;

export interface RedisSetOptions {
  nx?: true;
  ex?: number;
}

export interface RedisStateClient {
  get<TData = unknown>(key: string): Promise<TData | null>;
  set<TData>(key: string, value: TData, options?: RedisSetOptions): Promise<"OK" | TData | null>;
  del(key: string): Promise<number>;
}

export class RedisStateStore implements StateStore {
  static fromEnv(): RedisStateStore {
    return new RedisStateStore(Redis.fromEnv());
  }

  constructor(
    private readonly redis: RedisStateClient = Redis.fromEnv(),
    private readonly stateKey = REDIS_STATE_KEY,
  ) {}

  async load(): Promise<State> {
    const state = await this.redis.get<unknown>(this.stateKey);
    return normalizeState(state);
  }

  async save(state: State): Promise<void> {
    await this.redis.set(this.stateKey, normalizeState(state));
  }

  async isInitialized(): Promise<boolean> {
    return (await this.redis.get<unknown>(this.stateKey)) !== null;
  }

  async acquireLock(
    key: string = REDIS_POLL_LOCK_KEY,
    ttlSeconds: number = DEFAULT_LOCK_TTL_SECONDS,
  ): Promise<LockRelease | null> {
    const token = randomUUID();
    const result = await this.redis.set(key, token, { nx: true, ex: ttlSeconds });

    if (result !== "OK") {
      return null;
    }

    return {
      release: async () => {
        const currentToken = await this.redis.get<string>(key);
        if (currentToken === token) {
          await this.redis.del(key);
        }
      },
    };
  }
}
