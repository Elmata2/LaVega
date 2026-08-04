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

function dayDiff(a: string, b: string): number {
  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}
function cpOverlap(a: string, b: string): boolean {
  const x = norm(a), y = norm(b);
  return x.length > 0 && y.length > 0 && (x.includes(y) || y.includes(x));
}

export function reconcileInvoices(invoices: Invoice[], txs: Tx[]): Invoice[] {
  const used = new Set<string>();
  return invoices.map((inv) => {
    if (inv.status !== "expected") return inv;
    const tol = Math.max(0.02, inv.amount * 0.01);
    const matches = txs.filter((t) => {
      if (used.has(t.id)) return false;
      const signOk = inv.direction === "in" ? t.amount > 0 : t.amount < 0;
      if (!signOk) return false;
      if (Math.abs(Math.abs(t.amount) - inv.amount) > tol) return false;
      const d = dayDiff(inv.dueDate, t.date); // t.date - dueDate
      if (d < -60 || d > 30) return false;
      return cpOverlap(t.counterparty, inv.counterparty);
    });
    if (matches.length !== 1) return inv; // ambiguous or none -> leave for manual review
    used.add(matches[0].id);
    return { ...inv, status: "paid" as const, matchedTxId: matches[0].id };
  });
}
