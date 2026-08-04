import { expect, test } from "vitest";
import { makeScheduledFlow, scheduledFlowsForScope, reservedCents } from "./scheduledFlows.js";

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
