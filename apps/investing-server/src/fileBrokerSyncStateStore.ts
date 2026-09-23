import type {
  BrokerAccountSnapshot,
  BrokerDataSnapshot,
  BrokerSyncOperationStore,
  BrokerSyncProgressRecord,
  BrokerSyncState,
  ScheduledBroker,
} from "@lavega/adapters";
import { createJsonFileStore, runtimeDataFile } from "./jsonFileStore.js";

/** Where the broker data itself lives, since this file keeps no holdings. */
export type BrokerDataFile = {
  read(): Promise<BrokerDataSnapshot>;
  write(snapshot: BrokerDataSnapshot): Promise<void>;
};

type StoredOperation = {
  state: BrokerSyncState;
  lease?: { id: string; heartbeatAt: string } | null;
  progress?: BrokerSyncProgressRecord | null;
};
type StoredOperations = Partial<Record<ScheduledBroker, StoredOperation>>;

const EMPTY: BrokerSyncState = { lastSyncedAt: null, retryAfter: null };

/* Timestamps are compared as instants, not as text: ISO strings only sort
 * correctly while every one of them has four digits of year and the same zone. */
const expired = (heartbeatAt: string, staleBefore: string) =>
  Date.parse(heartbeatAt) < Date.parse(staleBefore);

export function runtimeBrokerSyncStateFile(): string {
  return runtimeDataFile("LAVEGA_BROKER_SYNC_STATE_FILE", "broker-sync-state.json");
}

function isState(value: unknown): value is BrokerSyncState {
  if (!value || typeof value !== "object") return false;
  if (!("lastSyncedAt" in value)) return false;
  const state = value as Partial<BrokerSyncState>;
  const optionalString = (item: unknown) =>
    item === undefined || item === null || typeof item === "string";
  return optionalString(state.lastSyncedAt) && optionalString(state.retryAfter);
}

/** Reads both the current shape and the plain state a previous release wrote. */
function readOperation(value: unknown): StoredOperation | null {
  if (isState(value)) return { state: value };
  if (!value || typeof value !== "object") return null;
  const stored = value as Partial<StoredOperation>;
  return isState(stored.state) ? (stored as StoredOperation) : null;
}

/**
 * Broker synchronization as one durable operation for the Node runtime.
 *
 * The lease outlives the process, so a restart mid-sync does not leave the
 * broker claimed forever and a second runtime started against the same data
 * directory waits instead of spending the same rate limit. The cursor and the
 * broker data are written together, which is why this store owns the file the
 * holdings are read from rather than letting the caller write it afterwards.
 */
export function createFileBrokerSyncStateStore(
  filePath = runtimeBrokerSyncStateFile(),
  data?: BrokerDataFile,
): BrokerSyncOperationStore & { reset(broker: ScheduledBroker): Promise<void> } {
  // A corrupt state file must not block a sync; the worst case is one extra run.
  const store = createJsonFileStore<StoredOperations>(filePath, {
    empty: {},
    validate: (contents) => {
      try {
        const parsed: unknown = JSON.parse(contents);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
        const entries = Object.entries(parsed)
          .map(([broker, value]) => [broker, readOperation(value)] as const)
          .filter(([, operation]) => operation !== null);
        return Object.fromEntries(entries) as StoredOperations;
      } catch {
        return {};
      }
    },
  });
  const held = async (broker: ScheduledBroker, leaseId: string) =>
    (await store.read())[broker]?.lease?.id === leaseId;

  return {
    async reset(broker) {
      await store.update((operations) => {
        const next = { ...operations };
        delete next[broker];
        return next;
      });
    },
    async get(broker) {
      return (await store.read())[broker]?.state ?? EMPTY;
    },
    async claim(broker, input) {
      let claimed = false;
      let state = EMPTY;
      await store.update((operations) => {
        const current = operations[broker];
        state = current?.state ?? EMPTY;
        const lease = current?.lease ?? null;
        claimed = lease == null || expired(lease.heartbeatAt, input.staleBefore);
        if (!claimed) return operations;
        return {
          ...operations,
          [broker]: {
            state,
            lease: {
              id: input.leaseId,
              heartbeatAt: input.progress.updatedAt ?? new Date().toISOString(),
            },
            progress: input.progress,
          },
        };
      });
      const stored = data ? (await data.read())[broker] : undefined;
      return { claimed, state, data: stored ?? null, credentialGeneration: 1 };
    },
    async publish(broker, leaseId, progress) {
      if (!(await held(broker, leaseId))) return false;
      await store.update((operations) => ({
        ...operations,
        [broker]: {
          ...operations[broker]!,
          lease: { id: leaseId, heartbeatAt: progress.updatedAt ?? new Date().toISOString() },
          progress,
        },
      }));
      return true;
    },
    async progress(broker) {
      return (await store.read())[broker]?.progress ?? null;
    },
    async commit(broker, input) {
      if (!(await held(broker, input.leaseId))) return false;
      /* The data goes first: a cursor that moved past data nobody stored would
       * make the next run skip what was lost. */
      if (data && input.data) {
        const snapshot = await data.read();
        await data.write({ ...snapshot, [broker]: input.data as BrokerAccountSnapshot });
      }
      await store.update((operations) => ({
        ...operations,
        [broker]: { state: input.state, lease: null, progress: input.progress },
      }));
      return true;
    },
    async release(broker, leaseId, progress) {
      if (!(await held(broker, leaseId))) return;
      await store.update((operations) => ({
        ...operations,
        [broker]: { ...operations[broker]!, lease: null, progress },
      }));
    },
  };
}
