import type { Position } from "./model.js";
import { convertCurrency, type FxRates } from "./portfolio.js";

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

export type PricedAllocationPosition = Pick<Position, "symbol" | "entity" | "description"> & {
  marketValue: number | null;
};

function positionValue(
  position: Position,
  presentationCurrency: string,
  fxRates: FxRates,
): number | null {
  const value =
    position.marketValue ??
    (position.marketPrice === null ? null : position.quantity * position.marketPrice);
  if (value === null) return null;
  try {
    return convertCurrency(value, position.currency, presentationCurrency, position.asOf, fxRates);
  } catch {
    return null;
  }
}

/** Group current holdings by instrument or legal entity in one presentation currency. */
export function bucketAllocation(
  positions: Position[],
  group: AllocationGroup,
  presentationCurrency: string,
  fxRates: FxRates,
): Allocation {
  const buckets = new Map<string, AllocationBucket>();
  const unpriced = new Set<string>();

  for (const position of positions) {
    const key = group === "instrument" ? position.symbol : position.entity;
    const label =
      group === "instrument" ? position.description || position.symbol : position.entity;
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

  return {
    buckets: [...buckets.values()].sort((a, b) => a.label.localeCompare(b.label)),
    unpriced: [...unpriced].sort(),
  };
}

export function bucketAllocationByInstrument(
  positions: Position[],
  presentationCurrency: string,
  fxRates: FxRates,
): Allocation {
  return bucketAllocation(positions, "instrument", presentationCurrency, fxRates);
}

export function bucketAllocationByEntity(
  positions: Position[],
  presentationCurrency: string,
  fxRates: FxRates,
): Allocation {
  return bucketAllocation(positions, "entity", presentationCurrency, fxRates);
}

/** Bucket already-converted, five-business-day-capped current values. */
export function bucketPricedAllocation(
  positions: readonly PricedAllocationPosition[],
  group: AllocationGroup,
): Allocation {
  const buckets = new Map<string, AllocationBucket>();
  const unpriced = new Set<string>();
  for (const position of positions) {
    const key = group === "instrument" ? position.symbol : position.entity;
    const label =
      group === "instrument" ? position.description || position.symbol : position.entity;
    const existing = buckets.get(key);
    if (position.marketValue === null) {
      unpriced.add(position.symbol);
      if (!existing) buckets.set(key, { key, label, value: null, unpriced: true });
      continue;
    }
    if (!existing) buckets.set(key, { key, label, value: position.marketValue, unpriced: false });
    else {
      existing.value = (existing.value ?? 0) + position.marketValue;
      existing.unpriced = false;
    }
  }
  return {
    buckets: [...buckets.values()].sort((left, right) => left.label.localeCompare(right.label)),
    unpriced: [...unpriced].sort(),
  };
}
