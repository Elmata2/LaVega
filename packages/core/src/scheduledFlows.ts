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

/** Recompute-merge for the tax ScheduledFlows: drop every tax-owned flow that
 *  belongs to one of the given `entities`, then append the freshly computed
 *  `fresh` flows. Invoice/manual flows and other entities' tax flows are
 *  preserved. Because ids are content-hashed (see makeScheduledFlow),
 *  recomputing an unchanged period yields the same flow rather than a duplicate. */
export function rebuildTaxFlows(existing: ScheduledFlow[], entities: string[], fresh: ScheduledFlow[]): ScheduledFlow[] {
  const shown = new Set(entities);
  const kept = existing.filter((f) => !(TAX_SOURCES.has(f.source) && shown.has(f.entity)));
  return [...kept, ...fresh];
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
    .filter((f) => TAX_SOURCES.has(f.source) && f.sign === -1 && f.status !== "paid" && f.status !== "cancelled")
    .reduce((s, f) => s + f.amountCents, 0);
}
