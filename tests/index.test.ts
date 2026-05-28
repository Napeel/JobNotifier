import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runLocalCli } from "../src/index.ts";
import type { LocalCliDependencies } from "../src/index.ts";
import type { NotifierLogger } from "../src/notifier.ts";
import type { LockRelease, State, StateStore } from "../src/state.ts";

const silentLogger: NotifierLogger = {
  log: () => {},
  error: () => {},
};

const scheduledTask = {} as ReturnType<NonNullable<LocalCliDependencies["schedule"]>>;

class FakeStateStore implements StateStore {
  constructor(private readonly initialized: boolean) {}

  async load(): Promise<State> {
    return {};
  }

  async save(_state: State): Promise<void> {}

  async isInitialized(): Promise<boolean> {
    return this.initialized;
  }

  async acquireLock(_key: string, _ttlSeconds: number): Promise<LockRelease | null> {
    return { release: async () => {} };
  }
}

describe("runLocalCli", () => {
  it("seeds and exits in --seed mode without scheduling polling", async () => {
    const events: string[] = [];
    const store = new FakeStateStore(false);

    await runLocalCli({
      argv: ["node", "src/index.ts", "--seed"],
      env: { POLL_INTERVAL_MINUTES: "7" },
      stateStore: store,
      seedState: async ({ stateStore }) => {
        assert.equal(stateStore, store);
        events.push("seed");
        return { status: "seeded", repoCount: 2, newPostingCount: 0, errors: [] };
      },
      pollOnce: async () => {
        events.push("poll");
        return { status: "no_changes", repoCount: 2, newPostingCount: 0, errors: [] };
      },
      schedule: () => {
        events.push("schedule");
        return scheduledTask;
      },
      logger: silentLogger,
    });

    assert.deepEqual(events, ["seed"]);
  });

  it("auto-seeds missing local state and polls existing local state before scheduling", async () => {
    const firstRunEvents: string[] = [];
    const firstRunStore = new FakeStateStore(false);

    await runLocalCli({
      argv: ["node", "src/index.ts"],
      env: { POLL_INTERVAL_MINUTES: "7" },
      stateStore: firstRunStore,
      seedState: async ({ stateStore }) => {
        assert.equal(stateStore, firstRunStore);
        firstRunEvents.push("seed");
        return { status: "seeded", repoCount: 2, newPostingCount: 0, errors: [] };
      },
      pollOnce: async () => {
        firstRunEvents.push("poll");
        return { status: "no_changes", repoCount: 2, newPostingCount: 0, errors: [] };
      },
      schedule: (expression, callback) => {
        firstRunEvents.push(`schedule:${expression}`);
        assert.equal(typeof callback, "function");
        return scheduledTask;
      },
      logger: silentLogger,
    });

    assert.deepEqual(firstRunEvents, ["seed", "schedule:*/7 * * * *"]);

    const existingStateEvents: string[] = [];
    const existingStateStore = new FakeStateStore(true);

    await runLocalCli({
      argv: ["node", "src/index.ts"],
      env: { POLL_INTERVAL_MINUTES: "5" },
      stateStore: existingStateStore,
      seedState: async () => {
        existingStateEvents.push("seed");
        return { status: "seeded", repoCount: 2, newPostingCount: 0, errors: [] };
      },
      pollOnce: async () => {
        existingStateEvents.push("poll");
        return { status: "no_changes", repoCount: 2, newPostingCount: 0, errors: [] };
      },
      schedule: (expression) => {
        existingStateEvents.push(`schedule:${expression}`);
        return scheduledTask;
      },
      logger: silentLogger,
    });

    assert.deepEqual(existingStateEvents, ["poll", "schedule:*/5 * * * *"]);
  });
});
