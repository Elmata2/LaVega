import type { InvestingDashboardData } from "@lavega/core";

export type DashboardCache = {
  get(input: { tenantId: string; key: string }): InvestingDashboardData | null;
  set(input: { tenantId: string; key: string }, data: InvestingDashboardData): void;
  load(
    input: { tenantId: string; key: string },
    loader: () => Promise<InvestingDashboardData>,
  ): Promise<InvestingDashboardData>;
  invalidate(tenantId?: string): void;
};

const DASHBOARD_CACHE_TTL_MS = 15_000;
const MAX_ENTRIES = 100;

export function createDashboardCache(input: { now?: () => number } = {}): DashboardCache {
  const entries = new Map<string, { data: InvestingDashboardData; storedAt: number }>();
  const inFlight = new Map<string, Promise<InvestingDashboardData>>();
  const tenantGenerations = new Map<string, number>();
  let generation = 0;
  const now = input.now ?? Date.now;
  const id = ({ tenantId, key }: { tenantId: string; key: string }) => `${tenantId}\u0000${key}`;
  return {
    get(input) {
      const cacheId = id(input);
      const entry = entries.get(cacheId);
      if (!entry || now() - entry.storedAt >= DASHBOARD_CACHE_TTL_MS) {
        entries.delete(cacheId);
        return null;
      }
      return entry.data;
    },
    set(input, data) {
      const cacheId = id(input);
      entries.delete(cacheId);
      if (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value!);
      entries.set(cacheId, { data, storedAt: now() });
    },
    async load(input, loader) {
      const cached = this.get(input);
      if (cached) return cached;
      const cacheId = id(input);
      const pending = inFlight.get(cacheId);
      if (pending) return pending;
      const startedGeneration = generation;
      const startedTenantGeneration = tenantGenerations.get(input.tenantId) ?? 0;
      const run = loader().then((data) => {
        if (
          generation === startedGeneration &&
          (tenantGenerations.get(input.tenantId) ?? 0) === startedTenantGeneration
        )
          this.set(input, data);
        return data;
      });
      inFlight.set(cacheId, run);
      try {
        return await run;
      } finally {
        if (inFlight.get(cacheId) === run) inFlight.delete(cacheId);
      }
    },
    invalidate(tenantId) {
      if (!tenantId) {
        generation += 1;
        entries.clear();
        inFlight.clear();
        return;
      }
      tenantGenerations.set(tenantId, (tenantGenerations.get(tenantId) ?? 0) + 1);
      const prefix = `${tenantId}\u0000`;
      for (const cacheId of entries.keys()) if (cacheId.startsWith(prefix)) entries.delete(cacheId);
      for (const cacheId of inFlight.keys())
        if (cacheId.startsWith(prefix)) inFlight.delete(cacheId);
    },
  };
}
