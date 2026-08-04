import type { Invoice, ScheduledFlow, Tx } from "./model.js";
import { hash, norm } from "./hash.js";
import { makeScheduledFlow } from "./scheduledFlows.js";

/** Content-hashed id (stable across recompute, so re-import doesn't duplicate). */
export function makeInvoice(i: Omit<Invoice, "id">): Invoice {
  const id = hash([i.entity, i.direction, i.counterparty, i.invoiceNumber ?? "", i.issueDate, i.dueDate, i.amount].join("|"));
  return { ...i, id };
}

/** Expected invoices -> ScheduledFlow[] (AR inflow / AP outflow), due-dated, in cents. */
export function scheduledInvoiceFlows(invoices: Invoice[]): ScheduledFlow[] {
  return invoices
    .filter((i) => i.status === "expected")
    .map((i) =>
      makeScheduledFlow({
        entity: i.entity,
        label: `Factuur ${i.counterparty}${i.invoiceNumber ? " " + i.invoiceNumber : ""}`,
        sign: i.direction === "in" ? 1 : -1,
        amountCents: Math.round(Math.abs(i.amount) * 100),
        dueDate: i.dueDate,
        source: "invoice",
        status: "expected",
      }),
    );
}

export {}; // reconcileInvoices added in Task 2
