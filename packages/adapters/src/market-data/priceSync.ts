import type { PriceStore } from "../prices/PriceStore.js";
import type { MarketDataRouter } from "./providerRouter.js";
import type { PriceProviderResult, YahooPriceRequest } from "./yahoo/priceProvider.js";

export type PriceSyncInput = Omit<YahooPriceRequest, "from" | "to"> & { today?: string; backfillFrom?: string };
export type PriceSyncResult = { bars: Awaited<ReturnType<PriceStore["getRange"]>>; problems: string[]; fetched: boolean };

export async function syncPrices(input: { store: PriceStore; tenantId: string; router: MarketDataRouter<YahooPriceRequest, PriceProviderResult, unknown, unknown, unknown, unknown>; request: PriceSyncInput }): Promise<PriceSyncResult> {
  const today = input.request.today ?? new Date().toISOString().slice(0, 10);
  const lastDate = await input.store.lastDate(input.tenantId, input.request.symbol);
  const from = lastDate ? nextDate(lastDate) : input.request.backfillFrom;
  const cached = () => input.store.getRange(input.tenantId, input.request.symbol, input.request.backfillFrom ?? "0000-01-01", today);
  if (from && from > today) return { bars: await cached(), problems: [], fetched: false };
  const result = await input.router.getPrice({ ...input.request, from, to: today });
  if (!result) return { bars: await cached(), problems: ["No price provider returned data"], fetched: true };
  if (result.value.problems.length || result.value.bars.length === 0) return { bars: await cached(), problems: result.value.problems.length ? result.value.problems : ["Price provider returned no bars"], fetched: true };
  await input.store.upsert(result.value.bars);
  return { bars: await cached(), problems: [], fetched: true };
}

function nextDate(date: string): string { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() + 1); return value.toISOString().slice(0, 10); }
