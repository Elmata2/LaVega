import type { PriceKey, SharedPriceBar, SharedPriceStore } from "@lavega/adapters";
import type { PriceBar } from "@lavega/core";

/** Bars leave a shared price store without a symbol: the series is the
 *  instrument key (issue #307), and the read model maps it back to the symbol
 *  the caller asked for. */
export function barsBySymbol(bars: readonly SharedPriceBar[], symbol: string): PriceBar[] {
  return bars.map((bar) => ({ ...bar, symbol }));
}

/**
 * The one price read seam for the dashboard. It asks the shared store for the
 * requested keys in one bulk query — Neon's pool max is 5, so a per-symbol
 * fan-out would starve the route — and substitutes each key's own symbol.
 */
export async function readPriceBars(
  priceStore: SharedPriceStore,
  keys: readonly PriceKey[],
  symbolsFor: (key: string) => readonly string[],
): Promise<{ bars: PriceBar[]; failed: number }> {
  if (keys.length === 0) return { bars: [], failed: 0 };
  try {
    const grouped = await priceStore.getRanges(keys);
    const bars: PriceBar[] = [];
    for (const key of keys) {
      const stored = grouped.get(key.key) ?? [];
      for (const symbol of symbolsFor(key.key)) bars.push(...barsBySymbol(stored, symbol));
    }
    return { bars, failed: 0 };
  } catch {
    return { bars: [], failed: keys.length };
  }
}
