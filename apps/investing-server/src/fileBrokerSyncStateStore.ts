import type { BrokerSyncState, BrokerSyncStateStore, ScheduledBroker } from "@lavega/adapters";
import { createJsonFileStore, runtimeDataFile } from "./jsonFileStore.js";

type StoredStates = Partial<Record<ScheduledBroker, BrokerSyncState>>;

const EMPTY: BrokerSyncState = { lastSyncedAt: null, retryAfter: null };

export function runtimeBrokerSyncStateFile(): string {
  return runtimeDataFile("LAVEGA_BROKER_SYNC_STATE_FILE", "broker-sync-state.json");
}

function isState(value: unknown): value is BrokerSyncState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<BrokerSyncState>;
  const optionalString = (item: unknown) => item === undefined || item === null || typeof item === "string";
  return optionalString(state.lastSyncedAt) && optionalString(state.retryAfter);
}

/**
 * Persistent broker sync state for the Node runtime. The in-memory store loses
 * `lastSyncedAt` and any rate-limit cooldown on every container restart, which
 * turns each restart into a fresh full sync against the broker.
 */
export function createFileBrokerSyncStateStore(filePath = runtimeBrokerSyncStateFile()): BrokerSyncStateStore {
  // A corrupt state file must not block a sync; the worst case is one extra run.
  const store = createJsonFileStore<StoredStates>(filePath, {
    empty: {},
    validate: (contents) => {
      try {
        const parsed: unknown = JSON.parse(contents);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        return Object.fromEntries(Object.entries(parsed).filter(([, state]) => isState(state))) as StoredStates;
      } catch {
        return {};
      }
    },
  });

  return {
    async get(broker) {
      return (await store.read())[broker] ?? EMPTY;
    },
    async put(broker, state) {
      await store.update((states) => ({ ...states, [broker]: state }));
    },
  };
}
