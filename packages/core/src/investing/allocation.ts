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

/* ---------------------------------------------------------------------------
 * Allocation ladder (plan §3 WS4.6, #297)
 *
 * Ported from Sure commit 562fe09 (AGPL-3.0):
 *  - `app/models/investment_statement.rb:82-124` — weight is
 *    `value / max(portfolio_value, holdings_total)`, a floor over stale cached
 *    balances and negative cash. Weights are a share of the invested part and
 *    sum below 100 when cash exists.
 *  - `:126-170, 376-517` — `security.<column>.presence || "unclassified"` is a
 *    real bucket, so a fully unclassified portfolio is told exactly that; and
 *    account cash is placed where the grouping says cash belongs.
 *
 * Deliberately different: LaVega has no asset-class/sub-class/region hierarchy,
 * so the ladder's classification is the existing instrument/entity grouping and
 * the parent scope is entity → instrument. Cash is one labelled bucket per
 * ladder, not one row per account: LaVega already shows account cash on the net
 * worth chart.
 * ------------------------------------------------------------------------- */

/** The documented denominator rule. It travels with every ladder so a reader
 *  never has to guess what the weights are a share of. */
export const ALLOCATION_DENOMINATOR_RULE =
  "Weights use max(cash + holdings, holdings) as the denominator. Cash counts as part of the portfolio, and a negative or stale cash balance cannot shrink the invested part below the holdings themselves, so the weights sum to at most 100%.";

export type AllocationLadderRowKind = "holding" | "cash" | "unclassified";

export type AllocationLadderRow = {
  key: string;
  label: string;
  kind: AllocationLadderRowKind;
  /** Presentation-currency value, or null when nothing priced it. */
  value: number | null;
  /** `value / denominator`, or null when the value or the denominator is unknown. */
  weight: number | null;
  unpriced: boolean;
};

export type AllocationLadder = {
  rows: AllocationLadderRow[];
  cash: number | null;
  holdings: number | null;
  total: number | null;
  denominator: number | null;
  denominatorRule: string;
  /** Sum of the known weights; never above 1. */
  weightsSum: number | null;
  unpriced: string[];
};

export type LadderHolding = {
  key: string;
  label: string;
  value: number | null;
  /** The parent bucket this holding belongs to, for the entity → instrument
   *  drill-down. */
  parentKey?: string;
};

export type LadderCash = { key?: string; label?: string; value: number | null };

const UNCLASSIFIED_KEYS = new Set(["", "unclassified", "unknown", "n/a"]);

function isUnclassifiedKey(key: string): boolean {
  return UNCLASSIFIED_KEYS.has(key.trim().toLowerCase());
}

function sumKnown(values: readonly (number | null)[]): number | null {
  let total = 0;
  let known = false;
  for (const value of values) {
    if (value === null) continue;
    total += value;
    known = true;
  }
  return known ? total : null;
}

/** Build the ladder from already-converted presentation-currency values.
 *
 *  Cash is a bucket of its own and counts in the denominator; holdings whose
 *  grouping key is blank, "unknown" or "unclassified" fold into one labelled
 *  `unclassified` row; a null value is unpriced and carries no weight. */
export function buildAllocationLadder(input: {
  holdings: readonly LadderHolding[];
  cash?: readonly LadderCash[];
  unclassifiedLabel?: string;
  cashLabel?: string;
}): AllocationLadder {
  const holdingBuckets = new Map<
    string,
    { key: string; label: string; value: number | null; unpriced: boolean; parentKey?: string }
  >();
  const unpriced = new Set<string>();
  for (const holding of input.holdings) {
    const key = isUnclassifiedKey(holding.key) ? "unclassified" : holding.key;
    const label = isUnclassifiedKey(holding.key)
      ? (input.unclassifiedLabel ?? "Unclassified")
      : holding.label || holding.key;
    const existing = holdingBuckets.get(key);
    if (existing) {
      if (holding.value === null) {
        existing.unpriced = true;
        unpriced.add(holding.label || holding.key);
      } else existing.value = (existing.value ?? 0) + holding.value;
      continue;
    }
    if (holding.value === null) unpriced.add(holding.label || holding.key);
    holdingBuckets.set(key, {
      key,
      label,
      value: holding.value,
      unpriced: holding.value === null,
      ...(holding.parentKey ? { parentKey: holding.parentKey } : {}),
    });
  }

  const cashRows = input.cash ?? [];
  const cashKnown = cashRows.every((row) => row.value !== null);
  const cash =
    cashRows.length === 0 ? 0 : cashKnown ? sumKnown(cashRows.map((row) => row.value)) : null;
  if (!cashKnown) for (const row of cashRows) unpriced.add(row.label ?? "Cash");
  const holdings = sumKnown([...holdingBuckets.values()].map((bucket) => bucket.value));
  const total = cash === null || holdings === null ? null : cash + holdings;
  const denominator = holdings === null ? null : Math.max((cash ?? 0) + holdings, holdings);

  const rows: AllocationLadderRow[] = [...holdingBuckets.values()]
    .filter((bucket) => bucket.key !== "unclassified")
    .sort(
      (left, right) =>
        (right.value ?? -1) - (left.value ?? -1) || left.label.localeCompare(right.label),
    )
    .map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      kind: "holding",
      value: bucket.value,
      weight:
        bucket.value !== null && denominator !== null && denominator > 0
          ? bucket.value / denominator
          : null,
      unpriced: bucket.unpriced,
    }));

  const unclassifiedBucket = holdingBuckets.get("unclassified");
  if (unclassifiedBucket)
    rows.push({
      key: "unclassified",
      label: unclassifiedBucket.label,
      kind: "unclassified",
      value: unclassifiedBucket.value,
      weight:
        unclassifiedBucket.value !== null && denominator !== null && denominator > 0
          ? unclassifiedBucket.value / denominator
          : null,
      unpriced: unclassifiedBucket.unpriced,
    });

  if (cashRows.length > 0)
    rows.push({
      key: "cash",
      label: input.cashLabel ?? "Cash",
      kind: "cash",
      value: cash,
      weight: cash !== null && denominator !== null && denominator > 0 ? cash / denominator : null,
      unpriced: cash === null,
    });

  const weights = rows
    .map((row) => row.weight)
    .filter((weight): weight is number => weight !== null);
  return {
    rows,
    cash,
    holdings,
    total,
    denominator,
    denominatorRule: ALLOCATION_DENOMINATOR_RULE,
    weightsSum: weights.length === 0 ? null : weights.reduce((sum, weight) => sum + weight, 0),
    unpriced: [...unpriced].sort(),
  };
}

/** The instrument rows inside one parent entity, for the ladder's drill-down.
 *  Scoping by parent is what keeps a repeated bucket name ("unclassified",
 *  "cash") from merging two entities' rows. */
export function ladderDrillDown(
  holdings: readonly LadderHolding[],
  parentKey: string,
): LadderHolding[] {
  return holdings.filter((holding) => holding.parentKey === parentKey);
}
