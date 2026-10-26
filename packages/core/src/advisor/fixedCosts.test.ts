import { describe, expect, it } from "vitest";
import { proposeFixedCosts } from "./fixedCosts.js";
import { proposeDebts } from "./debts.js";
import { mkAccount, mkTx, monthly } from "./testkit.js";
import { ownAccounts } from "../views.js";

const cur = mkAccount("A1");
const card = mkAccount("C1", { name: "Amex creditcard" });
const opts = (accounts = [cur]) => ({
  asOf: "2026-06-10",
  rules: [],
  own: ownAccounts(accounts),
  accounts,
});

describe("proposeFixedCosts", () => {
  const rent = monthly("Woningstichting Rochdale", -850, 5, "01", { description: "huur" });
  const insurance = monthly("Centraal Beheer", -40, 5, "10", { description: "zorgverzekering" });
  const duo = monthly("DUO", -120, 5, "20");
  const netflix = monthly("Netflix", -13.99, 5, "15");

  it("housing is one line; debt and the housing stream are not repeated", () => {
    const out = proposeFixedCosts([...rent, ...insurance, ...duo, ...netflix], opts());
    const housing = out.filter((p) => p.kind === "housing");
    expect(housing).toHaveLength(1);
    expect(housing[0].data.monthlyCents).toBe(85000);
    // no second line for the landlord, none for DUO
    expect(out.filter((p) => /rochdale/i.test(p.data.label))).toHaveLength(1);
    expect(out.some((p) => p.data.label === "DUO")).toBe(false);
    expect(out.map((p) => p.data.label)).toEqual(
      expect.arrayContaining(["Centraal Beheer", "Netflix"]),
    );
  });

  it("a subscription that is also a schedule stream is counted once", () => {
    const out = proposeFixedCosts(netflix, opts());
    expect(out.filter((p) => /netflix/i.test(p.data.label))).toHaveLength(1);
  });

  it("incoming streams are never fixed costs", () => {
    const out = proposeFixedCosts(monthly("Acme Payroll", 2500, 5, "25"), opts());
    expect(out).toEqual([]);
  });

  it("card settlement dropped when the card is in scope, kept when not", () => {
    const settle = monthly("ING Bank", -300, 5, "28", { category: "Creditcard afbetaald" });
    expect(proposeFixedCosts(settle, opts([cur, card]))).toEqual([]);
    expect(proposeFixedCosts(settle, opts([cur])).length).toBeGreaterThan(0);
  });

  it("under 60 days -> []", () => {
    const rows = [
      mkTx("Centraal Beheer", "2026-01-10", -40),
      mkTx("Centraal Beheer", "2026-02-10", -40),
    ];
    expect(proposeFixedCosts(rows, opts())).toEqual([]);
  });

  it("a debt named only in the description is a debt and not a fixed cost", () => {
    const loan = (cp: string) =>
      monthly(cp, -150, 5, "12", { description: "aflossing persoonlijke lening" });
    for (const cp of ["Rabobank", "Bol.com", "Stichting Beheer"]) {
      const rows = loan(cp);
      const o = opts();
      expect(proposeDebts(rows, [cur], o).length).toBe(1);
      const fixed = proposeFixedCosts(rows, o);
      expect(fixed).toEqual([]);
      expect(fixed.reduce((n, p) => n + p.data.monthlyCents, 0)).toBe(0);
    }
  });
});
