import { isPriceFresh, type PriceBar } from "@lavega/core";
import type { PriceCoverage, PriceProvenance, PriceStore } from "../prices/PriceStore.js";
import type { Provider } from "./providerRouter.js";
import { firstProviderResult, hasProblems } from "./providerRouter.js";
import type { PriceProviderResult, YahooPriceRequest } from "./yahoo/priceProvider.js";

export type PriceSyncInput = Omit<YahooPriceRequest, "from" | "to"> & {
  today?: string;
  backfillFrom?: string;
  /** Gates the delisted short-circuit; see `PriceCoverage.delistedSince`. */
  kind?: "current" | "closed" | "benchmark";
};
export type PriceSyncResult = {
  bars: PriceBar[];
  problems: string[];
  fetched: boolean;
};

/** An omitted `from` leaves the window to the provider's default history. */
type Window = { from: string | undefined; to: string };

/** One provider answer. Only an answer with bars proves a provenance.
 *  `notFound` carries through `PriceProviderResult.notFound`. */
type Answer =
  | { ok: true; bars: PriceBar[]; provenance: PriceProvenance | null }
  | { ok: false; problems: string[]; notFound?: boolean };

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
  const lastBarDate = cachedBars.at(-1)?.date;

  /* Already confirmed dead: nothing future can change that answer. */
  if (coverage?.delistedSince && request.kind === "closed")
    return { bars: cachedBars, problems: [], fetched: false };

  const ask = async (window: Window, listing?: string, currency?: string): Promise<Answer> => {
    const result = await firstProviderResult(
      input.priceProviders,
      { ...request, ...window, listing, ...(currency !== undefined ? { currency } : {}) },
      undefined,
      hasProblems,
    );
    if (!result) return { ok: false, problems: ["No price provider returned data"] };
    if (result.value.problems.length)
      return { ok: false, problems: result.value.problems, notFound: result.value.notFound };
    const last = result.value.bars.at(-1);
    return {
      ok: true,
      bars: result.value.bars,
      provenance: last ? { listing: result.value.listing ?? null, currency: last.currency } : null,
    };
  };
  const read = () => store.getRange(tenantId, request.symbol, wanted.from, today);
  const isClosedNotFound = (answer: Answer | null): boolean =>
    answer?.ok === false && answer.notFound === true && request.kind === "closed";
  const recordDelisted = async (): Promise<PriceSyncResult> => {
    await store.putCoverage(tenantId, {
      symbol: request.symbol,
      from: coverage?.from ?? wanted.from ?? today,
      to: coverage?.to ?? today,
      listing: coverage?.listing ?? null,
      currency: coverage?.currency ?? request.currency,
      delistedSince: today,
      listingMissingSince: undefined,
    });
    return { bars: cachedBars, problems: [], fetched: true };
  };

  /* Replaces the window's bars and coverage rather than widening them: nothing
   * cached before is trusted to match what the provider quotes now. */
  const refresh = async (from: string | undefined): Promise<PriceSyncResult> => {
    const answer = await ask({ from, to: today });
    if (!answer.ok)
      return isClosedNotFound(answer)
        ? recordDelisted()
        : { bars: cachedBars, problems: answer.problems, fetched: true };
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

  /* A known listing is fetched directly, skipping the ISIN search and ticker
   * guesses a caller with no locked listing pays on every sync (issue #101).
   * Re-derive only when that listing turns out dead or, for a held symbol,
   * stops quoting anything for longer than a quiet day explains.
   *
   * A held symbol's dead listing is not replaced on one 404: a transient
   * Yahoo failure would otherwise lock onto whatever the re-resolution probe
   * happens to return. `listingMissingSince` (already set from a prior sync)
   * is what makes a 404 confirmed rather than a first occurrence; a closed
   * position, already exiting through `recordDelisted` below, does not need
   * this second opinion. */
  const listingConfirmedMissing = coverage.listingMissingSince != null;
  let reResolvedListing = false;
  const resolveWindow = async (window: Window): Promise<Answer> => {
    const locked = coverage.listing ?? undefined;
    const first = await ask(window, locked);
    if (!locked) return first;
    const dead =
      !first.ok &&
      first.notFound === true &&
      (request.kind !== "current" || listingConfirmedMissing);
    const stale =
      first.ok &&
      first.bars.length === 0 &&
      request.kind === "current" &&
      lastBarDate !== undefined &&
      !isPriceFresh(lastBarDate, today);
    if (!dead && !stale) return first;
    // Prefer the currency this symbol is already recorded in: a swap the
    // broker's own stated currency would not predict is still the likeliest
    // continuation of the same history, not evidence to distrust it.
    const reResolved = await ask(window, undefined, coverage.currency);
    if (!reResolved.ok || reResolved.bars.length === 0) return first;
    reResolvedListing = true;
    return reResolved;
  };

  const before = prefix && (await resolveWindow(prefix));
  const after = suffix && (await resolveWindow(suffix));
  if (isClosedNotFound(before) || isClosedNotFound(after)) return recordDelisted();
  /* A held listing quoting nothing for a while is not a holiday: unlike a
   * closed position, it is still owed forward price data. Give it the same
   * missed-days grace `isPriceFresh` already gives a stale value elsewhere,
   * then stop treating silence as a covered, unremarkable gap. */
  const afterIsStaleQuiet =
    after?.ok === true &&
    after.bars.length === 0 &&
    request.kind === "current" &&
    lastBarDate !== undefined &&
    !isPriceFresh(lastBarDate, today);
  const answered = [before, afterIsStaleQuiet ? null : after].filter(
    (answer) => answer?.ok === true,
  );
  const provenances = answered.flatMap((answer) => answer.provenance ?? []);
  const splitAfterCache = after?.ok && after.bars.some((bar) => (bar.split ?? 1) !== 1);
  const currencySwapped = provenances.some((provenance) => currencyChanged(coverage, provenance));
  const listingSwapped = provenances.some((provenance) => listingChanged(coverage, provenance));
  /* A currency swap is never merged, confirmed by re-resolution or not: bars
   * in two currencies cannot share one coverage row. A listing swap
   * `resolveWindow` itself just confirmed is not the unrequested surprise
   * this otherwise exists to catch, so only that case is spared the refetch
   * that would undo the request saving this function makes. */
  if (splitAfterCache || currencySwapped || (listingSwapped && !reResolvedListing))
    return refresh(refreshFrom);

  const problems = [before, after].flatMap((answer) =>
    answer?.ok === false ? answer.problems : [],
  );
  if (afterIsStaleQuiet) problems.push(`no prices since ${lastBarDate}`);

  const notFoundNow = (answer: Answer | null): boolean =>
    answer?.ok === false && answer.notFound === true;
  const succeededNow = (answer: Answer | null): boolean =>
    answer?.ok === true && answer.bars.length > 0;
  const nextListingMissingSince =
    succeededNow(before) || succeededNow(after)
      ? undefined
      : notFoundNow(before) || notFoundNow(after)
        ? (coverage.listingMissingSince ?? today)
        : coverage.listingMissingSince;

  if (answered.length === 0) {
    if (nextListingMissingSince !== coverage.listingMissingSince)
      await store.putCoverage(tenantId, {
        ...coverage,
        listingMissingSince: nextListingMissingSince,
      });
    return { bars: cachedBars, problems, fetched: true };
  }
  const bars = answered.flatMap((answer) => answer.bars);
  if (bars.length) await store.upsert(tenantId, bars);
  await store.putCoverage(tenantId, {
    ...coverage,
    listing: provenances.at(-1)?.listing ?? coverage.listing,
    from: prefix && before?.ok ? prefix.from : coverage.from,
    to:
      after?.ok && !afterIsStaleQuiet
        ? (after.bars.at(-1)?.date ?? suffix?.to ?? coverage.to)
        : coverage.to,
    delistedSince: bars.length > 0 ? undefined : coverage.delistedSince,
    listingMissingSince: nextListingMissingSince,
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

function currencyChanged(cached: PriceProvenance, quoted: PriceProvenance): boolean {
  return cached.currency !== quoted.currency;
}

function listingChanged(cached: PriceProvenance, quoted: PriceProvenance): boolean {
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
