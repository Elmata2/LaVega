// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { Account, Tx } from "@lavega/core";
import Optimalisatie from "./views/Optimalisatie";

/* Optimalisatie after the rebalance (UI review, 2026-08-16):
 *   - the interest reasoning is spelled out and ends in a number;
 *   - the two halves are one grid of equal columns, subscriptions first;
 *   - a thin subscriptions half explains what LaVega measured instead of
 *     seeding invented rows.
 */

const ACCOUNTS: Account[] = [
  { key: "ABN1", iban: "NL01ABNA", name: "Spaarrekening", bank: "ABN AMRO", entity: "Prive", currency: "EUR", balance: 50_000 },
];

function tx(id: string, date: string, amount: number, counterparty: string): Tx {
  return { id, accountKey: "ABN1", date, amount, currency: "EUR", counterparty, description: "", category: "", manual: false };
}

function render(txs: Tx[], accounts: Account[] = ACCOUNTS) {
  return renderToStaticMarkup(
    <Optimalisatie txs={txs} accounts={accounts} asOf="2026-08-16" busy={false} onRateCommit={() => {}} />,
  );
}

test("the two halves sit in one grid of equal columns, subscriptions first", () => {
  const html = render([]);
  expect(html).toContain("module-grid grid-2");
  expect(html.indexOf("Abonnementen")).toBeLessThan(html.indexOf(">Rente<"));
});

test("the interest advice is spelled out and ends in a euro figure per year", () => {
  const html = render([]);
  // ABN AMRO's own standard rate is 1,25%; the best free-withdrawal benchmark
  // is Bigbank at 3,1%. € 50.000 × 1,85% = € 925 per year.
  expect(html).toContain("Je houdt");
  expect(html).toContain("ABN AMRO");
  expect(html).toContain("1,25%");
  expect(html).toContain("Bigbank");
  expect(html).toContain("3,1%");
  expect(html).toContain("1,85%");
  expect(html).toContain("925,00");
  expect(html).toContain("per jaar");
});

test("an account with no saldo yields no figure at all — not a zero", () => {
  const html = render([], [{ ...ACCOUNTS[0], balance: null }]);
  expect(html).toContain("Nog geen rentewinst berekend");
  expect(html).toContain("1 rekening zonder saldo");
  expect(html).toContain("onbekend"); // the saldo cell, not "€ 0,00"
  expect(html).not.toContain("Je houdt");
});

test("the thin subscriptions half reports what was actually measured, and seeds nothing", () => {
  // Two outflows to the same shop, but no cadence — so no subscription.
  const html = render([
    tx("a", "2026-07-02", -12.5, "Albert Heijn"),
    tx("b", "2026-07-19", -31.4, "Albert Heijn"),
    tx("c", "2026-08-04", -9.99, "Kiosk"),
  ]);

  expect(html).toContain("Nog geen abonnement herkend");
  expect(html).toContain("Dat is een meting, geen leeg scherm");
  expect(html).toContain("<strong>3</strong> uitgaande transacties");
  expect(html).toContain("2026-07-02 en 2026-08-04");
  expect(html).toContain("<strong>2</strong> ontvangers");
  expect(html).toContain("<strong>1</strong> minstens twee keer");
  // The pattern it looks for is stated, so the empty result is judgeable.
  expect(html).toContain("een vast ritme");

  // The worked example is behind a disclosure and labelled as an example.
  expect(html).toContain("Voorbeeld — niet jouw data, en nergens opgeslagen");
  expect(html).toContain("<details");
});

test("a detected subscription is priced per year as well as per month", () => {
  const html = render([
    tx("n1", "2026-05-08", -15.99, "Netflix"),
    tx("n2", "2026-06-08", -15.99, "Netflix"),
    tx("n3", "2026-07-08", -17.99, "Netflix"),
    tx("n4", "2026-08-08", -17.99, "Netflix"),
  ]);
  expect(html).toContain("Netflix");
  expect(html).not.toContain("Nog geen abonnement herkend");
  // Per-year column: € 17,99 × 12 = € 215,88.
  expect(html).toContain("215,88");
  // The price rise is reasoned to a yearly number too: € 2,00 × 12 = € 24,00.
  expect(html).toContain("24,00");
  // No example rows leak into a filled block.
  expect(html).not.toContain("Voorbeeld — niet jouw data");
});
