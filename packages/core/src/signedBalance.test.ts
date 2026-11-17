import { expect, test } from "vitest";
import { applyCardFiles, balanceAskKind, parseBankFile, signedBalanceFor, type Account } from "./index.js";

/* Accounts come from the REAL parse + stamp path, never hand-built. */
const AMEX = `Date,Description,Card Member,Account #,Amount,Appears on Your Statement As,Extended Details
03/05/2026,SHOP ONE,A TESTER,-11111,10.00,SHOP ONE,x`;
const T212 = `Action,Time,ISIN,Ticker,Name,Notes,ID,Currency (Total),Total,Merchant name,Merchant category
Deposit,2026-01-14 08:00:00,,,,,d1,EUR,100.00,,
Card debit,2026-01-15 12:30:00,,,,,c1,EUR,-12.40,Cafe Test,Restaurants`;
const ING = `"Datum";"Naam / Omschrijving";"Rekening";"Tegenrekening";"Code";"Af Bij";"Bedrag (EUR)";"Mutatiesoort";"Mededelingen"
"20260102";"Albert Heijn";"NL01INGB0001";"";"BA";"Af";"12,34";"Betaalautomaat";"x"`;

const written = (csv: string, name: string, target: Parameters<typeof applyCardFiles>[1][0]["target"]) =>
  applyCardFiles(
    { accounts: [], txs: [] },
    [{ result: parseBankFile(name, csv), target, link: target !== null }],
    "2026-11-16",
  ).accounts;

const amex = written(AMEX, "a.csv", { cardId: "american-express-gold-card", label: "American Express Gold Card", brand: "amex" })[0]!;
const t212 = written(T212, "trading212.csv", { cardId: "212-card", label: "212 Card", brand: "trading-212" });
const t212Card = t212.find((a) => a.key === "TRADING212-CARD")!;
const ing = written(ING, "ing.csv", null)[0]!;

test("a typed 250 is stored with the sign of what the account is", () => {
  expect(signedBalanceFor(amex, 250)).toBe(-250); // a debt
  expect(signedBalanceFor(amex, -250)).toBe(-250); // a typed minus does not flip it
  expect(signedBalanceFor(t212Card, 250)).toBe(250);
  expect(signedBalanceFor(ing, 250)).toBe(250);
  expect(signedBalanceFor(amex, null)).toBeNull();
});

test("zero is stored as 0, never -0, and renders without a minus", () => {
  for (const a of [amex, t212Card, ing] as Account[]) {
    const z = signedBalanceFor(a, 0)!;
    expect(Object.is(z, 0)).toBe(true);
    expect(String(z)).toBe("0");
  }
  expect(Object.is(signedBalanceFor(amex, -0)!, 0)).toBe(true);
});

test("the question asked and the sign stored come from one rule", () => {
  for (const a of [amex, t212Card, ing]) {
    const stored = signedBalanceFor(a, 250)!;
    expect(balanceAskKind(a) === "owed").toBe(stored < 0);
  }
  expect(balanceAskKind(amex)).toBe("owed");
  expect(balanceAskKind(t212Card)).toBe("plain");
});
