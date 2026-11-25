import type { DisposalLabelEntry, DisposalLabelStore } from "@lavega/core";

/** Per-tenant owner-assigned labels and notes for realized disposals.
 *
 *  In-memory is the default for a runtime with no persistence: it answers the
 *  same empty list as a real store with nothing saved yet, and a PUT during one
 *  process is visible until that process ends. Hosted runtimes inject the Neon
 *  store instead. */
export function createInMemoryDisposalLabelStore(
  initial: ReadonlyMap<string, DisposalLabelEntry[]> = new Map(),
): DisposalLabelStore {
  const byTenant = new Map<string, DisposalLabelEntry[]>(
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
