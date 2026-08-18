import type { PriceBar } from "@lavega/core";

/** Storage seam for daily market-data bars. Deliberately separate from CRUD storage. */
export interface PriceStore {
  getRange(symbol: string, from: string, to: string): Promise<PriceBar[]>;
  lastDate(symbol: string): Promise<string | null>;
  upsert(bars: PriceBar[]): Promise<void>;
  purgeAll(): Promise<void>;
}
