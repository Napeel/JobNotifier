import { pollOnce as defaultPollOnce, seedState as defaultSeedState } from "./notifier.ts";
import type { NotifierLogger, NotifierResult } from "./notifier.ts";
import { DEFAULT_LOCK_TTL_SECONDS, REDIS_POLL_LOCK_KEY, RedisStateStore } from "./redis-state.ts";
import type { StateStore } from "./state.ts";

type HeaderValue = string | string[] | undefined;

export interface ServerlessRequest {
  method?: string;
  headers: Record<string, HeaderValue>;
}

export interface ServerlessResponse {
  status(statusCode: number): ServerlessResponse;
  json(body: WorkerResponseBody): void;
}

export interface WorkerResponseBody {
  ok: boolean;
  status?: NotifierResult["status"];
  error?: string;
  missing?: string[];
  repoCount?: number;
  newPostingCount?: number;
  errors?: string[];
}

export interface HandleWorkerRequestOptions {
  request: ServerlessRequest;
  response: ServerlessResponse;
  env?: Record<string, string | undefined>;
  createStateStore?: () => StateStore | Promise<StateStore>;
  seedState?: typeof defaultSeedState;
  pollOnce?: typeof defaultPollOnce;
  logger?: NotifierLogger;
}

const REQUIRED_REDIS_ENV_KEYS = ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"];

function firstHeader(value: HeaderValue): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function send(response: ServerlessResponse, statusCode: number, body: WorkerResponseBody): void {
  response.status(statusCode).json(body);
}

function resultBody(ok: boolean, result: NotifierResult): WorkerResponseBody {
  return {
    ok,
    status: result.status,
    repoCount: result.repoCount,
    newPostingCount: result.newPostingCount,
    errors: result.errors,
  };
}

function missingRedisEnvKeys(env: Record<string, string | undefined>): string[] {
  return REQUIRED_REDIS_ENV_KEYS.filter((key) => !env[key]);
}

export async function handleWorkerRequest(options: HandleWorkerRequestOptions): Promise<void> {
  const { request, response, logger = console } = options;
  const env = options.env ?? process.env;
  const seedState = options.seedState ?? defaultSeedState;
  const pollOnce = options.pollOnce ?? defaultPollOnce;

  if (request.method !== "GET") {
    send(response, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  const cronSecret = env.CRON_SECRET;
  if (!cronSecret) {
    send(response, 500, { ok: false, error: "CRON_SECRET not configured" });
    return;
  }

  const authorization = firstHeader(request.headers.authorization);
  if (!authorization) {
    send(response, 401, { ok: false });
    return;
  }

  if (authorization !== `Bearer ${cronSecret}`) {
    send(response, 403, { ok: false });
    return;
  }

  const createStateStore = options.createStateStore ?? (() => RedisStateStore.fromEnv());

  if (!options.createStateStore) {
    const missing = missingRedisEnvKeys(env);
    if (missing.length > 0) {
      send(response, 500, { ok: false, error: "Redis configuration missing", missing });
      return;
    }
  }

  let stateStore: StateStore;
  try {
    stateStore = await createStateStore();
  } catch {
    send(response, 500, { ok: false, error: "State store configuration failed" });
    return;
  }

  const lock = await stateStore.acquireLock(REDIS_POLL_LOCK_KEY, DEFAULT_LOCK_TTL_SECONDS);
  if (!lock) {
    send(response, 200, { ok: true, status: "skipped" });
    return;
  }

  let statusCode = 200;
  let body: WorkerResponseBody;

  try {
    if (!(await stateStore.isInitialized())) {
      const result = await seedState({ stateStore, logger });
      statusCode = result.status === "error" ? 500 : 200;
      body = resultBody(result.status !== "error", result);
    } else {
      const result = await pollOnce({ stateStore, webhookUrl: env.DISCORD_WEBHOOK_URL, logger });
      statusCode = result.status === "error" ? 500 : 200;
      body = resultBody(result.status !== "error", result);
    }
  } catch {
    statusCode = 500;
    body = { ok: false, error: "Worker execution failed" };
  } finally {
    await lock.release();
  }

  send(response, statusCode, body);
}
