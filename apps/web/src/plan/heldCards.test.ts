import { expect, test } from "vitest";
import {
  CATALOGUE_KINDS_FOR,
  TRAVEL_AGENT,
  factEntry,
  factId,
  factNumber,
  heldCashbackOf,
  lastTermsCheckedForIssuer,
  productOf,
  type Account,
  type LearnedFact,
  type RewardsBalance,
} from "@lavega/core";
import { CATALOGUE_ENTRIES } from "../catalogue-rates";
import { buildHeldCards } from "./heldCards";

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

const ING = acct("ing-pas", { name: "Betaalrekening", bank: "ING" });
const ABN = acct("abn-cc", { name: "Creditcard", bank: "ABN AMRO", type: "Creditcard" });
const SAVINGS = acct("ing-save", { name: "Spaarrekening", bank: "ING", type: "Spaarrekening" });

const fact = (subject: string, value: string): LearnedFact => ({
  id: factId(TRAVEL_AGENT, subject, "cashbackPct"),
  agent: TRAVEL_AGENT,
  subject,
  key: "cashbackPct",
  value,
  source: "user",
  updatedAt: "2026-09-01",
});

const base = { entries: CATALOGUE_ENTRIES, rewards: [] as RewardsBalance[] };

/** What Optimalisatie.tsx derives for one spendable account, written out. */
function optimalisatieDerivation(a: Account, facts: LearnedFact[], assumptionOn: boolean) {
  const product = productOf(a);
  const f = factEntry(facts, TRAVEL_AGENT, product, "cashbackPct");
  const pct = factNumber(facts, TRAVEL_AGENT, product, "cashbackPct");
  const kind = a.type === "Creditcard" ? "creditcard" : "betaalpas";
  return heldCashbackOf({
    issuer: a.bank ?? "",
    kind,
    productName: product,
    fact: pct !== null && f ? { pct, source: f.source, updatedAt: f.updatedAt } : null,
    assumptionOn,
    lastCheckedAt: lastTermsCheckedForIssuer(
      CATALOGUE_ENTRIES,
      a.bank ?? "",
      CATALOGUE_KINDS_FOR[kind],
    ),
  });
}

test("held cards: only payment instruments, with the cashback state Optimalisatie derives", () => {
  const facts = [fact("ING betaalpas", "0,5")];
  for (const assumptionOn of [true, false]) {
    const cards = buildHeldCards({ ...base, accounts: [ING, ABN, SAVINGS], facts, assumptionOn });
    expect(cards.map((c) => c.accountKey)).toEqual(["ing-pas", "abn-cc"]);
    expect(cards[0]!.cashback).toEqual(optimalisatieDerivation(ING, facts, assumptionOn));
    expect(cards[1]!.cashback).toEqual(optimalisatieDerivation(ABN, facts, assumptionOn));
  }
});

test("no measured cashback and the assumption off keeps the cashback tier unknown, never a zero", () => {
  const [card] = buildHeldCards({ ...base, accounts: [ING], facts: [], assumptionOn: false });
  expect(card!.cashback).toEqual({ tier: "uitgezet" });
});

test("a typed cashback figure wins over the assumption", () => {
  const [card] = buildHeldCards({
    ...base,
    accounts: [ING],
    facts: [fact("ING betaalpas", "1,5")],
    assumptionOn: true,
  });
  expect(card!.cashback).toMatchObject({ tier: "gemeten", pct: 1.5 });
});

test("fx fee and points rate come from the catalogue row with their date and source", () => {
  const cards = buildHeldCards({ ...base, accounts: [ING, ABN], facts: [], assumptionOn: true });
  const ing = cards[0]!;
  expect(ing.fxFeePct).toBe(1.4);
  expect(ing.provenance?.fxFeePct?.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(ing.provenance?.fxFeePct?.sourceUrl).toMatch(/^https:/);
  // ING's betaalpas row has no points rate: nothing is invented.
  expect(ing.pointsPerEuro).toBeNull();
  expect(ing.provenance?.pointsPerEuro).toBeUndefined();
  const abn = cards[1]!;
  expect(typeof abn.fxFeePct).toBe("number");
  expect(typeof abn.pointsPerEuro).toBe("number");
  expect(abn.provenance?.pointsPerEuro?.sourceUrl).toMatch(/^https:/);
});

test("a card with no catalogue row gets no figures and no provenance", () => {
  const odd = acct("odd", { name: "Pas", bank: "Onbekende Bank" });
  const [card] = buildHeldCards({ ...base, accounts: [odd], facts: [], assumptionOn: true });
  expect(card).toMatchObject({ fxFeePct: null, pointsPerEuro: null, fee: null, programId: null });
  expect(card!.provenance).toBeUndefined();
});

test("a rewards programme is linked only when exactly one name appears in the card", () => {
  const amex = acct("amex", {
    name: "Amex Membership",
    bank: "American Express",
    type: "Creditcard",
  });
  const mr: RewardsBalance = {
    id: "amex-membership",
    program: "Amex Membership",
    points: 100,
    updatedAt: "2026-10-01",
  };
  const other: RewardsBalance = {
    id: "flying-blue",
    program: "Flying Blue",
    points: 5,
    updatedAt: "2026-10-01",
  };
  const [linked] = buildHeldCards({
    ...base,
    accounts: [amex],
    facts: [],
    rewards: [mr, other],
    assumptionOn: true,
  });
  expect(linked!.programId).toBe("amex-membership");
  const [none] = buildHeldCards({
    ...base,
    accounts: [amex],
    facts: [],
    rewards: [other],
    assumptionOn: true,
  });
  expect(none!.programId).toBeNull();
});

test("a bank card the catalogue knows carries its catalogue id; one it does not know carries null", () => {
  const known = acct("abn-cc2", { name: "creditcard", bank: "ABN AMRO", type: "Creditcard" });
  const unknown = acct("x", { name: "Mijn eigen pas", bank: "Onbekende Bank" });
  const cards = buildHeldCards({ ...base, accounts: [known, unknown], facts: [], assumptionOn: false });
  expect(cards[0]!.catalogueId).toBe("abn-amro-creditcard");
  expect(cards[1]!.catalogueId).toBeNull();
});
