import {
  clampToListingStart,
  isPriceFresh,
  provisionalRefetchFrom,
  providerAffinity,
  type PriceBar,
} from "@lavega/core";
import type {
  PriceKey,
  PriceProvenance,
  SharedPriceBar,
  SharedPriceCoverage,
  SharedPriceStore,
} from "../prices/PriceStore.js";
import type { Provider } from "./providerRouter.js";
import { firstProviderResult, hasProblems } from "./providerRouter.js";
import type { PriceProviderResult, YahooPriceRequest } from "./yahoo/priceProvider.js";

export type PriceSyncInput = Omit<YahooPriceRequest, "from" | "to"> & {
  today?: string;
  backfillFrom?: string;
  /** Gates the delisted short-circuit; see `SharedPriceCoverage.delistedSince`. */
  kind?: "current" | "closed" | "benchmark";
};
export type PriceSyncResult = {
  bars: PriceBar[];
  problems: string[];
  fetched: boolean;
  /** Another run holds this key's claim: no provider request was made and the
   *  key belongs on the run's remaining list so the next slice reads the rows
   *  that run is about to write (issue #307). */
  pending?: boolean;
};

/** How long one run may hold an instrument key before another may take it. */
export const PRICE_KEY_CLAIM_TTL_MS = 120_000;

/** An omitted `from` leaves the window to the provider's default history. */
type Window = { from: string | undefined; to: string };

/** One provider answer. Only an answer with bars proves a provenance.
 *  `notFound` carries through `PriceProviderResult.notFound`. */
type Answer =
  | {
      ok: true;
      bars: PriceBar[];
      provenance: PriceProvenance | null;
      /** The provider that answered, so coverage remembers its affinity. */
      provider: string;
      provisionalThrough?: string;
    }
  | { ok: false; problems: string[]; notFound?: boolean };

/** How long a locked listing must have been unconfirmed before a fresh
 *  not-found answer counts as confirmed rather than possibly transient. */
const LISTING_MISSING_CONFIRMATION_MS = 24 * 60 * 60 * 1000;

/** The sentinels a shared coverage row uses when history was converted from an
 *  older store that recorded no provider (issue #307). They are "not known", not
 *  a provider choice, so provider affinity must not lock onto them. */
const NOT_A_PROVIDER = new Set(["legacy", "unknown"]);
const knownProvider = (provider: string | undefined): string | undefined =>
  provider !== undefined && provider !== "" && !NOT_A_PROVIDER.has(provider) ? provider : undefined;

/**
 * Brings one instrument's shared series to cover `backfillFrom` through `today`.
 *
 * The series is stored once for the whole installation under `key` (issue
 * #307); no tenant is involved. A read falls back to the `sym:` key an earlier
 * release stored when the `isin:` key is empty, and the first write for an
 * `isin:` key adopts those rows into it, so a symbol upgraded from symbol to
 * ISIN identity does not refetch its history.
 *
 * Before touching a key the run takes that key's claim: two users syncing the
 * same instrument must not both pay for its backfill. A refused claim returns
 * `pending` without a provider request; the rows the other run is writing are
 * read by the next slice.
 *
 * Coverage records the window the provider has answered, so the sync asks only
 * for the prefix and suffix outside it, and a closed-market day inside it is
 * never asked for again. Cached history is thrown out only when the provider
 * proves it stale: another listing, another currency, or a split after it.
 * The broker's currency is not evidence; a listing may quote in another one.
 */
