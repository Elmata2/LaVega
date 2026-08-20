// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { Account, Rule, Tx } from "@lavega/core";
import { ownAccounts } from "@lavega/core";
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

const RULES: Rule[] = [];

function render(txs: Tx[], accounts: Account[] = ACCOUNTS) {
  return renderToStaticMarkup(
    <Optimalisatie
      txs={txs}
      accounts={accounts}
      rules={RULES}
      own={ownAccounts(accounts)}
      asOf="2026-08-16"
      busy={false}
      facts={[]}
      onRateCommit={() => {}}
    />,
  );
}

test("the two halves sit in one grid of equal columns, subscriptions first", () => {
  const html = render([]);
  expect(html).toContain("module-grid grid-2");
  expect(html.indexOf("Abonnementen")).toBeLessThan(html.indexOf(">Rente<"));
});

test("the interest advice is spelled out and ends in a euro figure per year", () => {
  const html = render([]);
  // ABN AMRO's own standard rate is 1,25%. The comparison is now against what the
  // winning account KEEPS rather than its headline: Bigbank's 3,1% is a six-month
  // actierente that drops to 2,1%, so the best kept rate is Scalable Capital at
  // 2,5%. € 50.000 × 1,25% = € 625 per year — less flattering than the € 925 this
  // test used to assert, and the figure the saver will actually see in month seven.
  expect(html).toContain("Je houdt");
  expect(html).toContain("ABN AMRO");
  expect(html).toContain("1,25%");
  expect(html).toContain("Scalable Capital");
  expect(html).toContain("2,5%");
  expect(html).toContain("625,00");
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

/* --- What the core lane exposes, consumed here (never re-derived) --------- */

test("a short import says WHICH rhythms it cannot yet see — the answer to the missing Simeo", () => {
  // Two months of statements. A quarterly charge needs one full gap before
  // there is anything to recognise, so it cannot appear — and the screen has to
  // say that rather than let an empty list read as "you have none".
  const html = render([
    tx("a1", "2026-06-14", -12.5, "Albert Heijn"),
    tx("a2", "2026-07-14", -12.5, "Albert Heijn"),
  ]);
  expect(html).toContain("per kwartaal");
  expect(html).toContain("jaarlijks");
  expect(html).toContain("niet omdat het er niet is");
});

test("a year of history moves the quarterly window from 'cannot see' to 'can see'", () => {
  const txs: Tx[] = [];
  for (let m = 0; m < 12; m++) {
    const month = String(m + 1).padStart(2, "0");
    txs.push(tx(`q${m}`, `2026-${month}-06`, -9.99, "Spotify"));
  }
  const html = render(txs);
  expect(html).toContain("335</strong> dagen afschrift");
  // Quarterly is now within reach; only the yearly rhythm still needs more.
  expect(html).toContain("per kwartaal, halfjaarlijks</strong> herkenbaar");
  expect(html).toContain("Nog niet: jaarlijks (vanaf 365 dagen)");
});

test("the housing cost is READ from the transactions, never typed and never zero", () => {
  const txs: Tx[] = [];
  for (let m = 1; m <= 6; m++) {
    const month = String(m).padStart(2, "0");
    txs.push(tx(`h${m}`, `2026-${month}-01`, -1450, "Woningstichting Rochdale"));
  }
  const html = render(txs);
  expect(html).toContain("Woonlasten");
  expect(html).toContain("Woningstichting Rochdale");
  expect(html).toContain("1.450,00");
  expect(html).toContain("Zelf invullen"); // the point: he does not have to
});

test("no housing stream in the data prints 'onbekend', not € 0,00", () => {
  const html = render([tx("x1", "2026-08-01", -12.5, "Albert Heijn")]);
  expect(html).toContain("Woonlasten");
  expect(html).toContain("niet in de data gezien");
  expect(html).not.toContain("Zelf invullen");
});

/* --- App review, 20 Aug: items 1 and 9 on screen ------------------------- *
 *
 * These render against the BUNDLED table (the catalogue merge arrives in an
 * effect, which static rendering does not run), so the numbers below are that
 * table's: best kept rate Scalable Capital 2,50%, best headline today Bigbank
 * 3,10% falling to 2,10%, and ING's Oranje Spaarrekening at 1,25%.
 */

test("the promo is shown next to what you keep, priced per month, never added to the year", () => {
  // His objection to yesterday's change: "for a user who doesn't have bunq, if
  // they can use the promo for a month it's still a month of 3,01% over the 2,5%
  // of Scalable Capital." So both numbers appear, each labelled with its period.
  const html = render([]);
  // Ranked on what he keeps — unchanged.
  expect(html).toContain("Scalable Capital");
  expect(html).toContain("625,00"); // € 50.000 × (2,50 − 1,25)% per jaar
  // And what he could get today, with what it turns into afterwards.
  expect(html).toContain("Bigbank");
  expect(html).toContain("3,1%");
  expect(html).toContain("Actierente 6 mnd, daarna 2,10%");
  // € 50.000 × (3,10 − 2,50)% ÷ 12 = € 25,00 for each month the action runs.
  expect(html).toContain("25,00");
  expect(html).toContain("per maand extra");
});

test("an ING account is never left at a bare 'aangenomen 0%' — the row says what ING pays", () => {
  // Item 1, his words: "That ING is 0% that's bullshit, we need to have those."
  // The account arrives from the CSV with its IBAN as the name, so nothing in it
  // says "savings" and the type heuristic reads it as a payment account. 0% may
  // be right for one of his two ING accounts, but the screen has to name the rate
  // ING does pay and ask which account this is instead of asserting a
  // measurement it never made.
  const html = render([], [
    { key: "ING1", iban: "NL88INGB0793113504", name: "NL88INGB0793113504", bank: "ING", entity: "Prive", currency: "EUR", balance: 20_000 },
  ]);
  expect(html).toContain("aangenomen 0%");
  expect(html).toContain("Oranje Spaarrekening");
  expect(html).toContain("1,25%");
  expect(html).toContain("Is dit die rekening?");
});

test("a savings account at ING is estimated from ING's own tariff, and the row names it", () => {
  const html = render([], [
    { key: "ING2", iban: "NL95INGB0674843703", name: "NL95INGB0674843703", bank: "ING", entity: "Prive", currency: "EUR", balance: 20_000, type: "Spaarrekening" },
  ]);
  expect(html).toContain("geschat via banktarief");
  expect(html).toContain("ING Oranje Spaarrekening");
  expect(html).toContain("1,25%");
  // The gain is measured against what he KEEPS at the winner (2,50%), not the
  // 3,10% headline: € 20.000 × 1,25% = € 250,00.
  expect(html).toContain("250,00");
  expect(html).not.toContain("370,00"); // what the 3,10% teaser would have promised
});

test("the comparison table separates what you get now from what you keep", () => {
  const html = render([]);
  expect(html).toContain("Wat je houdt");
  expect(html).toContain("Rente nu");
});
