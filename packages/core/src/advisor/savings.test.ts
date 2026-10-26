import { describe, expect, it } from "vitest";
import { proposeSavings } from "./savings.js";
import { mkAccount } from "./testkit.js";

describe("proposeSavings", () => {
  it("sums positive EUR savings balances in cents", () => {
    const out = proposeSavings([
      mkAccount("S1", { name: "Oranje Spaarrekening", balance: 1000.5 }),
      mkAccount("S2", { name: "x", type: "Spaarrekening", balance: 250 }),
      mkAccount("A1", { name: "Betaal", balance: 900 }),
    ]);
    expect(out).toMatchObject({ totalCents: 125050, excluded: 0 });
    expect(out.accountKeys.sort()).toEqual(["S1", "S2"]);
  });
  it("non-EUR savings pocket excluded and counted in `excluded`", () => {
    const out = proposeSavings([
      mkAccount("S1", { name: "Spaarrekening", balance: 100 }),
      mkAccount("S2", { name: "Savings HUF", currency: "HUF", balance: 380000 }),
    ]);
    expect(out).toMatchObject({ totalCents: 10000, excluded: 1 });
  });
  it("negative and null balances add nothing", () => {
    const out = proposeSavings([
      mkAccount("S1", { name: "Spaarrekening", balance: -5 }),
      mkAccount("S2", { name: "Spaarrekening", balance: null }),
    ]);
    expect(out).toMatchObject({ totalCents: 0, excluded: 0, accountKeys: [] });
  });
  it("no accounts -> zero", () => {
    expect(proposeSavings([])).toMatchObject({ totalCents: 0, excluded: 0 });
  });
});