export async function syncPrices(input: {
  store: SharedPriceStore;
  /** The instrument key this series is stored under. */
  key: string;
  /** The `sym:` key earlier releases stored this series under, when `key` is
   *  an `isin:` form. Adopted into `key` before the first write. */
  alias?: string;
  /** Owner of the per-key claim: the price run's lease id. */
  owner: string;
  priceProviders: readonly Provider<YahooPriceRequest, PriceProviderResult>[];
  request: PriceSyncInput;
  /** Injectable for tests; the wall clock a `listingMissingSince` confirmation
   *  gap is measured against, independent of `request.today`'s calendar date. */
  now?: () => Date;
  claimTtlMs?: number;
  /** False when the run could not resolve the instrument's identity (for
   *  instance OpenFIGI was rate-limited). A not-found answer then says nothing
   *  final about the listing: record no delisting, report the problems, and let
   *  the next run ask again. Default true. */
  allowDelist?: boolean;
}): Promise<PriceSyncResult> {
  const { store, key, request, owner } = input;
  const nowMs = (input.now ?? (() => new Date()))().getTime();
  const today = request.today ?? new Date(nowMs).toISOString().slice(0, 10);
  const symbol = request.symbol;

  const claimed = await store.claim(key, owner, input.claimTtlMs ?? PRICE_KEY_CLAIM_TTL_MS);
  if (!claimed) return { bars: [], problems: [], fetched: false, pending: true };

  const result = await run();
  /* Released only after the write path finished; a throw leaves the claim to
   * expire, which is the retry the next run needs. */
  await store.release(key, owner);
  return result;

  async function run(): Promise<PriceSyncResult> {
    /** The read address: this key, with the alias only while this key is empty. */
    const address: PriceKey = input.alias === undefined ? { key } : { key, alias: input.alias };
    /** Bars leave the store with the symbol this caller asked for; the series
     *  itself is the key, so a stored row has no symbol (issue #307). */
    const withSymbol = (bars: readonly SharedPriceBar[]): PriceBar[] =>
      bars.map((bar) => ({ ...bar, symbol }));
    const withoutSymbol = (bars: readonly PriceBar[]): SharedPriceBar[] =>
      bars.map(({ symbol: _symbol, ...bar }) => bar);

    let aliasAdopted = false;
    /* Adopt before the first write: from then on this key owns the rows, so a
     * read that still resolves to the alias also keeps working. */
    const adoptAliasOnce = async () => {
      if (aliasAdopted) return;
      aliasAdopted = true;
      if (input.alias !== undefined && key.startsWith("isin:"))
        await store.adoptAlias(key, input.alias);
    };

    const [storedBars, storedCoverage] = await Promise.all([
      store.getRange(address, request.backfillFrom, today),
      store.getCoverage(address),
    ]);
    const coverage = storedCoverage ?? coverageOf(storedBars);
    /* A backfill never asks for history the listing did not have (WS4.5). */
    const wanted: Window = {
      from: clampToListingStart(request.backfillFrom, coverage?.listingStart),
      to: today,
    };
    const cachedBars =
      wanted.from === request.backfillFrom
        ? storedBars
        : await store.getRange(address, wanted.from, today);
    const lastBarDate = cachedBars.at(-1)?.date;

    /* Already confirmed dead: nothing future can change that answer. */
    if (coverage?.delistedSince && request.kind === "closed")
      return { bars: withSymbol(cachedBars), problems: [], fetched: false };

    /* Provider affinity (WS4.5): the security's assigned provider is the only one
     * allowed to answer. When it is unavailable the symbol is skipped with a
     * reason instead of being handed to a different provider. */
    const assignedProvider = knownProvider(coverage?.provider);
    const affinity = providerAffinity(
      assignedProvider,
      input.priceProviders.map((provider) => provider.sourceKey),
    );
    if (affinity.skip)
      return { bars: withSymbol(cachedBars), problems: [affinity.reason], fetched: false };
    const priceProviders = assignedProvider
      ? input.priceProviders.filter((provider) => provider.sourceKey === assignedProvider)
      : input.priceProviders;

    const ask = async (window: Window, listing?: string, currency?: string): Promise<Answer> => {
      const result = await firstProviderResult(
        priceProviders,
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
        provenance: last
          ? { listing: result.value.listing ?? null, currency: last.currency }
          : null,
        provider: result.sourceKey,
        ...(result.value.provisionalThrough
          ? { provisionalThrough: result.value.provisionalThrough }
          : {}),
      };
    };
    const read = async () => withSymbol(await store.getRange(address, wanted.from, today));
    const isClosedNotFound = (answer: Answer | null): boolean =>
      answer?.ok === false && answer.notFound === true && request.kind === "closed";
    const recordDelisted = async (): Promise<PriceSyncResult> => {
      await adoptAliasOnce();
      await store.putCoverage(key, {
        from: coverage?.from ?? wanted.from ?? today,
        to: coverage?.to ?? today,
        listing: coverage?.listing ?? null,
        currency: coverage?.currency ?? request.currency,
        delistedSince: today,
        listingMissingSince: undefined,
        ...(coverage?.provider ? { provider: coverage.provider } : { provider: "unknown" }),
        ...(coverage?.listingStart ? { listingStart: coverage.listingStart } : {}),
        provisionalThrough: undefined,
      });
      return { bars: withSymbol(cachedBars), problems: [], fetched: true };
    };

    /* A closed series is only retired when the run could name its identity. An
     * unresolved resolution (rate limit, provider outage) makes "not found"
     * inconclusive, so it stays a retryable problem and is written nowhere. */
    const delistOrReport = async (problems: string[]): Promise<PriceSyncResult> =>
      input.allowDelist === false
        ? { bars: withSymbol(cachedBars), problems, fetched: true }
        : recordDelisted();

    /* Replaces the window's bars and coverage rather than widening them: nothing
     * cached before is trusted to match what the provider quotes now. */
    const refresh = async (from: string | undefined): Promise<PriceSyncResult> => {
      const answer = await ask({ from, to: today });
      if (!answer.ok)
        return isClosedNotFound(answer)
          ? delistOrReport(answer.problems)
          : { bars: withSymbol(cachedBars), problems: answer.problems, fetched: true };
      const first = answer.bars[0];
      if (!first || !answer.provenance)
        return {
          bars: withSymbol(cachedBars),
          problems: ["Price provider returned no bars"],
          fetched: true,
        };
      await adoptAliasOnce();
      await store.replaceRange(key, withoutSymbol(answer.bars), from, today);
      await store.putCoverage(key, {
        from: from ?? first.date,
        to: answer.bars.at(-1)!.date,
        ...answer.provenance,
        provider: answer.provider,
        listingStart: from ?? first.date,
        ...(answer.provisionalThrough ? { provisionalThrough: answer.provisionalThrough } : {}),
      });
      return { bars: await read(), problems: [], fetched: true };
    };

    /* A provisional close is re-fetched until its window closes (WS4.5). The
     * window is re-read and replaced, so a close the provider has finalised stops
     * being provisional instead of being served as if it never changed. */
    const provisionalFrom = provisionalRefetchFrom(coverage?.provisionalThrough, today);
    if (coverage && provisionalFrom) {
      const answer = await ask(
        { from: provisionalFrom, to: today },
        coverage.listing ?? undefined,
        coverage.currency,
      );
      if (answer.ok && answer.provenance) {
        await adoptAliasOnce();
        await store.replaceRange(key, withoutSymbol(answer.bars), provisionalFrom, today);
        const last = answer.bars.at(-1);
        await store.putCoverage(key, {
          ...coverage,
          listing: answer.provenance.listing ?? coverage.listing,
          to: last && last.date > coverage.to ? last.date : coverage.to,
          provider: answer.provider,
          provisionalThrough: answer.provisionalThrough,
        });
        return { bars: await read(), problems: [], fetched: true };
      }
      // A failed provisional refetch falls through to the normal sync, which
      // reports the provider's own problem.
    }

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
    if (!prefix && !suffix) return { bars: withSymbol(cachedBars), problems: [], fetched: false };

    /* A known listing is fetched directly, skipping the ISIN search and ticker
     * guesses a caller with no locked listing pays on every sync (issue #101).
     * Re-derive only when that listing turns out dead or, for a held symbol,
     * stops quoting anything for longer than a quiet day explains.
     *
     * A held symbol's dead listing is not replaced on one 404: a transient
     * Yahoo failure, or two syncs seconds apart from repeat page loads, would
     * otherwise lock onto whatever the re-resolution probe happens to return.
     * `listingMissingSince` set at least `LISTING_MISSING_CONFIRMATION_MS`
     * earlier is what makes a 404 confirmed rather than a first occurrence or
     * too recent to mean anything; a closed position, already exiting through
     * `recordDelisted` below, does not need this second opinion. */
    const listingConfirmedMissing =
      coverage.listingMissingSince != null &&
      nowMs - Date.parse(coverage.listingMissingSince) >= LISTING_MISSING_CONFIRMATION_MS;
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
    const closedNotFound = [before, after].find(
      (answer): answer is Extract<Answer, { ok: false }> => isClosedNotFound(answer),
    );
    if (closedNotFound) return delistOrReport(closedNotFound.problems);
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
          ? (coverage.listingMissingSince ?? new Date(nowMs).toISOString())
          : coverage.listingMissingSince;

    if (answered.length === 0) {
      if (nextListingMissingSince !== coverage.listingMissingSince) {
        await adoptAliasOnce();
        await store.putCoverage(key, {
          ...coverage,
          listingMissingSince: nextListingMissingSince,
        });
      }
      return { bars: withSymbol(cachedBars), problems, fetched: true };
    }
    const bars = answered.flatMap((answer) => answer.bars);
    if (bars.length) {
      await adoptAliasOnce();
      await store.upsert(key, withoutSymbol(bars));
    }
    const answeredProviders = answered
      .map((answer) => (answer?.ok ? answer.provider : undefined))
      .filter((provider): provider is string => provider !== undefined);
    const answeredProvisional = answered
      .map((answer) => (answer?.ok ? answer.provisionalThrough : undefined))
      .filter((value): value is string => value !== undefined)
      .at(-1);
    await adoptAliasOnce();
    await store.putCoverage(key, {
      ...coverage,
      listing: provenances.at(-1)?.listing ?? coverage.listing,
      from: prefix && before?.ok ? prefix.from : coverage.from,
      to:
        after?.ok && !afterIsStaleQuiet
          ? (after.bars.at(-1)?.date ?? suffix?.to ?? coverage.to)
          : coverage.to,
      provider: answeredProviders.at(-1) ?? coverage.provider,
      listingStart: coverage.listingStart ?? (prefix && before?.ok ? prefix.from : undefined),
      ...(answeredProvisional !== undefined ? { provisionalThrough: answeredProvisional } : {}),
      delistedSince: bars.length > 0 ? undefined : coverage.delistedSince,
      listingMissingSince: nextListingMissingSince,
    });
    return { bars: bars.length ? await read() : withSymbol(cachedBars), problems, fetched: true };
  }
}

/** Caches written before coverage was recorded: trust the bars they hold. */
function coverageOf(bars: readonly SharedPriceBar[]): SharedPriceCoverage | null {
  const first = bars[0];
  const last = bars.at(-1);
  if (!first || !last) return null;
  return {
    from: first.date,
    to: last.date,
    listing: null,
    currency: first.currency,
    provider: "unknown",
  };
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
