import type { PriceBar } from "@lavega/core";

/** Which listing a provider quoted and in what currency. Null listing: the
 *  provider did not say, so no listing change can be proven against it. */
export type PriceProvenance = { listing: string | null; currency: string };

/** The dates a provider has answered for one symbol, bars or not. A date
 *  inside with no bar is a day the market was closed, not a gap to fetch. */
export type PriceCoverage = PriceProvenance & { symbol: string; from: string; to: string };

/** Storage seam for daily market-data bars. Deliberately separate from CRUD storage.
 *  Tenancy is an argument on every operation, never a field on a bar, so no caller
 *  can write into a tenant it does not name. */
export interface PriceStore {
  /** Omitting a bound means no bound. There is no date that stands for "all time". */
  getRange(tenantId: string, symbol: string, from?: string, to?: string): Promise<PriceBar[]>;
  getRanges?(tenantId: string, symbols: readonly string[]): Promise<PriceBar[]>;
  lastDate(tenantId: string, symbol: string): Promise<string | null>;
  upsert(tenantId: string, bars: readonly PriceBar[]): Promise<void>;
  /** Makes `bars` the symbol's whole history from `from` to `to`: a cached bar
   *  in that window that `bars` lacks is deleted. Omitting a bound means no bound. */
  replaceRange(
    tenantId: string,
    symbol: string,
    bars: readonly PriceBar[],
    from?: string,
    to?: string,
  ): Promise<void>;
  /** Null for a symbol never synced, and for caches written before coverage
   *  was recorded; the sync then reads coverage off the bars themselves. */
  getCoverage(tenantId: string, symbol: string): Promise<PriceCoverage | null>;
  putCoverage(tenantId: string, coverage: PriceCoverage): Promise<void>;
  /** Also clears coverage, so an emptied cache is fetched again. */
  purgeAll(): Promise<void>;
}
