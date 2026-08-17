import { expect, test } from "vitest";
import type { Invoice, ScheduledFlow } from "@lavega/core";
import { makeScheduledFlow, rebuildVatFlows, scheduledInvoiceFlows } from "@lavega/core";
import { mergeScheduledFlows } from "./scheduled-flows";

/* The trap this file exists for: a view is handed only the flows of the scope it
 * shows, and it saves a whole list back. Persisting that list as a replace-all
 * deletes every flow the view never saw — silently, and with no way back. */

function flow(over: Partial<Omit<ScheduledFlow, "id">> = {}): ScheduledFlow {
  return makeScheduledFlow({
    entity: "BV1",
    label: "BTW Q3",
    sign: -1,
    amountCents: 100_000,
    dueDate: "2026-10-31",
    source: "vat",
    status: "expected",
    ...over,
  });
}

const bv1 = flow();
const prive = flow({ entity: "Privé", label: "Huur", source: "manual", dueDate: "2026-09-01" });

test("saving from a SCOPED list leaves the out-of-scope flows alone", () => {
  // Standing in Zakelijk: the view is shown BV1's flow only. Privé's flow is
  // stored but was never on screen, so nothing the view saves may touch it.
  const stored = [bv1, prive];
  const shown = [bv1];
  const fresh = flow({ amountCents: 250_000 }); // recomputed: a different id
  const saved = rebuildVatFlows(shown, ["BV1"], [fresh]);

  const merged = mergeScheduledFlows(stored, shown, saved, []);

  expect(merged).toContainEqual(prive);
  expect(merged).toContainEqual(fresh);
  expect(merged).not.toContainEqual(bv1); // recomputed away, which the view DID see
  expect(merged).toHaveLength(2);
});

test("a flow the view was shown and dropped is really deleted", () => {
  // Without this the merge would be an append-only store: recomputing a VAT
  // period would leave the stale reservation behind and double the set-aside.
  const stored = [bv1, prive];
  const merged = mergeScheduledFlows(stored, [bv1], [], []);
  expect(merged).toEqual([prive]);
});

test("a flow that is in neither list survives untouched", () => {
  const other = flow({ entity: "BV2", dueDate: "2026-12-31" });
  const merged = mergeScheduledFlows([bv1, prive, other], [bv1], [bv1], []);
  expect(merged).toEqual([bv1, prive, other]);
});

test("an invoice-derived flow is never written back to storage", () => {
  // Invoice flows are recomputed from `invoices` on every render. A view sees
  // them among its scoped flows and hands them back; storing one would double
  // that invoice in the forecast and outlive it being marked paid.
  const invoice: Invoice = {
    id: "i1",
    entity: "BV1",
    direction: "in",
    counterparty: "Klant",
    issueDate: "2026-08-01",
    dueDate: "2026-09-01",
    amount: 1210,
    currency: "EUR",
    status: "expected",
    sourceType: "manual",
  };
  const derived = scheduledInvoiceFlows([invoice]);
  expect(derived).toHaveLength(1);

  const shown = [bv1, ...derived];
  const saved = rebuildVatFlows(shown, ["BV1"], []); // keeps the invoice flow

  const merged = mergeScheduledFlows([bv1, prive], shown, saved, derived);
  expect(merged).toEqual([prive]);
  expect(merged.some((f) => f.source === "invoice")).toBe(false);
});

test("the whole Belasting round trip, scoped, loses nothing outside the scope", () => {
  // Exactly what App + Belasting now do: hand the view scopedScheduledFlows,
  // let it rebuild its own entity's tax flows, merge the result back.
  const storedFlows = [bv1, prive, flow({ entity: "BV2", amountCents: 33_300 })];
  const invoiceFlows = scheduledInvoiceFlows([
    {
      id: "i2",
      entity: "BV1",
      direction: "out",
      counterparty: "Leverancier",
      issueDate: "2026-08-01",
      dueDate: "2026-09-15",
      amount: 500,
      currency: "EUR",
      status: "expected",
      sourceType: "manual",
    },
  ]);
  // The Zakelijk half, narrowed to BV1: what scopedScheduledFlows would produce.
  const shown = [...storedFlows, ...invoiceFlows].filter((f) => f.entity === "BV1");
  const fresh = flow({ amountCents: 187_500, dueDate: "2027-01-31" });

  const merged = mergeScheduledFlows(
    storedFlows,
    shown,
    rebuildVatFlows(shown, ["BV1"], [fresh]),
    invoiceFlows,
  );

  expect(merged.map((f) => f.entity).sort()).toEqual(["BV1", "BV2", "Privé"]);
  expect(merged).toContainEqual(fresh);
  expect(merged.some((f) => f.source === "invoice")).toBe(false);
});
