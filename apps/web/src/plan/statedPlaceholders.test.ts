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
    { id: "other", kind: "credit", name: "Een andere kaart", brand: null, fileOnly: false },
    { id: "other", kind: "debit", name: "Een andere pas", brand: null, fileOnly: false },
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

const T212 = "212-card";

test("a file-fed account clears the credit card it was imported for", () => {
  const out = statedCardPlaceholders({
    credit: [AMEX],
    debit: [],
    accounts: [acct("AMEX-1", { bank: "American Express", source: "file", statedCardId: AMEX })],
    entries,
  });
  expect(out).toEqual([]);
});

test("an unstamped Trading 212 account (older import) does not clear the Trading 212 card; once stamped it does", () => {
  const cash = acct("FILE-NAME-KEY", { bank: "Trading 212", linkedAt: "2026-11-01T00:00:00Z" });
  const before = statedCardPlaceholders({ credit: [], debit: [T212], accounts: [cash], entries });
  expect(before).toMatchObject([{ id: T212, brand: "trading-212", fileOnly: true }]);
  const card = acct("TRADING212-CARD", {
    bank: "Trading 212",
    source: "file",
    statedCardId: T212,
    linkedAt: "2026-11-01T00:00:00Z",
  });
  expect(
    statedCardPlaceholders({ credit: [], debit: [T212], accounts: [cash, card], entries }),
  ).toEqual([]);
});

test("an ordinary bank debit card still clears on a live link", () => {
  const out = statedCardPlaceholders({
    credit: [],
    debit: ["ing-betaalpas"],
    accounts: [acct("x", { bank: "ING", linkedAt: "2026-11-01T00:00:00Z" })],
    entries,
  });
  expect(out).toEqual([]);
});
