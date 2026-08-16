import { expect, test } from "vitest";
import { makeScheduledFlow, scheduledFlowsForScope, reservedCents, rebuildVatFlows, rebuildTaxFlows } from "./scheduledFlows.js";

test("makeScheduledFlow builds a positive-cents dated flow with a stable id", () => {
  const f = makeScheduledFlow({ entity: "BV1", label: "BTW Q1", sign: -1, amountCents: 120000, dueDate: "2026-04-30", source: "vat", status: "confirmed" });
  expect(f).toMatchObject({ entity: "BV1", sign: -1, amountCents: 120000, dueDate: "2026-04-30", source: "vat", status: "confirmed" });
  expect(typeof f.id).toBe("string");
  // same content -> same id (dedup on re-compute)
  expect(makeScheduledFlow({ entity: "BV1", label: "BTW Q1", sign: -1, amountCents: 120000, dueDate: "2026-04-30", source: "vat", status: "confirmed" }).id).toBe(f.id);
});

test("scheduledFlowsForScope filters by entity ('' = all)", () => {
  const a = makeScheduledFlow({ entity: "BV1", label: "x", sign: -1, amountCents: 100, dueDate: "2026-05-01", source: "vat", status: "confirmed" });
  const b = makeScheduledFlow({ entity: "BV2", label: "y", sign: -1, amountCents: 200, dueDate: "2026-05-01", source: "vat", status: "confirmed" });
  expect(scheduledFlowsForScope([a, b], "BV1")).toEqual([a]);
  expect(scheduledFlowsForScope([a, b], "")).toEqual([a, b]);
});

test("reservedCents sums outflow 'vat' flows not yet paid/cancelled (earmarked money)", () => {
  const flows = [
    makeScheduledFlow({ entity: "BV1", label: "BTW", sign: -1, amountCents: 50000, dueDate: "2026-05-01", source: "vat", status: "confirmed" }),
    makeScheduledFlow({ entity: "BV1", label: "BTW paid", sign: -1, amountCents: 9900, dueDate: "2026-02-01", source: "vat", status: "paid" }),
    makeScheduledFlow({ entity: "BV1", label: "invoice", sign: -1, amountCents: 7000, dueDate: "2026-05-01", source: "invoice", status: "expected" }),
  ];
  expect(reservedCents(flows, "2026-04-01")).toBe(50000); // only the unpaid vat flow
});

test("rebuildVatFlows preserves non-vat flows and other entities' vat flows", () => {
  const nonVat = makeScheduledFlow({ entity: "BV1", label: "invoice", sign: 1, amountCents: 7000, dueDate: "2026-05-01", source: "invoice", status: "expected" });
  const otherEntityVat = makeScheduledFlow({ entity: "BV2", label: "BTW Q2", sign: -1, amountCents: 30000, dueDate: "2026-07-31", source: "vat", status: "confirmed" });
  const shownOldVat = makeScheduledFlow({ entity: "BV1", label: "BTW Q1", sign: -1, amountCents: 10000, dueDate: "2026-04-30", source: "vat", status: "confirmed" });
  const fresh = makeScheduledFlow({ entity: "BV1", label: "BTW Q2", sign: -1, amountCents: 20000, dueDate: "2026-07-31", source: "vat", status: "confirmed" });

  const result = rebuildVatFlows([nonVat, otherEntityVat, shownOldVat], ["BV1"], [fresh]);
  // (a) non-vat flow and BV2's vat flow survive; (b) BV1's old vat flow is replaced by the fresh one
  expect(result).toContain(nonVat);
  expect(result).toContain(otherEntityVat);
  expect(result).not.toContain(shownOldVat);
  expect(result).toContain(fresh);
  expect(result).toHaveLength(3);
});

test("rebuildVatFlows dedups on recompute via content-hashed ids", () => {
  const existing = makeScheduledFlow({ entity: "BV1", label: "BTW Q2", sign: -1, amountCents: 20000, dueDate: "2026-07-31", source: "vat", status: "confirmed" });
  // Recompute yields the same content -> same id, and rebuild drops the old one first, so no duplicate.
  const fresh = makeScheduledFlow({ entity: "BV1", label: "BTW Q2", sign: -1, amountCents: 20000, dueDate: "2026-07-31", source: "vat", status: "confirmed" });
  const result = rebuildVatFlows([existing], ["BV1"], [fresh]);
  expect(result).toHaveLength(1);
  expect(result[0].id).toBe(existing.id);
});

test("a profit-tax prepayment is earmarked money too — it never counts as available", () => {
  const flows = [
    makeScheduledFlow({ entity: "BV1", label: "USt Q2 2026", sign: -1, amountCents: 50000, dueDate: "2026-07-10", source: "vat", status: "confirmed" }),
    makeScheduledFlow({ entity: "BV1", label: "Nachzahlung 2026", sign: -1, amountCents: 25_000_000, dueDate: "2027-03-10", source: "prepayment", status: "expected" }),
    makeScheduledFlow({ entity: "BV1", label: "betaald", sign: -1, amountCents: 999, dueDate: "2026-03-10", source: "prepayment", status: "paid" }),
  ];
  expect(reservedCents(flows, "2026-06-20")).toBe(25_050_000);
});

test("rebuildTaxFlows replaces both tax sources for the shown entities in one pass", () => {
  const oldVat = makeScheduledFlow({ entity: "BV1", label: "USt Q1", sign: -1, amountCents: 100, dueDate: "2026-04-10", source: "vat", status: "confirmed" });
  const oldPrepay = makeScheduledFlow({ entity: "BV1", label: "Vorauszahlung 1/4 2026", sign: -1, amountCents: 200, dueDate: "2026-03-10", source: "prepayment", status: "expected" });
  const invoice = makeScheduledFlow({ entity: "BV1", label: "factuur", sign: 1, amountCents: 300, dueDate: "2026-05-01", source: "invoice", status: "expected" });
  const fresh = makeScheduledFlow({ entity: "BV1", label: "Vorauszahlung 2/4 2026", sign: -1, amountCents: 400, dueDate: "2026-06-10", source: "prepayment", status: "expected" });

  const result = rebuildTaxFlows([oldVat, oldPrepay, invoice], ["BV1"], [fresh]);
  expect(result).toEqual([invoice, fresh]);
  expect(rebuildVatFlows).toBe(rebuildTaxFlows); // the old name is the same door
});
