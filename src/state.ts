import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

export interface State {
  [repoKey: string]: string[];
}

export interface LockRelease {
  release(): Promise<void>;
}

export interface StateStore {
  load(): Promise<State>;
  save(state: State): Promise<void>;
  isInitialized(): Promise<boolean>;
  acquireLock(key: string, ttlSeconds: number): Promise<LockRelease | null>;
}

const DEFAULT_STATE_FILE = new URL("../state.json", import.meta.url).pathname;

export function normalizeState(value: unknown): State {
  if (typeof value === "string") {
    try {
      return normalizeState(JSON.parse(value));
    } catch {
      return {};
    }
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const state: State = {};
  for (const [repoKey, hashes] of Object.entries(value)) {
    if (Array.isArray(hashes) && hashes.every((hash) => typeof hash === "string")) {
      state[repoKey] = hashes;
    }
  }

  return state;
}

export class FileStateStore implements StateStore {
  private static readonly locks = new Map<string, { token: string; timeout: NodeJS.Timeout }>();

  constructor(private readonly filePath: string = DEFAULT_STATE_FILE) {}

  async load(): Promise<State> {
    try {
      const data = await readFile(this.filePath, "utf-8");
      return normalizeState(JSON.parse(data));
    } catch {
      return {};
    }
  }

  async save(state: State): Promise<void> {
    await writeFile(this.filePath, JSON.stringify(normalizeState(state), null, 2));
  }

  async isInitialized(): Promise<boolean> {
    try {
      await readFile(this.filePath);
      return true;
    } catch {
      return false;
    }
  }

  async acquireLock(key: string, ttlSeconds: number): Promise<LockRelease | null> {
    if (FileStateStore.locks.has(key)) {
      return null;
    }

    const token = randomUUID();
    const timeout = setTimeout(() => {
      const lock = FileStateStore.locks.get(key);
      if (lock?.token === token) {
        FileStateStore.locks.delete(key);
      }
    }, ttlSeconds * 1000);

    FileStateStore.locks.set(key, { token, timeout });

    return {
      release: async () => {
        const lock = FileStateStore.locks.get(key);
        if (lock?.token === token) {
          clearTimeout(lock.timeout);
          FileStateStore.locks.delete(key);
        }
      },
    };
  }
}
