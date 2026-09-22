import type { FrankfurterFxProvider } from "@lavega/adapters";
import type { FxRateRepository } from "@lavega/database";
import type { FxRate } from "@lavega/core";

const nextDay = (date: string) =>
  new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/**
 * Historical rates read from storage, fetched only where storage has none.
 *
 * A published rate never changes, so the years a dashboard converts at are
 * fetched once. Frankfurter starts a range at the last published day on or
 * before its first day, and storage reads the same way, so a stored range
 * whose first rate is on or before `from` covers the start. After that only the
 * days past the last stored rate are fetched. Storage is a cache: when it
 * fails, the provider answers as it did before storage existed.
 */
export function createStoredFxProvider(
  store: FxRateRepository,
  provider: FrankfurterFxProvider,
): FrankfurterFxProvider {
  return {
    ...provider,
    async getHistoricalRates(from, to) {
      const stored = await store.range("EUR", from, to).catch(() => null);
      if (!stored) return provider.getHistoricalRates(from, to);
      const first = stored[0]?.date;
      const last = stored.at(-1)?.date;
      const coversStart = first !== undefined && first <= from;
      if (coversStart && last! >= to) return { rates: stored, problems: [] };

      const fetched = await provider.getHistoricalRates(coversStart ? nextDay(last!) : from, to);
      await store.put(fetched.rates).catch(() => undefined);
      const byDate = new Map<string, FxRate>(stored.map((rate) => [rate.date, rate]));
      for (const rate of fetched.rates) byDate.set(rate.date, rate);
      return {
        rates: [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date)),
        problems: fetched.problems,
      };
    },
  };
}
