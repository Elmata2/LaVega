import { createBrokerDataCache } from "@lavega/adapters";
import type { RuntimeBrokerDataSnapshot } from "./runtimeBrokerData.js";

type BrokerDataCache = ReturnType<typeof createBrokerDataCache>;

/** One tenant's committed snapshot and its in-process mirror. */
export function createBrokerSnapshotReader(input: {
  cache: BrokerDataCache;
  load: () => Promise<RuntimeBrokerDataSnapshot>;
  hosted: boolean;
  isSyncing: () => boolean;
  ttlMs: number;
}) {
  let readAt = Date.now();
  let refresh: Promise<void> | null = null;

  const restore = (snapshot: RuntimeBrokerDataSnapshot) => {
    input.cache.restore(snapshot);
    readAt = Date.now();
  };

  const read = async (policy: "cached" | "fresh") => {
    if (!input.hosted) return input.cache.read();
    if (input.isSyncing()) {
      if (policy === "fresh") throw new Error("Broker data sync is still running");
      return input.cache.read();
    }
    if (refresh) await refresh;
    else if (Date.now() - readAt >= input.ttlMs) {
      const version = input.cache.read().dataVersion;
      const pending = (async () => {
        const snapshot = await input.load();
        if (input.cache.read().dataVersion === version && !input.isSyncing()) restore(snapshot);
      })();
      refresh = pending;
      try {
        await pending;
      } finally {
        if (refresh === pending) refresh = null;
      }
    }
    if (policy === "fresh" && input.isSyncing())
      throw new Error("Broker data sync is still running");
    return input.cache.read();
  };

  return {
    read,
    restore,
    markCurrent: () => {
      readAt = Date.now();
    },
  };
}
