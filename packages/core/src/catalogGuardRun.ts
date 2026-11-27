import type { CatalogField, CatalogValue } from "./catalog.js";
import { lastConfirmed } from "./catalogAge.js";
import {
  isArchiveUrl,
  judgeField,
  MAX_PENDING_AGE_DAYS,
  wholeDaysBetween,
  type GuardVerdict,
  type PendingFigure,
} from "./catalogGuard.js";
import { EXTRA_FIELDS } from "./catalogCoverage.js";
import type { MergeEntry } from "./catalogMerge.js";

export type FieldVerdict = {
  id: string;
  product: string;
  field: CatalogField;
  verdict: GuardVerdict;
  /** What the catalogue held. */
  before: CatalogValue | undefined;
  /** What the run read. */
  found: CatalogValue;
};

/** Key "productId.field". */
export type PendingMap = Record<string, PendingFigure>;

const NO_HOSTS: ReadonlySet<string> = new Set();

export function guardRun(input: {
  prev: readonly MergeEntry[];
  rows: readonly MergeEntry[];
  knownHosts: ReadonlyMap<string, ReadonlySet<string>>;
  pending: PendingMap;
  /** Cross-check of the stored figure, keyed "productId.field". */
  storedChecks?: ReadonlyMap<string, "still-stated" | "gone" | "unresolved">;
  /** Figures a person must decide, keyed "productId.field": a differing covered read is held. */
  manualHolds?: ReadonlySet<string>;
  today: string;
}): { rows: MergeEntry[]; verdicts: FieldVerdict[]; pending: PendingMap } {
  const { prev, knownHosts, today } = input;
  const byId = new Map(prev.map((e) => [e.id, e]));
  const knownProductIds = new Set<string>([...byId.keys(), ...input.rows.map((r) => r.id)]);
  const pending: PendingMap = {};
  for (const [key, entry] of Object.entries(input.pending)) {
    const dot = key.lastIndexOf(".");
    const productId = dot > 0 ? key.slice(0, dot) : "";
    const age = wholeDaysBetween(entry.seenAt, today);
    if (knownProductIds.has(productId) && age !== null && age <= MAX_PENDING_AGE_DAYS) {
      pending[key] = entry;
    }
  }
  const verdicts: FieldVerdict[] = [];

  const rows = input.rows.map((row) => {
    const hosts = knownHosts.get(row.issuer ?? row.id) ?? NO_HOSTS;
    const fields: Partial<Record<CatalogField, CatalogValue>> = {};
    for (const field of Object.keys(row.fields) as CatalogField[]) {
      const found = row.fields[field];
      if (!found) continue;
      const before = byId.get(row.id)?.fields[field];
      const key = `${row.id}.${field}`;
      const verdict = judgeField({
        field,
        current: before,
        found,
        knownHosts: hosts,
        pending: pending[key],
        today,
        storedCheck: input.storedChecks?.get(key),
        manualHold: input.manualHolds?.has(key),
      });
      const readDate = isArchiveUrl(found.sourceUrl) ? found.checkedAt : today;
      verdicts.push({ id: row.id, product: row.product, field, verdict, before, found });

      switch (verdict.kind) {
        case "unjudged":
          // A confirm read of an uncovered fee, points or cashback figure carries no conditions text of
          // its own: the stored text stays while the figure itself is unchanged.
          fields[field] =
            before?.conditions &&
            found.conditions === null &&
            (EXTRA_FIELDS as readonly CatalogField[]).includes(field) &&
            Math.round(before.value * 1e4) === Math.round(found.value * 1e4) &&
            before.period === found.period
              ? { ...found, conditions: before.conditions }
              : found;
          break;
        case "confirm":
          // confirm only happens against a covered baseline, so `before` is set.
          // Never move a date backwards: an old snapshot cannot undo a newer confirmation.
          fields[field] = {
            ...before!,
            confirmedAt: lastConfirmed(before!) > readDate ? lastConfirmed(before!) : readDate,
          };
          delete pending[key];
          break;
        case "publish":
          fields[field] = { ...found, confirmedAt: readDate };
          delete pending[key];
          break;
        case "pending":
          pending[key] = verdict.pending;
          break;
        case "hold":
          delete pending[key];
          break;
      }
    }
    return { ...row, fields };
  });

  return { rows, verdicts, pending };
}
