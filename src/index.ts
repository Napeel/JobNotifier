import { fileURLToPath } from "node:url";
import cron from "node-cron";
import { seedState as defaultSeedState, pollOnce as defaultPollOnce } from "./notifier.ts";
import type { NotifierLogger } from "./notifier.ts";
import { FileStateStore } from "./state.ts";
import type { StateStore } from "./state.ts";

export interface LocalCliDependencies {
  argv?: string[];
  env?: Record<string, string | undefined>;
  stateStore?: StateStore;
  schedule?: typeof cron.schedule;
  seedState?: typeof defaultSeedState;
  pollOnce?: typeof defaultPollOnce;
  logger?: NotifierLogger;
}

function parseIntervalMinutes(value: string | undefined): number {
  const parsed = parseInt(value ?? "15", 10);
  return Number.isNaN(parsed) || parsed <= 0 ? 15 : parsed;
}

export async function runLocalCli(dependencies: LocalCliDependencies = {}): Promise<void> {
  const argv = dependencies.argv ?? process.argv;
  const env = dependencies.env ?? process.env;
  const stateStore = dependencies.stateStore ?? new FileStateStore();
  const schedule = dependencies.schedule ?? cron.schedule;
  const seed = dependencies.seedState ?? defaultSeedState;
  const poll = dependencies.pollOnce ?? defaultPollOnce;
  const logger = dependencies.logger ?? console;

  if (argv.includes("--seed")) {
    await seed({ stateStore, logger });
    return;
  }

  const intervalMinutes = parseIntervalMinutes(env.POLL_INTERVAL_MINUTES);
  logger.log(`Internship Job Notifier starting. Polling every ${intervalMinutes} minutes.`);

  if (!(await stateStore.isInitialized())) {
    logger.log("No state.json found — seeding state on first run...");
    await seed({ stateStore, logger });
  } else {
    await poll({ stateStore, webhookUrl: env.DISCORD_WEBHOOK_URL, logger });
  }

  schedule(`*/${intervalMinutes} * * * *`, () => {
    void poll({ stateStore, webhookUrl: env.DISCORD_WEBHOOK_URL, logger });
  });
}

const isMain = process.argv[1] ? fileURLToPath(import.meta.url) === process.argv[1] : false;

if (isMain) {
  await runLocalCli();
}
