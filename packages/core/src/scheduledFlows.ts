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

/** Money already earmarked for VAT that hasn't left the account yet — netted
 *  from "beschikbaar saldo". Only outflow `vat` flows that are not paid/cancelled. */
export function reservedCents(flows: ScheduledFlow[], _asOf: string): number {
  return flows
    .filter((f) => f.source === "vat" && f.sign === -1 && f.status !== "paid" && f.status !== "cancelled")
    .reduce((s, f) => s + f.amountCents, 0);
}
