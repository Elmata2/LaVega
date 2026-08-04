// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { expect, test } from "vitest";
import { makeInvoice, scheduledInvoiceFlows, reconcileInvoices } from "@lavega/core";
import type { Tx } from "@lavega/core";

test("manual invoice -> expected flow; paid after a matching tx", () => {
  const invoice = makeInvoice({ entity: "BV1", direction: "out", counterparty: "Coolblue", issueDate: "2026-08-01", dueDate: "2026-09-01", amount: 1210, currency: "EUR", status: "expected", sourceType: "manual" });
  expect(scheduledInvoiceFlows([invoice])).toHaveLength(1);
  const tx: Tx = { id: "t1", accountKey: "A", date: "2026-08-29", amount: -1210, currency: "EUR", counterparty: "Coolblue BV", description: "", category: "", manual: false };
  const reconciled = reconcileInvoices([invoice], [tx]);
  expect(reconciled[0].status).toBe("paid");
  expect(scheduledInvoiceFlows(reconciled)).toHaveLength(0); // no longer an expected flow
});
