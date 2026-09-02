import type { PriceBar } from "@lavega/core";

/** Storage seam for daily market-data bars. Deliberately separate from CRUD storage.
 *  Tenancy is an argument on every operation, never a field on a bar, so no caller
 *  can write into a tenant it does not name. */
export interface PriceStore {
  /** Omitting a bound means no bound. There is no date that stands for "all time". */
  getRange(tenantId: string, symbol: string, from?: string, to?: string): Promise<PriceBar[]>;
  lastDate(tenantId: string, symbol: string): Promise<string | null>;
  upsert(tenantId: string, bars: readonly PriceBar[]): Promise<void>;
  purgeAll(): Promise<void>;
}
