import { describe, expect, it } from "vitest";
import { emptyProfile, ownAccounts, parseOwnName, type Account, type Tx } from "@lavega/core";
import { inferBlock1, withLenderLabel } from "./inference.js";

let n = 0;
const tx = (
  accountKey: string,
  date: string,
  amount: number,
  counterparty: string,
  description = "",
): Tx => ({
  id: `t${n++}`,
  accountKey,
  date,
  amount,
  currency: "EUR",
  counterparty,
  description,
  category: "",
  manual: false,
});
const acc = (key: string, o: Partial<Account> = {}): Account => ({
  key,
  iban: "",
  name: key,
  bank: "ING",
  entity: "Prive",
  currency: "EUR",
  balance: 1000,
  ...o,
});
const MONTHS = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
const asOf = "2026-10-23";
const input = (accounts: Account[], txs: Tx[], o = {}) => ({
  accounts,
  txs,
  rules: [],
  own: ownAccounts(accounts),
  profiles: [],
  asOf,
  profile: emptyProfile(),
  ...o,
});

describe("inferBlock1 own-account scope", () => {
  it("salary from a business account is proposed as income", () => {
    const personal = acc("NL11INGB0001234567", { iban: "NL11INGB0001234567" });
    const bv = acc("NL22RABO0009876543", { iban: "NL22RABO0009876543", entity: "Mijn BV" });
    const txs = MONTHS.flatMap((m) => [
      tx(personal.key, `${m}-25`, 4000, "Mijn BV", "NL22RABO0009876543 salaris"),
      tx(bv.key, `${m}-25`, -4000, "A Steunenberg", "NL11INGB0001234567 salaris"),
    ]);
    const r = inferBlock1(
      input([personal, bv], txs, { profiles: [{ entity: "Mijn BV", scope: "business" }] }),
    );
    expect(r.income.length).toBeGreaterThan(0);
  });

  it("a transfer under the owner's name, with no IBAN text, is not income", () => {
    const a = acc("NL11INGB0001234567", { iban: "NL11INGB0001234567" });
    const txs = MONTHS.map((m) => tx(a.key, `${m}-10`, 800, "A Steunenberg"));
    const own = { ...ownAccounts([a]), names: [parseOwnName("Alexander Steunenberg")!] };
    expect(inferBlock1(input([a], txs)).income.length).toBeGreaterThan(0);
    expect(inferBlock1(input([a], txs, { own })).income).toHaveLength(0);
  });
});

describe("inferBlock1 mortgage", () => {
  it("a mortgage is housing, not also a debt", () => {
    const a = acc("A1");
    const txs = [
      ...MONTHS.map((m) =>
        tx("A1", `${m}-01`, -1100, "ING Hypotheken", "aflossing hypotheek lening 123"),
      ),
      ...MONTHS.map((m) => tx("A1", `${m}-25`, 3000, "Werkgever", "salaris")),
    ];
    const r = inferBlock1(input([a], txs));
    expect(r.housing?.data.housingKind).toBe("hypotheek");
    expect(r.debts).toHaveLength(0);
  });
});

describe("withLenderLabel", () => {
  const mk = (lender: string) => ({
    id: "debt:x",
    kind: "debt" as const,
    evidence: ["account:amex.csv"],
    fingerprint: "x",
    confidence: "enough" as const,
    data: { lender, monthlyCents: null, balanceCents: 100, origin: "creditCard" as const },
  });
  const unnamed = acc("amex.csv", { name: "", bank: "", type: "Creditcard" });
  it("replaces an account key with the generic label when the account has no name or bank", () => {
    expect(withLenderLabel(mk("amex.csv"), [unnamed], "A card").data.lender).toBe("A card");
  });
  it("keeps a real lender", () => {
    expect(
      withLenderLabel(mk("Amex"), [acc("amex.csv", { name: "Amex" })], "A card").data.lender,
    ).toBe("Amex");
  });
});
