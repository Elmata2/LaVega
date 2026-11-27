import type { ScheduledFlow } from "./model.js";
import { hash } from "./hash.js";

/** Build a ScheduledFlow with a content-hashed id (same content => same id, so
 *  recomputing a VAT period doesn't create duplicates). */
export function makeScheduledFlow(f: Omit<ScheduledFlow, "id">): ScheduledFlow {
  const id = hash([f.entity, f.source, f.dueDate, f.sign, f.amountCents, f.label].join("|"));
  return { ...f, id };
}

/** Filter to one entity ("" = all). */
export function scheduledFlowsForScope(flows: ScheduledFlow[], entity = ""): ScheduledFlow[] {
  return entity ? flows.filter((f) => f.entity === entity) : flows;
}

/** The flow sources the tax engine owns and recomputes: a VAT set-aside and,
 *  in a country that prepays profit tax, its prepayments/settlement. */
const TAX_SOURCES = new Set<ScheduledFlow["source"]>(["vat", "prepayment"]);

const OWNER_SETTLED_STATUSES = new Set<ScheduledFlow["status"]>(["paid", "cancelled"]);

function taxFlowKey(f: ScheduledFlow): string {
  return [f.entity, f.source, f.dueDate, f.label].join("|");
}

/** Recompute-merge for the tax ScheduledFlows: replace unsettled tax-owned flows
 *  for `entities` with `fresh`, while preserving owner-set `paid`/`cancelled`
 *  statuses (matching by id or entity/source/dueDate/label) so recomputation
 *  never re-reserves already-settled tax. */
export function rebuildTaxFlows(
  existing: ScheduledFlow[],
  entities: string[],
  fresh: ScheduledFlow[],
): ScheduledFlow[] {
  const shown = new Set(entities);
  const settledById = new Map<string, ScheduledFlow["status"]>();
  const settledByKey = new Map<string, ScheduledFlow["status"]>();
  const settledExisting: ScheduledFlow[] = [];
  const kept: ScheduledFlow[] = [];

  for (const f of existing) {
    if (TAX_SOURCES.has(f.source) && shown.has(f.entity)) {
      if (OWNER_SETTLED_STATUSES.has(f.status)) {
        settledById.set(f.id, f.status);
        settledByKey.set(taxFlowKey(f), f.status);
        settledExisting.push(f);
      }
      continue;
    }
    kept.push(f);
  }

  const freshIds = new Set<string>();
  const freshKeys = new Set<string>();
  const mergedFresh = fresh.map((f) => {
    freshIds.add(f.id);
    const key = taxFlowKey(f);
    freshKeys.add(key);
    const preserved = settledById.get(f.id) ?? settledByKey.get(key);
    return preserved ? { ...f, status: preserved } : f;
  });

  const unmatchedSettled = settledExisting.filter(
    (f) => !freshIds.has(f.id) && !freshKeys.has(taxFlowKey(f)),
  );

  return [...kept, ...unmatchedSettled, ...mergedFresh];
}

/** The name this had when VAT was the only tax LaVega reserved for. */
export const rebuildVatFlows = rebuildTaxFlows;

/** Money already earmarked for tax that hasn't left the account yet — netted
 *  from "beschikbaar saldo". Outflow `vat` and `prepayment` flows that are not
 *  paid/cancelled: a German prepayment is exactly as much not-your-money as a
 *  BTW set-aside, and showing it as available is the mistake this feature
 *  exists to prevent. */
export function reservedCents(flows: ScheduledFlow[], _asOf: string): number {
  return flows
    .filter(
      (f) =>
        TAX_SOURCES.has(f.source) &&
        f.sign === -1 &&
        f.status !== "paid" &&
        f.status !== "cancelled",
    )
    .reduce((s, f) => s + f.amountCents, 0);
}
