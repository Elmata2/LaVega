import { expect, test } from "vitest";
import type { Account } from "@lavega/core";
import { CATALOGUE_ENTRIES } from "../catalogue-rates";
import { statedCardPlaceholders as build } from "./statedPlaceholders";

const acct = (key: string, o: Partial<Account> = {}): Account => ({
  key,
  iban: "",
  name: key,
  bank: "ING",
  entity: "Prive",
  currency: "EUR",
  balance: null,
  ...o,
});
const entries = CATALOGUE_ENTRIES;
const AMEX = "american-express-gold-card";
const labels = { credit: "Een andere kaart", debit: "Een andere pas" };
const statedCardPlaceholders = (i: Omit<Parameters<typeof build>[0], "otherLabels">) =>
  build({ otherLabels: labels, ...i });

test("a stated credit card the bank data does not hold is shown", () => {
  const [p] = statedCardPlaceholders({
    credit: [AMEX],
    debit: [],
    accounts: [],
    entries,
  });
  expect(p).toMatchObject({
    id: AMEX,
    kind: "credit",
    name: "American Express Gold Card",
    brand: "amex",
  });
});

test("a stated credit card held through bank data is hidden", () => {
  const held = acct("amex", {
    name: "American Express Gold Card",
    bank: "American Express",
    type: "Creditcard",
  });
  expect(
    statedCardPlaceholders({
      credit: [AMEX],
      debit: [],
      accounts: [held],
      entries,
    }),
  ).toEqual([]);
});

test("a stated ING debit card is hidden by a linked ING account", () => {
  const linked = acct("ing", { bank: "ING", linkedAt: "2026-11-01" });
  expect(
    statedCardPlaceholders({
      credit: [],
      debit: ["ing-betaalpas"],
      accounts: [linked],
      entries,
    }),
  ).toEqual([]);
});

test("a stated ING debit card stays when the ING account is only a CSV", () => {
  const csv = acct("ing", { bank: "ING" });
  const out = statedCardPlaceholders({
    credit: [],
    debit: ["ing-betaalpas"],
    accounts: [csv],
    entries,
  });
  expect(out.map((p) => [p.id, p.kind, p.brand])).toEqual([["ing-betaalpas", "debit", "ing"]]);
});

test("a linked account of another bank does not hide the debit card", () => {
  const abn = acct("abn", { bank: "ABN AMRO", linkedAt: "2026-11-01" });
  expect(
    statedCardPlaceholders({
      credit: [],
      debit: ["ing-betaalpas"],
      accounts: [abn],
      entries,
    }),
  ).toHaveLength(1);
});

test("other is shown with the other label and no brand", () => {
  const out = statedCardPlaceholders({
    credit: ["other"],
    debit: ["other"],
    accounts: [],
    entries,
  });
  expect(out).toEqual([
    { id: "other", kind: "credit", name: "Een andere kaart", brand: null },
    { id: "other", kind: "debit", name: "Een andere pas", brand: null },
  ]);
});

test("duplicates are shown once", () => {
  const out = statedCardPlaceholders({
    credit: [AMEX, AMEX],
    debit: [],
    accounts: [],
    entries,
  });
  expect(out).toHaveLength(1);
});

test("credit comes before debit, each in stated order", () => {
  const out = statedCardPlaceholders({
    credit: [AMEX, "ics-creditcard"],
    debit: ["knab-betaalpas", "ing-betaalpas"],
    accounts: [],
    entries,
  });
  expect(out.map((p) => `${p.kind}:${p.id}`)).toEqual([
    `credit:${AMEX}`,
    "credit:ics-creditcard",
    "debit:knab-betaalpas",
    "debit:ing-betaalpas",
  ]);
});
