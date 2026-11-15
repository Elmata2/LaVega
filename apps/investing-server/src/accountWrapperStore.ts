import type { AccountWrapperEntry, AccountWrapperStore } from "@lavega/core";

/** Per-tenant account tax-treatment labels (plan §3 WS4.4, #296).
 *
 *  In-memory is the default for a runtime with no persistence: it answers the
 *  same empty map as a real store with nothing saved yet, and a PUT during one
 *  process is visible until that process ends. Hosted runtimes inject the Neon
 *  store instead. */
export function createInMemoryAccountWrapperStore(
  initial: ReadonlyMap<string, AccountWrapperEntry[]> = new Map(),
): AccountWrapperStore {
  const byTenant = new Map<string, AccountWrapperEntry[]>(
    [...initial].map(([tenantId, entries]) => [tenantId, entries.map((entry) => ({ ...entry }))]),
  );
  return {
    async get(tenantId) {
      return (byTenant.get(tenantId) ?? []).map((entry) => ({ ...entry }));
    },
    async set(selection) {
      byTenant.set(
        selection.tenantId,
        selection.entries.map((entry) => ({ ...entry })),
      );
    },
  };
}
