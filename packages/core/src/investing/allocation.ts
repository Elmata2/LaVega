import { crossRate, type FxRate } from "../fx.js";
import type { Position } from "./model.js";

export type AllocationGroup = "instrument" | "entity";
export type AllocationBucket = {
  key: string;
  label: string;
  value: number | null;
  unpriced: boolean;
};
export type Allocation = {
  buckets: AllocationBucket[];
  unpriced: string[];
};

function rateFor(rates: FxRate | FxRate[], date: string): FxRate {
  const candidates = Array.isArray(rates) ? rates : [rates];
  const rate = candidates
    .filter((candidate) => candidate.date <= date)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!rate) throw new Error(`No FX rate available for ${date}`);
  return rate;
}

function positionValue(position: Position, presentationCurrency: string, fxRates: FxRate | FxRate[]): number | null {
  const value = position.marketValue ?? (position.marketPrice === null ? null : position.quantity * position.marketPrice);
  if (value === null) return null;
  try {
    return value * crossRate(position.currency, presentationCurrency, rateFor(fxRates, position.asOf));
  } catch {
    return null;
  }
}

/** Group current holdings by instrument or legal entity in one presentation currency. */
export function bucketAllocation(
  positions: Position[],
  group: AllocationGroup,
  presentationCurrency: string,
  fxRates: FxRate | FxRate[],
): Allocation {
  const buckets = new Map<string, AllocationBucket>();
  const unpriced = new Set<string>();

  for (const position of positions) {
    const key = group === "instrument" ? position.symbol : position.entity;
    const label = group === "instrument" ? position.description || position.symbol : position.entity;
    const value = positionValue(position, presentationCurrency, fxRates);
    const existing = buckets.get(key);

    if (value === null) {
      unpriced.add(group === "instrument" ? position.symbol : position.entity);
      if (!existing) buckets.set(key, { key, label, value: null, unpriced: true });
      else existing.unpriced = true;
      continue;
    }

    if (!existing) buckets.set(key, { key, label, value, unpriced: false });
    else existing.value = (existing.value ?? 0) + value;
  }

  return { buckets: [...buckets.values()].sort((a, b) => a.label.localeCompare(b.label)), unpriced: [...unpriced].sort() };
}

export function bucketAllocationByInstrument(
  positions: Position[],
  presentationCurrency: string,
  fxRates: FxRate | FxRate[],
): Allocation {
  return bucketAllocation(positions, "instrument", presentationCurrency, fxRates);
}

export function bucketAllocationByEntity(
  positions: Position[],
  presentationCurrency: string,
  fxRates: FxRate | FxRate[],
): Allocation {
  return bucketAllocation(positions, "entity", presentationCurrency, fxRates);
}
