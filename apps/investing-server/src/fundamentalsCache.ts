import type { CompanyFundamentals, FundamentalsProvider } from "@lavega/core";

export const FUNDAMENTALS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;

/** A 24h per-symbol cache in front of any FundamentalsProvider, so it is a
 *  provider itself. Company financials change once a quarter; a day-old
 *  answer is fresh. "No company" is cached like an answer. A failure is not
 *  cached, so the next turn retries. Memory only: on a hosted runtime each
 *  instance warms its own copy. */
export function createCachedFundamentalsProvider(
  provider: FundamentalsProvider,
  input: { now?: () => number } = {},
): FundamentalsProvider {
  const now = input.now ?? Date.now;
  const entries = new Map<string, { value: CompanyFundamentals | null; storedAt: number }>();
  const inFlight = new Map<string, Promise<CompanyFundamentals | null>>();
  return {
    async fetch(symbol) {
      const key = symbol.trim().toUpperCase();
      const entry = entries.get(key);
      if (entry && now() - entry.storedAt < FUNDAMENTALS_CACHE_TTL_MS) return entry.value;
      const pending = inFlight.get(key);
      if (pending) return pending;
      const run = provider.fetch(key).then((value) => {
        entries.delete(key);
        if (entries.size >= MAX_ENTRIES) entries.delete(entries.keys().next().value!);
        entries.set(key, { value, storedAt: now() });
        return value;
      });
      inFlight.set(key, run);
      try {
        return await run;
      } finally {
        inFlight.delete(key);
      }
    },
  };
}
