import type { PriceBar } from "@lavega/core";

/** Which listing a provider quoted and in what currency. Null listing: the
 *  provider did not say, so no listing change can be proven against it. */
export type PriceProvenance = { listing: string | null; currency: string };

/** The dates a provider has answered for one symbol, bars or not. A date
 *  inside with no bar is a day the market was closed, not a gap to fetch.
 *
 *  `delistedSince` marks a closed position whose listing Yahoo confirmed
 *  gone (every candidate 404s): a known end state for a position that will
 *  never trade again, not a problem to keep retrying.
 *
 *  `listingMissingSince` (an ISO timestamp, not a date) marks a held
 *  position's locked listing as unconfirmed after a not-found answer, so a
 *  single transient 404 cannot swap it out; only a not-found answer at
 *  least 24 hours later, with this already set, counts as confirmed.
 *  Cleared the next time the listing answers. */
export type PriceCoverage = PriceProvenance & {
  symbol: string;
  from: string;
  to: string;
  delistedSince?: string;
  listingMissingSince?: string;
  /** The provider sourceKey that earned this coverage (WS4.5, #297). Once set,
   *  only that provider may answer: an unavailable provider is skipped, never
   *  replaced by a different one that happens to quote the symbol. */
  provider?: string;
  /** The first date the provider priced this listing. A backfill is clamped to
   *  it, so an IPO-era trade does not refetch years of nothing every sync. */
  listingStart?: string;
  /** The newest close that is still provisional and must be re-fetched until
   *  its window closes. Absent when every stored close is final. */
  provisionalThrough?: string;
};

/** A stored bar of a shared series. The series is identified by its instrument
 *  key, so the row carries no `symbol`: the reader substitutes its own symbol
 *  through the key -> symbols map, exactly as a provider request did. */
export type SharedPriceBar = Omit<PriceBar, "symbol">;

/** A read address for the shared store: the instrument key, plus the `sym:`
 *  alias to fall back to when the key itself has no rows yet (issue #307). The
 *  alias is the only fallback and it is resolved inside the store. */
export type PriceKey = { key: string; alias?: string };

/** Coverage of one shared series. The series is identified by its instrument
 *  key, so it does not carry a `symbol`; `provider` is required because a
 *  shared row must say where it came from. */
export type SharedPriceCoverage = Omit<PriceCoverage, "symbol" | "provider"> & {
  provider: string;
};

/**
 * The shared, instrument-keyed price store (issue #307). One series per
 * instrument for the whole installation: public reference data belongs to no
 * user, so no operation takes a tenant. Read operations take a `PriceKey` so a
 * freshly computed `isin:` key can fall back to the `sym:` rows an earlier
 * release stored; write operations take the plain key.
 */
export interface SharedPriceStore {
  /** Omitting a bound means no bound. There is no date that stands for "all time". */
  getRange(key: PriceKey, from?: string, to?: string): Promise<SharedPriceBar[]>;
  /** Bars grouped by the requested key (not by the alias that answered). */
  getRanges(keys: readonly PriceKey[]): Promise<Map<string, SharedPriceBar[]>>;
  lastDate(key: PriceKey): Promise<string | null>;
  upsert(instrumentKey: string, bars: readonly SharedPriceBar[]): Promise<void>;
  /** Makes `bars` the series' whole history from `from` to `to`: a stored bar
   *  in that window that `bars` lacks is deleted. Omitting a bound means none. */
  replaceRange(
    instrumentKey: string,
    bars: readonly SharedPriceBar[],
    from?: string,
    to?: string,
  ): Promise<void>;
  getCoverage(key: PriceKey): Promise<SharedPriceCoverage | null>;
  putCoverage(instrumentKey: string, coverage: SharedPriceCoverage): Promise<void>;
  /** Latest `updated_at` over the given keys, for stored-dashboard validity.
   *  Null for an empty list and for keys without a coverage row. */
  latestChange(instrumentKeys: readonly string[]): Promise<string | null>;
  /** Moves all rows of `alias` to `key`; same-date rows under `key` win.
   *  Coverage moves when `key` has none, else widens to the union and keeps
   *  `key`'s listing/currency/provider. The alias coverage row is deleted.
   *  No-op when the alias has no rows. */
  adoptAlias(key: string, alias: string): Promise<void>;
  /** True when `owner` may fetch the key now. Atomic; a live claim held by
   *  another owner refuses. */
  claim(key: string, owner: string, ttlMs: number): Promise<boolean>;
  /** Deletes the claim only when `owner` holds it. */
  release(key: string, owner: string): Promise<void>;
}
