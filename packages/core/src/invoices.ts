import type { Invoice, ScheduledFlow, Tx } from "./model.js";
import { hash, norm } from "./hash.js";
import { makeScheduledFlow } from "./scheduledFlows.js";

/** Content-hashed id (stable across recompute, so re-import doesn't duplicate). */
export function makeInvoice(i: Omit<Invoice, "id">): Invoice {
  const id = hash(
    [
      i.entity,
      i.direction,
      i.counterparty,
      i.invoiceNumber ?? "",
      i.issueDate,
      i.dueDate,
      i.amount,
    ].join("|"),
  );
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
  const x = norm(a),
    y = norm(b);
  return x.length > 0 && y.length > 0 && (x.includes(y) || y.includes(x));
}

/** Shortest invoice number allowed to identify a payment on its own. Below this
 *  a "number" is a digit that turns up in half of all descriptions, and using
 *  it would settle invoices against unrelated transactions. */
const MIN_IDENTIFYING_NUMBER = 5;

/** Does this transaction carry the invoice's own number in its text?
 *
 *  The counterparty on a bank statement is frequently NOT the name on the
 *  invoice: a direct debit shows the collecting party, a payment provider shows
 *  itself, and a phone bill can arrive under the parent company's name. The
 *  invoice number, though, is an identifier the invoice chose for itself and
 *  Dutch payments carry it as the betalingskenmerk. So it may stand in for the
 *  name check — and only for that. Amount, sign and the date window still have
 *  to hold. */
function carriesInvoiceNumber(t: Tx, invoiceNumber: string | undefined): boolean {
  const n = norm(invoiceNumber).replace(/[^a-z0-9]/g, "");
  if (n.length < MIN_IDENTIFYING_NUMBER) return false;
  const hay = (norm(t.description) + " " + norm(t.counterparty)).replace(/[^a-z0-9]/g, "");
  return hay.includes(n);
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
      return (
        cpOverlap(t.counterparty, inv.counterparty) || carriesInvoiceNumber(t, inv.invoiceNumber)
      );
    });
    if (matches.length !== 1) return inv; // ambiguous or none -> leave for manual review
    used.add(matches[0].id);
    return { ...inv, status: "paid" as const, matchedTxId: matches[0].id };
  });
}

/* ── WHAT THE INVOICES KNOW ABOUT BTW ──────────────────────────────────────
 *
 * `Invoice.vatAmount` was stored from the day invoices landed and read by
 * nothing — `Facturen.tsx` said so in a comment. This is the reader.
 *
 * It matters because of the stelsel: under the factuurstelsel the BTW on an
 * outgoing invoice is due in the period of the INVOICE, so an invoice that has
 * not been paid yet already creates a debt. A figure built from bank movements
 * cannot see that at all.
 *
 * Two rules carry the honesty of it:
 *
 *  - `null` means "no invoice in this window states this side", never 0. An
 *    invoice list with only sales invoices does NOT mean the voorbelasting was
 *    zero; it means LaVega does not know it.
 *  - an explicit `vatAmount: 0` is a KNOWN zero and counts as covered.
 *    Btw-verlegd, ICP and 0 %-export invoices carry 0 correctly, and calling
 *    those a gap would make a complete quarter look incomplete. */

/** The BTW in one entity's invoices over one window, with the coverage that
 *  says how much of the window's invoices actually stated a BTW amount. */
export type InvoiceVatWindow = {
  /** BTW charged on outgoing (AR, `direction: "in"`) invoices — af te dragen. */
  chargedCents: number | null;
  /** BTW on incoming (AP, `direction: "out"`) invoices — voorbelasting. */
  paidCents: number | null;
  /** How many invoices in the window state a BTW amount, out of how many there
   *  are. `withVat < total` is the honest reason a figure may not be used. */
  /** `total` gaat over het VENSTER; `outside` telt de facturen van deze
   *  onderneming die erbuiten vallen, met de dichtstbijzijnde datum erbij. Zonder
   *  die twee is een nul niet te beoordelen — zie de toelichting in
   *  invoiceVatInWindow. */
  coverage: { withVat: number; total: number; outside: number; nearestOutside: string | null };
};

/**
 * `[from, to]` is inclusive and matched on the ISSUE date, because that is the
 * date the factuurstelsel makes the BTW due on.
 *
 * `paid` invoices count exactly like `expected` ones — the BTW was due whether
 * or not the money has arrived. `cancelled` invoices count for nothing: there is
 * no BTW consequence and including them in the coverage meter would report a gap
 * that cannot be filled.
 */
export function invoiceVatInWindow(
  invoices: readonly Invoice[],
  entity: string,
  from: string,
  to: string,
): InvoiceVatWindow {
  let charged: number | null = null;
  let paid: number | null = null;
  let withVat = 0;
  let total = 0;
  /* WAT ER BUITEN HET VENSTER VALT, en dat is geen boekhoudkundig detail maar het
   * verschil tussen twee heel verschillende nullen.
   *
   * Gemeld op 22 augustus: hij zette het stelsel op factuurstelsel, voerde een
   * factuur mét btw in die goed werd gelezen, en de Belasting-tab bleef 0 tonen.
   * Zijn eigen woorden: "is dat goed of niet weet ik niet." Dat is precies de
   * fout — de 0 KLOPTE (zijn factuur was van een eerdere maand), maar het scherm
   * kon het verschil niet laten zien tussen "je hebt niets aan btw" en "je
   * factuur staat in een ander tijdvak". Een cijfer dat waar is en niet te
   * beoordelen, is een cijfer waar niemand iets aan heeft.
   *
   * Deze teller draagt daarom het aantal facturen van deze onderneming dat
   * ERBUITEN valt, plus het dichtstbijzijnde tijdvak waarin er wel een staat, en
   * telt niet mee in `total` — die blijft over het venster gaan. */
  let outside = 0;
  let nearest: string | null = null;
  for (const i of invoices) {
    if (i.entity !== entity) continue;
    if (i.status === "cancelled") continue;
    if (i.issueDate < from || i.issueDate > to) {
      outside++;
      // De dichtstbijzijnde erbuiten: die verklaart het scherm het snelst.
      if (nearest === null) nearest = i.issueDate;
      else {
        const afstand = (d: string) =>
          Math.min(
            Math.abs(Date.parse(d) - Date.parse(from)),
            Math.abs(Date.parse(d) - Date.parse(to)),
          );
        if (afstand(i.issueDate) < afstand(nearest)) nearest = i.issueDate;
      }
      continue;
    }
    total++;
    if (typeof i.vatAmount !== "number" || !Number.isFinite(i.vatAmount)) continue;
    withVat++;
    const cents = Math.round(Math.abs(i.vatAmount) * 100);
    if (i.direction === "in") charged = (charged ?? 0) + cents;
    else paid = (paid ?? 0) + cents;
  }
  return {
    chargedCents: charged,
    paidCents: paid,
    coverage: { withVat, total, outside, nearestOutside: nearest },
  };
}
