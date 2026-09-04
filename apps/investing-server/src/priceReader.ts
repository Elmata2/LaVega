import type { PriceStore } from "@lavega/adapters";
import type { PriceBar } from "@lavega/core";

/** Bounded fan-out over the one price seam. Neon pool max is 5, so the
 *  reader stays under it and the dashboard route keeps its rows. */
export async function readPriceBars(
  priceStore: PriceStore,
  tenantId: string,
  symbols: readonly string[],
  concurrency = 3,
): Promise<{ bars: PriceBar[]; failed: number }> {
  const bars: PriceBar[] = [];
  let failed = 0;
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, symbols.length) }, async () => {
      while (next < symbols.length) {
        const symbol = symbols[next++];
        if (!symbol) return;
        try {
          bars.push(...(await priceStore.getRange(tenantId, symbol)));
        } catch {
          failed += 1;
        }
      }
    }),
  );
  return { bars, failed };
}
