import { describe, expect, it } from "vitest";
import { proposeDebts } from "./debts.js";
import { mkAccount, mkTx, monthly } from "./testkit.js";
import { ownAccounts } from "../views.js";

const cur = mkAccount("A1");
const opts = (accounts = [cur]) => ({
  asOf: "2026-06-10",
  rules: [],
  own: ownAccounts(accounts),
});

describe("proposeDebts", () => {
  it("DUO outflow monthly x4 -> debt proposal labelled DUO", () => {
    const rows = monthly("DUO", -120, 4, "20");
    const out = proposeDebts(rows, [cur], opts());
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("debt");
    expect(out[0].data).toMatchObject({ lender: "DUO", monthlyCents: 12000 });
    expect(out[0].evidence.sort()).toEqual(rows.map((r) => r.id).sort());
  });
  it("credit card with negative balance -> debt; savings positive -> not a debt", () => {
    const card = mkAccount("C1", { name: "Amex creditcard", balance: -450.5 });
    const sav = mkAccount("S1", { name: "Spaarrekening", balance: 3000 });
    const rows = [...monthly("Albert Heijn", -20, 4, "02", { accountKey: "C1" })];
    const out = proposeDebts(rows, [cur, card, sav], opts([cur, card, sav]));
    expect(out).toHaveLength(1);
    expect(out[0].data).toMatchObject({
      origin: "creditCard",
      balanceCents: 45050,
      monthlyCents: null,
    });
    expect(out[0].evidence.length).toBeGreaterThan(0);
  });
  it("a card with a positive balance is not a debt", () => {
    const card = mkAccount("C1", { name: "Amex creditcard", balance: 10 });
    const rows = monthly("Albert Heijn", -20, 4, "02", { accountKey: "C1" });
    expect(proposeDebts(rows, [cur, card], opts([cur, card]))).toEqual([]);
  });
  it("incoming stream from a lender word is not a debt", () => {
    expect(proposeDebts(monthly("DUO", 120, 4, "20"), [cur], opts())).toEqual([]);
  });
  it("under 60 days -> []", () => {
    const rows = [mkTx("DUO", "2026-01-20", -120), mkTx("DUO", "2026-02-20", -120)];
    expect(proposeDebts(rows, [cur], opts())).toEqual([]);
  });
  it("an unnamed card with no bank still gets a non-empty lender (its key)", () => {
    const card = mkAccount("amex-2026.csv", {
      name: "",
      bank: "",
      type: "Creditcard",
      balance: -100,
    });
    const rows = monthly("Albert Heijn", -20, 4, "02", { accountKey: card.key });
    const out = proposeDebts(rows, [cur, card], opts([cur, card]));
    expect(out).toHaveLength(1);
    expect(out[0].data.lender.length).toBeGreaterThan(0);
  });
});
