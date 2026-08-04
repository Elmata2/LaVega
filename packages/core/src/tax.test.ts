import { expect, test } from "vitest";
import { nextBtwDeadline, BTW_RULES_AS_OF } from "./tax.js";

test("nextBtwDeadline quarterly: from mid-Q2 -> Q2 ends 06-30, deadline 07-31", () => {
  expect(nextBtwDeadline("quarterly", "2026-05-10")).toEqual({ periodLabel: "Q2 2026", periodEnd: "2026-06-30", deadline: "2026-07-31" });
});
test("nextBtwDeadline quarterly: Q4 deadline rolls into next year (31 Jan)", () => {
  expect(nextBtwDeadline("quarterly", "2026-11-15")).toEqual({ periodLabel: "Q4 2026", periodEnd: "2026-12-31", deadline: "2027-01-31" });
});
test("nextBtwDeadline monthly: Aug -> deadline 30 Sep", () => {
  expect(nextBtwDeadline("monthly", "2026-08-04")).toEqual({ periodLabel: "aug 2026", periodEnd: "2026-08-31", deadline: "2026-09-30" });
});
test("has a verified-as-of date", () => { expect(BTW_RULES_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/); });
