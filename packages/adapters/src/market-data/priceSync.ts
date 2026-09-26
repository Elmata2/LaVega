import type { PriceBar } from "@lavega/core";
import type { PriceCoverage, PriceProvenance, PriceStore } from "../prices/PriceStore.js";
import type { Provider } from "./providerRouter.js";
import { firstProviderResult, hasProblems } from "./providerRouter.js";
import type { PriceProviderResult, YahooPriceRequest } from "./yahoo/priceProvider.js";

export type PriceSyncInput = Omit<YahooPriceRequest, "from" | "to"> & {
  today?: string;
  backfillFrom?: string;
};
export type PriceSyncResult = {
  bars: PriceBar[];
  problems: string[];
  fetched: boolean;
};

/** An omitted `from` leaves the window to the provider's default history. */
type Window = { from: string | undefined; to: string };

/** One provider answer. Only an answer with bars proves a provenance. */
type Answer =
  | { ok: true; bars: PriceBar[]; provenance: PriceProvenance | null }
  | { ok: false; problems: string[] };

/**
 * Brings one symbol's cache to cover `backfillFrom` through `today`.
 *
 * Coverage records the window the provider has answered, so the sync asks only
 * for the prefix and suffix outside it, and a closed-market day inside it is
 * never asked for again. Cached history is thrown out only when the provider
 * proves it stale: another listing, another currency, or a split after it.
 * The broker's currency is not evidence; a listing may quote in another one.
 */
export async function syncPrices(input: {
  store: PriceStore;
  tenantId: string;
  priceProviders: readonly Provider<YahooPriceRequest, PriceProviderResult>[];
  request: PriceSyncInput;
}): Promise<PriceSyncResult> {
  const { store, tenantId, request } = input;
  const today = request.today ?? new Date().toISOString().slice(0, 10);
  const wanted: Window = { from: request.backfillFrom, to: today };
  const [cachedBars, storedCoverage] = await Promise.all([
    store.getRange(tenantId, request.symbol, wanted.from, today),
    store.getCoverage(tenantId, request.symbol),
  ]);
  const coverage = storedCoverage ?? coverageOf(request.symbol, cachedBars);

  const ask = async (window: Window): Promise<Answer> => {
    const result = await firstProviderResult(
      input.priceProviders,
      { ...request, ...window },
      undefined,
      hasProblems,
    );
    if (!result) return { ok: false, problems: ["No price provider returned data"] };
    if (result.value.problems.length) return { ok: false, problems: result.value.problems };
    const last = result.value.bars.at(-1);
    return {
      ok: true,
      bars: result.value.bars,
      provenance: last ? { listing: result.value.listing ?? null, currency: last.currency } : null,
    };
  };
  const read = () => store.getRange(tenantId, request.symbol, wanted.from, today);

  /* Replaces the window's bars and coverage rather than widening them: nothing
   * cached before is trusted to match what the provider quotes now. */
  const refresh = async (from: string | undefined): Promise<PriceSyncResult> => {
    const answer = await ask({ from, to: today });
    if (!answer.ok) return { bars: cachedBars, problems: answer.problems, fetched: true };
    const first = answer.bars[0];
    if (!first || !answer.provenance)
      return { bars: cachedBars, problems: ["Price provider returned no bars"], fetched: true };
    await store.replaceRange(tenantId, request.symbol, answer.bars, from, today);
    await store.putCoverage(tenantId, {
      symbol: request.symbol,
      from: from ?? first.date,
      to: answer.bars.at(-1)!.date,
      ...answer.provenance,
    });
    return { bars: await read(), problems: [], fetched: true };
  };

  if (!coverage) return refresh(wanted.from);
  const refreshFrom = earlier(wanted.from, coverage.from);
  if (cachedBars.some((bar) => bar.split === undefined || bar.currency !== coverage.currency))
    return refresh(refreshFrom);

  const prefix: { from: string; to: string } | null =
    wanted.from !== undefined && wanted.from < coverage.from
      ? { from: wanted.from, to: shiftDate(coverage.from, -1) }
      : null;
  const suffix: Window | null =
    coverage.to < today ? { from: shiftDate(coverage.to, 1), to: today } : null;
  if (!prefix && !suffix) return { bars: cachedBars, problems: [], fetched: false };

  const before = prefix && (await ask(prefix));
  const after = suffix && (await ask(suffix));
  const answered = [before, after].filter((answer) => answer?.ok === true);
  const provenances = answered.flatMap((answer) => answer.provenance ?? []);
  const splitAfterCache = after?.ok && after.bars.some((bar) => (bar.split ?? 1) !== 1);
  if (splitAfterCache || provenances.some((provenance) => changed(coverage, provenance)))
    return refresh(refreshFrom);

  const problems = [before, after].flatMap((answer) =>
    answer?.ok === false ? answer.problems : [],
  );
  if (after?.ok && after.bars.length === 0) problems.push("Price provider returned no bars");
  if (answered.length === 0) return { bars: cachedBars, problems, fetched: true };
  const bars = answered.flatMap((answer) => answer.bars);
  if (bars.length) await store.upsert(tenantId, bars);
  await store.putCoverage(tenantId, {
    ...coverage,
    listing: provenances.at(-1)?.listing ?? coverage.listing,
    from: prefix && before?.ok ? prefix.from : coverage.from,
    to: after?.ok ? (after.bars.at(-1)?.date ?? coverage.to) : coverage.to,
  });
  return { bars: bars.length ? await read() : cachedBars, problems, fetched: true };
}

/** Caches written before coverage was recorded: trust the bars they hold. */
function coverageOf(symbol: string, bars: readonly PriceBar[]): PriceCoverage | null {
  const first = bars[0];
  const last = bars.at(-1);
  if (!first || !last) return null;
  return { symbol, from: first.date, to: last.date, listing: null, currency: first.currency };
}

function changed(cached: PriceProvenance, quoted: PriceProvenance): boolean {
  if (cached.currency !== quoted.currency) return true;
  return cached.listing !== null && quoted.listing !== null && cached.listing !== quoted.listing;
}

function earlier(left: string | undefined, right: string): string | undefined {
  return left === undefined ? right : left < right ? left : right;
}

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
