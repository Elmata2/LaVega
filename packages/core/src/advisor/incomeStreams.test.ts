import { describe, expect, it } from "vitest";
import { proposeIncomeStreams } from "./incomeStreams.js";
import { mkAccount, mkTx, monthly } from "./testkit.js";
import { ownAccounts } from "../views.js";

const cur = mkAccount("A1", { iban: "NL01INGB0001234567" });
const other = mkAccount("Z", { iban: "NL99RABO0009999999" });
const opts = (accounts = [cur]) => ({
  asOf: "2026-06-10",
  rules: [],
  own: ownAccounts(accounts),
  accounts,
});

describe("proposeIncomeStreams", () => {
  it("salary 4 months -> one regular stream with the 4 tx ids as evidence", () => {
    const rows = monthly("Acme Payroll", 2500, 4, "25", { description: "salaris" });
    const out = proposeIncomeStreams(rows, opts());
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("income");
    expect(out[0].data).toMatchObject({ monthlyCents: 250000, regularity: "regular" });
    expect(out[0].evidence.sort()).toEqual(rows.map((r) => r.id).sort());
    expect(out[0].confidence).toBe("enough");
  });

  it("monthly with two occurrences is not regular; income shows as irregular", () => {
    const rows = [
      mkTx("Klant X", "2026-01-10", 1000, { description: "salaris factuur" }),
      mkTx("Klant X", "2026-03-12", 1000, { description: "salaris factuur" }),
      mkTx("Shop", "2026-04-01", -5),
    ];
    const out = proposeIncomeStreams(rows, opts());
    expect(out).toHaveLength(1);
    expect(out[0].data.regularity).toBe("irregular");
    expect(out[0].data.label).toBe("Klant X");
    // 2000 EUR over the 4 covered months Jan-Apr
    expect(out[0].data.monthlyCents).toBe(50000);
  });

  it("a mis-hinted own transfer (own IBAN in description) is never income", () => {
    const accts = [cur, other];
    const rows = monthly("J Steunenberg", 800, 4, "03", {
      description: "NL99RABO0009999999 spaar",
    });
    expect(proposeIncomeStreams(rows, opts(accts))).toEqual([]);
  });

  it("quarterly stream is proposed with 2 occurrences; monthly with 2 is not regular", () => {
    const q = [
      mkTx("Pensioenfonds", "2026-01-15", 600),
      mkTx("Pensioenfonds", "2026-04-15", 600),
      mkTx("Shop", "2026-06-01", -5),
    ];
    const out = proposeIncomeStreams(q, opts());
    expect(out.find((p) => p.data.label === "Pensioenfonds")?.data).toMatchObject({
      regularity: "regular",
      monthlyCents: 19780,
    });
    expect(out.find((p) => p.data.label === "Pensioenfonds")?.confidence).toBe("thin");
  });

  it("evidence growing by one tx gives a new fingerprint", () => {
    const rows = monthly("Acme Payroll", 2500, 4, "25", { description: "salaris" });
    const a = proposeIncomeStreams(rows, opts())[0];
    const more = [...rows, mkTx("Acme Payroll", "2026-05-25", 2500, { description: "salaris" })];
    const b = proposeIncomeStreams(more, opts())[0];
    expect(b.fingerprint).not.toBe(a.fingerprint);
  });

  it("under 60 days of history -> []", () => {
    const rows = [mkTx("Acme", "2026-01-25", 2500), mkTx("Acme", "2026-02-20", 2500)];
    expect(proposeIncomeStreams(rows, opts())).toEqual([]);
  });

  it("empty list -> []", () => {
    expect(proposeIncomeStreams([], opts())).toEqual([]);
  });
});
