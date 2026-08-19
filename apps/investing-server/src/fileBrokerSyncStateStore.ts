import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BrokerSyncState, BrokerSyncStateStore, ScheduledBroker } from "@lavega/adapters";

type StoredStates = Partial<Record<ScheduledBroker, BrokerSyncState>>;

const EMPTY: BrokerSyncState = { lastSyncedAt: null, retryAfter: null };

export function runtimeBrokerSyncStateFile(): string {
  const fromEnv = process.env.LAVEGA_BROKER_SYNC_STATE_FILE?.trim();
  if (fromEnv) return fromEnv;
  return existsSync("/data") ? "/data/broker-sync-state.json" : join(process.cwd(), ".lavega", "broker-sync-state.json");
}

function isState(value: unknown): value is BrokerSyncState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<BrokerSyncState>;
  const optionalString = (item: unknown) => item === undefined || item === null || typeof item === "string";
  return optionalString(state.lastSyncedAt) && optionalString(state.retryAfter);
}

async function readStates(filePath: string): Promise<StoredStates> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, state]) => isState(state))) as StoredStates;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return {};
    // A corrupt state file must not block a sync; the worst case is one extra run.
    return {};
  }
}

/**
 * Persistent broker sync state for the Node runtime. The in-memory store loses
 * `lastSyncedAt` and any rate-limit cooldown on every container restart, which
 * turns each restart into a fresh full sync against the broker.
 */
export function createFileBrokerSyncStateStore(filePath = runtimeBrokerSyncStateFile()): BrokerSyncStateStore {
  let writeQueue = Promise.resolve();

  return {
    async get(broker) {
      return (await readStates(filePath))[broker] ?? EMPTY;
    },
    async put(broker, state) {
      const write = writeQueue.then(async () => {
        const states = await readStates(filePath);
        states[broker] = state;
        await mkdir(dirname(filePath), { recursive: true });
        const temporaryPath = `${filePath}.tmp`;
        await writeFile(temporaryPath, JSON.stringify(states), "utf8");
        await rename(temporaryPath, filePath);
      });
      writeQueue = write.then(() => undefined, () => undefined);
      await write;
    },
  };
}
