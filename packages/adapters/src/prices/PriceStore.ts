import type { PriceBar } from "@lavega/core";

/** Storage seam for daily market-data bars. Deliberately separate from CRUD storage.
 *  Tenancy is part of the interface so every adapter enforces the same isolation rule. */
export interface PriceStore {
  getRange(tenantId: string, symbol: string, from: string, to: string): Promise<PriceBar[]>;
  lastDate(tenantId: string, symbol: string): Promise<string | null>;
  upsert(bars: PriceBar[]): Promise<void>;
  purgeAll(): Promise<void>;
}
