import type {
  PriceKey,
  SharedPriceBar,
  SharedPriceCoverage,
  SharedPriceStore,
} from "./PriceStore.js";

/** One stored bar on disk / in IndexedDB: the series key beside the bar. */
export type SharedBarRow = SharedPriceBar & { instrumentKey: string };

/** One stored coverage row: the series key, the coverage, and the write time
 *  that `latestChange` reports for stored-dashboard validity. */
export type SharedCoverageRow = SharedPriceCoverage & {
  instrumentKey: string;
  updatedAt: string;
};

export type SerializedSharedPrices = {
  version: 2;
  bars: SharedBarRow[];
  coverage: SharedCoverageRow[];
};

export const emptySharedPrices = (): SerializedSharedPrices => ({
  version: 2,
  bars: [],
  coverage: [],
});

/** An in-memory `SharedPriceStore` plus the snapshot/hydrate pair that the file
 *  and IndexedDB stores persist. All four adapters share this one behaviour, so
 *  the contract suite tests one implementation of the rules.
 *
 *  `now` is injectable so a test can prove claim expiry and timestamp ordering
 *  without sleeping; production callers omit it. */
export function createMemorySharedBackend(now: () => number = () => Date.now()): {
  store: SharedPriceStore;
  snapshot: () => SerializedSharedPrices;
  hydrate: (state: SerializedSharedPrices) => void;
} {
  /** instrumentKey -> date -> bar */
  let bars = new Map<string, Map<string, SharedPriceBar>>();
  let coverage = new Map<string, SharedCoverageRow>();
  const claims = new Map<string, { owner: string; until: number }>();
  const isoNow = () => new Date(now()).toISOString();

  const barsOf = (key: string): SharedPriceBar[] =>
    [...(bars.get(key)?.values() ?? [])].sort((left, right) => left.date.localeCompare(right.date));
  const hasAnyRows = (key: string): boolean => (bars.get(key)?.size ?? 0) > 0 || coverage.has(key);

  /** The key a read must use: the requested key when it has any rows at all,
   *  else its alias. A key with any rows is read alone. */
  const resolve = (key: PriceKey): string => {
    if (hasAnyRows(key.key)) return key.key;
    return key.alias !== undefined && hasAnyRows(key.alias) ? key.alias : key.key;
  };

  /** Every bar write refreshes the coverage row's `updated_at` when it exists. */
  const touchCoverage = (key: string, at: string) => {
    const row = coverage.get(key);
    if (row) coverage.set(key, { ...row, updatedAt: at });
  };

  const putBars = (key: string, incoming: readonly SharedPriceBar[]) => {
    if (incoming.length === 0) return;
    let byDate = bars.get(key);
    if (!byDate) {
      byDate = new Map();
      bars.set(key, byDate);
    }
    for (const bar of incoming) byDate.set(bar.date, bar);
    touchCoverage(key, isoNow());
  };

  const store: SharedPriceStore = {
    async getRange(key, from, to) {
      return barsOf(resolve(key)).filter(
        (bar) => (from === undefined || bar.date >= from) && (to === undefined || bar.date <= to),
      );
    },
    async getRanges(keys) {
      const out = new Map<string, SharedPriceBar[]>();
      for (const key of keys) out.set(key.key, await store.getRange(key));
      return out;
    },
    async lastDate(key) {
      return barsOf(resolve(key)).at(-1)?.date ?? null;
    },
    async upsert(instrumentKey, incoming) {
      putBars(instrumentKey, incoming);
    },
    async replaceRange(instrumentKey, incoming, from, to) {
      const byDate = bars.get(instrumentKey);
      if (byDate)
        for (const date of byDate.keys())
          if ((from === undefined || date >= from) && (to === undefined || date <= to))
            byDate.delete(date);
      putBars(instrumentKey, incoming);
      touchCoverage(instrumentKey, isoNow());
    },
    async getCoverage(key) {
      const row = coverage.get(resolve(key));
      if (!row) return null;
      const { instrumentKey: _key, updatedAt: _updatedAt, ...rest } = row;
      return rest;
    },
    async putCoverage(instrumentKey, incoming) {
      coverage.set(instrumentKey, {
        ...incoming,
        instrumentKey,
        updatedAt: isoNow(),
      });
    },
    async latestChange(instrumentKeys) {
      let newest: string | null = null;
      for (const key of instrumentKeys) {
        const row = coverage.get(key);
        if (row && (newest === null || row.updatedAt > newest)) newest = row.updatedAt;
      }
      return newest;
    },
    async adoptAlias(key, alias) {
      const aliasBars = bars.get(alias);
      const aliasCoverage = coverage.get(alias);
      if ((aliasBars?.size ?? 0) === 0 && aliasCoverage === undefined) return;
      if (aliasBars) {
        let target = bars.get(key);
        if (!target) {
          target = new Map();
          bars.set(key, target);
        }
        for (const [date, bar] of aliasBars) if (!target.has(date)) target.set(date, bar);
        bars.delete(alias);
      }
      if (aliasCoverage) {
        const current = coverage.get(key);
        if (!current) {
          coverage.set(key, { ...aliasCoverage, instrumentKey: key, updatedAt: isoNow() });
          coverage.delete(alias);
        } else {
          coverage.set(key, {
            ...current,
            from: current.from < aliasCoverage.from ? current.from : aliasCoverage.from,
            to: current.to > aliasCoverage.to ? current.to : aliasCoverage.to,
            updatedAt: isoNow(),
          });
          coverage.delete(alias);
        }
      }
      touchCoverage(key, isoNow());
    },
    async claim(key, owner, ttlMs) {
      const at = now();
      const held = claims.get(key);
      // The spec's SQL refuses ANY live claim, including one this owner took:
      // the price run claims once per slice and never re-enters its own key.
      if (held && held.until >= at) return false;
      claims.set(key, { owner, until: at + ttlMs });
      return true;
    },
    async release(key, owner) {
      const held = claims.get(key);
      if (held?.owner === owner) claims.delete(key);
    },
  };

  return {
    store,
    snapshot: () => ({
      version: 2,
      bars: [...bars].flatMap(([instrumentKey, byDate]) =>
        [...byDate.values()].map((bar) => ({ ...bar, instrumentKey })),
      ),
      coverage: [...coverage.values()],
    }),
    hydrate: (state) => {
      bars = new Map();
      coverage = new Map();
      for (const row of state.bars) {
        const { instrumentKey, ...bar } = row;
        let byDate = bars.get(instrumentKey);
        if (!byDate) {
          byDate = new Map();
          bars.set(instrumentKey, byDate);
        }
        byDate.set(bar.date, bar);
      }
      for (const row of state.coverage) coverage.set(row.instrumentKey, row);
    },
  };
}

/** A `SharedPriceStore` in memory, for tests and the browser build's fake. */
export function createInMemorySharedPriceStore(now?: () => number): SharedPriceStore {
  return createMemorySharedBackend(now).store;
}
