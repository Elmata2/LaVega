import { expect, test } from "vitest";
import type { CatalogueEntryLike } from "../catalogRates.js";
import type { Account, Tx } from "../model.js";
import { ownAccounts } from "../index.js";
import { CARD_ADVICE_MIN_MONTHS } from "./cardAdvice.js";
import { noCardAdvice } from "./cards.js";
import { emptyPlanPreferences } from "./preferences.js";

const account: Account = {
  key: "pay",
  iban: "",
  name: "Betaalrekening",
  bank: "",
  entity: "Prive",
  currency: "EUR",
  balance: 1000,
  type: "Betaalrekening",
  balanceDate: "2026-01-10",
};
const field = (value: unknown) => ({
  value,
  route: "provider-page",
  sourceUrl: "https://example.test/x",
  checkedAt: "2026-08-01",
  conditions: null,
  conditionsKnown: true,
});
const card = {
  id: "market-card",
  product: "Marktkaart",
  issuer: "Testbank",
  kind: "creditcard",
  fields: {
    cashbackPct: field(2),
    pointsPerEuro: field(0),
    accountFee: { ...field(0), period: "jaar" },
  },
} as unknown as CatalogueEntryLike;

const txs = (n: number): Tx[] =>
  Array.from({ length: n }, (_, i) => {
    const m = String(12 - n + 1 + i).padStart(2, "0");
    return {
      id: `t${m}`,
      accountKey: "pay",
      date: `2025-${m}-02`,
      amount: -2500,
      currency: "EUR",
      counterparty: "Albert Heijn",
      description: "",
      category: "",
      manual: false,
    };
  });

const advice = (n: number) =>
  noCardAdvice({
    txs: txs(n),
    accounts: [account],
    entityProfiles: [],
    rules: [],
    own: ownAccounts([account]),
    asOf: "2026-01-15",
    mode: "convert",
    fxHistory: {},
    movedCategories: new Set(),
    catalogue: [card],
    preferences: emptyPlanPreferences(),
  });

test("below the plan's minimum of full months there is no figure and no verdict", () => {
  const a = advice(CARD_ADVICE_MIN_MONTHS - 1);
  expect(a.state).toBe("short-history");
  expect(a.verdict.kind).toBe("no-options");
});

test("at the minimum the no-card baseline gives a verdict", () => {
  const a = advice(CARD_ADVICE_MIN_MONTHS);
  expect(a.baseline.kind).toBe("no-card");
  expect(a.verdict.kind).toBe("switch");
});
