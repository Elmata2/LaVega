import { expect, test } from "vitest";
import { makeInvoice, scheduledInvoiceFlows } from "./invoices.js";
import type { Invoice } from "./model.js";

const inv = (o: Partial<Invoice>): Invoice => makeInvoice({
  entity: "BV1", direction: "out", counterparty: "Leverancier", issueDate: "2026-08-01",
  dueDate: "2026-09-01", amount: 1210, currency: "EUR", status: "expected", sourceType: "manual", ...o,
});

test("makeInvoice gives a stable content-hashed id", () => {
  expect(inv({}).id).toBe(inv({}).id);
  expect(inv({ amount: 1210 }).id).not.toBe(inv({ amount: 999 }).id);
});

test("scheduledInvoiceFlows: AP invoice -> outflow, AR -> inflow, on the due date, in cents", () => {
  const flows = scheduledInvoiceFlows([
    inv({ direction: "out", amount: 1210, dueDate: "2026-09-01" }),
    inv({ direction: "in", counterparty: "Klant", amount: 2500, dueDate: "2026-08-20" }),
  ]);
  expect(flows).toHaveLength(2);
  expect(flows[0]).toMatchObject({ sign: -1, amountCents: 121000, dueDate: "2026-09-01", source: "invoice" });
  expect(flows[1]).toMatchObject({ sign: 1, amountCents: 250000, dueDate: "2026-08-20", source: "invoice" });
});

test("scheduledInvoiceFlows: paid/cancelled invoices produce no flow (no double-count)", () => {
  expect(scheduledInvoiceFlows([inv({ status: "paid" }), inv({ status: "cancelled" })])).toEqual([]);
});

import { reconcileInvoices } from "./invoices.js";
import type { Tx } from "./model.js";
const tx = (id: string, date: string, amount: number, cp: string): Tx => ({ id, accountKey: "A", date, amount, currency: "EUR", counterparty: cp, description: "", category: "", manual: false });

test("reconcileInvoices: an AP invoice with a matching outflow near the due date flips to paid", () => {
  const invoices = [inv({ direction: "out", counterparty: "Coolblue", amount: 1210, dueDate: "2026-09-01" })];
  const out = reconcileInvoices(invoices, [tx("t1", "2026-08-28", -1210, "Coolblue B.V.")]);
  expect(out[0]).toMatchObject({ status: "paid", matchedTxId: "t1" });
});

test("reconcileInvoices: no counterparty overlap or wrong sign -> stays expected", () => {
  const invoices = [inv({ direction: "out", counterparty: "Coolblue", amount: 1210, dueDate: "2026-09-01" })];
  expect(reconcileInvoices(invoices, [tx("t1", "2026-08-28", 1210, "Coolblue")])[0].status).toBe("expected"); // wrong sign
  expect(reconcileInvoices(invoices, [tx("t2", "2026-08-28", -1210, "Bol.com")])[0].status).toBe("expected"); // no overlap
});

test("reconcileInvoices: one tx cannot settle two invoices", () => {
  const invoices = [inv({ counterparty: "X", amount: 100, dueDate: "2026-09-01" }), inv({ counterparty: "X", amount: 100, dueDate: "2026-09-01" })];
  const out = reconcileInvoices(invoices, [tx("t1", "2026-08-30", -100, "X")]);
  expect(out.filter((i) => i.status === "paid")).toHaveLength(1);
});
