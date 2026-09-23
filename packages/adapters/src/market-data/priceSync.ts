import type { PriceStore } from "../prices/PriceStore.js";
import type { Provider } from "./providerRouter.js";
import { firstProviderResult, hasProblems } from "./providerRouter.js";
import type { PriceProviderResult, YahooPriceRequest } from "./yahoo/priceProvider.js";

export type PriceSyncInput = Omit<YahooPriceRequest, "from" | "to"> & {
  today?: string;
  backfillFrom?: string;
};
export type PriceSyncResult = {
  bars: Awaited<ReturnType<PriceStore["getRange"]>>;
  problems: string[];
  fetched: boolean;
};

export async function syncPrices(input: {
  store: PriceStore;
  tenantId: string;
  priceProviders: readonly Provider<YahooPriceRequest, PriceProviderResult>[];
  request: PriceSyncInput;
}): Promise<PriceSyncResult> {
  const today = input.request.today ?? new Date().toISOString().slice(0, 10);
  const cachedBars = await input.store.getRange(
    input.tenantId,
    input.request.symbol,
    input.request.backfillFrom,
    today,
  );
  const lastDate = cachedBars.at(-1)?.date ?? null;
  const staleFrom = firstStaleDate(cachedBars, input.request.currency);
  const from = staleFrom ?? (lastDate ? nextDate(lastDate) : input.request.backfillFrom);
  /* Only a path that upserted needs to read the range again. Every other
   * return has written nothing since the read above, so re-reading costs a
   * store round trip per symbol and returns what is already in hand. */
  const cached = () =>
    input.store.getRange(input.tenantId, input.request.symbol, input.request.backfillFrom, today);
  if (from && from > today) return { bars: cachedBars, problems: [], fetched: false };
  const fetchFrom = (start: string | undefined) =>
    firstProviderResult(
      input.priceProviders,
      { ...input.request, from: start, to: today },
      undefined,
      hasProblems,
    );
  let result = await fetchFrom(from);
  /* Closes come split-adjusted, so a split inside a top-up leaves every
   * cached close before it in the old share units. Re-read the whole range. */
  const splitInTopUp =
    from !== input.request.backfillFrom &&
    cachedBars.some((bar) => from === undefined || bar.date < from) &&
    result?.value.bars.some((bar) => (bar.split ?? 1) !== 1);
  if (splitInTopUp) result = await fetchFrom(input.request.backfillFrom);
  if (!result)
    return { bars: cachedBars, problems: ["No price provider returned data"], fetched: true };
  if (result.value.problems.length || result.value.bars.length === 0)
    return {
      bars: cachedBars,
      problems: result.value.problems.length
        ? result.value.problems
        : ["Price provider returned no bars"],
      fetched: true,
    };
  await input.store.upsert(input.tenantId, result.value.bars);
  return { bars: await cached(), problems: [], fetched: true };
}

function nextDate(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

/** A cached bar is stale when it names another currency or was stored before
 *  splits were recorded; the sync re-reads from the first one. */
function firstStaleDate(
  bars: Awaited<ReturnType<PriceStore["getRange"]>>,
  expectedCurrency: string,
): string | null {
  return (
    bars.find((bar) => bar.currency !== expectedCurrency || bar.split === undefined)?.date ?? null
  );
}
