import { expect, test } from "vitest";
import type { Account } from "@lavega/core";
import { CATALOGUE_ENTRIES } from "../catalogue-rates";
import { buildHeldCards } from "./heldCards";
import {
  statedHeldRows,
  type StatedAnswers,
} from "./optimalisatieStated";

const AMEX = "american-express-gold-card";
const ans = (o: Partial<StatedAnswers> = {}): StatedAnswers => ({
  credit: [],
  debit: [],
  repayment: null,
  balances: [],
  noCards: false,
  statedAt: "2026-11-01",
  ...o,
});
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

test("a stated credit card becomes a held row with unknown cashback, never zero", () => {
  const [row] = statedHeldRows(ans({ credit: [AMEX] }), [], CATALOGUE_ENTRIES);
  expect(row).toMatchObject({ id: AMEX, kind: "credit", label: "American Express Gold Card" });
  expect(row!.card.cashback.tier).toBe("onbekend");
});

test("the row is the same one the plan builds", () => {
  const plan = buildHeldCards({
    accounts: [],
    facts: [],
    entries: CATALOGUE_ENTRIES,
    rewards: [],
    assumptionOn: true,
    statedCreditIds: [AMEX],
  });
  const [row] = statedHeldRows(ans({ credit: [AMEX] }), [], CATALOGUE_ENTRIES);
  expect(row!.card).toEqual(plan[0]);
});

test("a card the bank data holds is not a stated row", () => {
  const held = acct("amex", {
    name: "American Express Gold Card",
    bank: "American Express",
    type: "Creditcard",
  });
  expect(statedHeldRows(ans({ credit: [AMEX] }), [held], CATALOGUE_ENTRIES)).toEqual([]);
});

test("a debit card stops being stated when a live-linked account matches the brand", () => {
  const linked = acct("ing", { bank: "ING", linkedAt: "2026-11-01" });
  expect(statedHeldRows(ans({ debit: ["ing-betaalpas"] }), [], CATALOGUE_ENTRIES)).toHaveLength(1);
  expect(statedHeldRows(ans({ debit: ["ing-betaalpas"] }), [linked], CATALOGUE_ENTRIES)).toEqual(
    [],
  );
});

test("other, investment accounts and interest products are not payment cards", () => {
  expect(
    statedHeldRows(
      ans({
        credit: ["other", "trading-212-beleggingsrekening", "trading-212-interest-on-cash"],
        debit: ["other", "trading-212-beleggingsrekening"],
      }),
      [],
      CATALOGUE_ENTRIES,
    ),
  ).toEqual([]);
});
