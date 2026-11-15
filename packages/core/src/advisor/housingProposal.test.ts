import { describe, expect, it } from "vitest";
import { proposeHousing } from "./housingProposal.js";
import { mkTx, monthly } from "./testkit.js";

describe("proposeHousing", () => {
  it("rent + 4 payments (3 would span only 59 days) -> kind huur with the 4 ids as evidence", () => {
    const rows = monthly("Woningstichting Rochdale", -850, 4, "01", { description: "huur" });
    const p = proposeHousing(rows, [], undefined);
    expect(p?.kind).toBe("housing");
    expect(p?.data).toMatchObject({ housingKind: "huur", monthlyCents: 85000 });
    expect(p?.evidence.sort()).toEqual(rows.map((r) => r.id).sort());
    expect(p?.fingerprint).toBeTruthy();
  });
  it("no named housing -> null", () => {
    expect(proposeHousing(monthly("Albert Heijn", -50, 4), [], undefined)).toBeNull();
  });
  it("under 60 days -> null", () => {
    const rows = [
      mkTx("Woningstichting X", "2026-01-01", -850, { description: "huur" }),
      mkTx("Woningstichting X", "2026-02-01", -850, { description: "huur" }),
      mkTx("Woningstichting X", "2026-02-20", -850, { description: "huur" }),
    ];
    expect(proposeHousing(rows, [], undefined)).toBeNull();
  });
  it("empty -> null", () => {
    expect(proposeHousing([], [], undefined)).toBeNull();
  });
});
