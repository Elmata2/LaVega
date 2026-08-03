import { NL_SAVINGS_RATES, RATES_AS_OF, type RateBenchmark } from "@lavega/core";

/* Rates provider: fetches the public NL savings-rate benchmark from a URL we
 * control (the Hono /api/rates endpoint), validates it, caches the last good
 * result locally, and falls back gracefully. Only PUBLIC/generic rate data is
 * fetched — no user data is ever sent. I/O lives here (adapters), so the pure
 * core stays testable; the fetch/cache are injectable for the same reason. */

export type RatesPayload = { asOf: string; rates: RateBenchmark[] };
export type RatesSource = "live" | "cache" | "bundled";
export type RatesResult = { rates: RateBenchmark[]; asOf: string; source: RatesSource };

/** Validate an untrusted /api/rates response into a RatesPayload, or throw. */
export function parseRatesPayload(data: unknown): RatesPayload {
  if (!data || typeof data !== "object") throw new Error("rates: geen object");
  const d = data as Record<string, unknown>;
  if (typeof d.asOf !== "string" || !Array.isArray(d.rates)) throw new Error("rates: asOf/rates ontbreekt");
  const rates: RateBenchmark[] = d.rates.map((raw, i) => {
    const r = raw as Record<string, unknown>;
    if (
      !r || typeof r.bank !== "string" || typeof r.product !== "string" ||
      typeof r.ratePct !== "number" || !Number.isFinite(r.ratePct) || typeof r.freeWithdrawal !== "boolean"
    ) {
      throw new Error(`rates: ongeldige regel ${i}`);
    }
    return { bank: r.bank, product: r.product, ratePct: r.ratePct, freeWithdrawal: r.freeWithdrawal };
  });
  if (rates.length === 0) throw new Error("rates: lege lijst");
  return { asOf: d.asOf, rates };
}

export interface RatesCache {
  get(): (RatesPayload & { ts: number }) | null;
  set(v: RatesPayload & { ts: number }): void;
}

/** Default cache in localStorage — public, non-sensitive data, so it lives
 *  outside the encrypted vault (and works without the vault being unlocked).
 *  No-ops safely where localStorage is absent (SSR/tests). The `.v2` suffix
 *  versions the key: bumping it abandons any older cached payload (so a stale
 *  snapshot from a previous rates schema is never shown again). */
export function localStorageRatesCache(key = "lavega.rates.v2"): RatesCache {
  return {
    get() {
      try {
        if (typeof localStorage === "undefined") return null;
        const raw = localStorage.getItem(key);
        return raw ? (JSON.parse(raw) as RatesPayload & { ts: number }) : null;
      } catch {
        return null;
      }
    },
    set(v) {
      try {
        if (typeof localStorage !== "undefined") localStorage.setItem(key, JSON.stringify(v));
      } catch {
        /* quota/serialization errors are non-fatal for a cache */
      }
    },
  };
}

export type RatesProviderOptions = {
  url?: string;
  fetchFn?: typeof fetch;
  cache?: RatesCache;
  timeoutMs?: number;
  /** Max age a cached result is trusted as an offline fallback (default 12h).
   *  Beyond it, the (current) bundled snapshot is preferred over stale cache. */
  cacheTtlMs?: number;
  now?: () => number;
};

export type RatesProvider = { getRates(): Promise<RatesResult> };

/** Create a rates provider. Resolution order on getRates(): live fetch → a
 *  still-fresh cached live result (offline) → bundled offline snapshot. Never
 *  throws. Live always wins, so a reload picks up refreshed server rates. */
export function createRatesProvider(opts: RatesProviderOptions = {}): RatesProvider {
  const { url } = opts;
  const fetchFn = opts.fetchFn ?? (typeof fetch !== "undefined" ? fetch.bind(globalThis) : undefined);
  const cache = opts.cache ?? localStorageRatesCache();
  const timeoutMs = opts.timeoutMs ?? 6000;
  const cacheTtlMs = opts.cacheTtlMs ?? 12 * 60 * 60 * 1000;
  const now = opts.now ?? (() => Date.now());
  const bundled: RatesResult = { rates: [...NL_SAVINGS_RATES], asOf: RATES_AS_OF, source: "bundled" };

  async function fetchLive(): Promise<RatesPayload | null> {
    if (!url || !fetchFn) return null;
    try {
      const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
      const res = await fetchFn(url, ctrl ? { signal: ctrl.signal } : undefined);
      if (timer) clearTimeout(timer);
      if (!res.ok) return null;
      return parseRatesPayload(await res.json());
    } catch {
      return null; // offline / CORS / bad payload → fall back
    }
  }

  return {
    async getRates(): Promise<RatesResult> {
      const live = await fetchLive();
      if (live) {
        cache.set({ ...live, ts: now() });
        return { rates: live.rates, asOf: live.asOf, source: "live" };
      }
      const cached = cache.get();
      if (cached && now() - cached.ts < cacheTtlMs) {
        return { rates: cached.rates, asOf: cached.asOf, source: "cache" };
      }
      return bundled; // no cache, or cache too stale → current bundled snapshot
    },
  };
}
