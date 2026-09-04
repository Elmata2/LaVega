import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { Account, CategoryComparison, Tx } from "@lavega/core";
import { categoryComparison, ownAccounts } from "@lavega/core";
import { formatEuro } from "../../format.js";
import TopUitgavenBlock, { TopUitgavenView } from "./TopUitgavenBlock";
import { own, rules, txs } from "./fixtures";

/* The block renders core's verdict on whether two months may be compared at
 * all: `coverage.comparable` (do both months cover the same accounts?) and
 * `current.partial` (is the newest month still filling up?). These tests pin
 * what the block does with each answer — above all the answer that used to be
 * printed as a confident percentage. */

const block = (list: Tx[]) =>
  renderToStaticMarkup(
    <TopUitgavenBlock txs={list} rules={rules} own={own} onSelectCategory={() => {}} />,
  );

const view = (comparison: CategoryComparison) =>
  renderToStaticMarkup(<TopUitgavenView comparison={comparison} onSelectCategory={() => {}} />);

test("TopUitgavenBlock ranks the latest month's categories with share and delta", () => {
  const html = block(txs);
  expect(html).toContain("Top uitgaven");
  // August: Inkoop € 1.100 (81%) and Energie € 250 (19%), biggest first.
  expect(html.indexOf("Inkoop")).toBeLessThan(html.indexOf("Energie"));
  expect(html).toContain(formatEuro(1_100));
  expect(html).toContain(formatEuro(250));
  expect(html).toContain("81%");
  expect(html).toContain("19%");
  // Inkoop was € 1.880 in July on the same account, so it fell; Energie is new.
  expect(html).toContain("cat-delta down");
  expect(html).toContain("nieuw");
  expect(html).toContain("aug 2026 · aandeel &amp; Δ t.o.v. jul 2026");
  // The "vs. gem." button is gone with the chat widget it depended on: a
  // visible control that does nothing is worse than no control.
  expect(html).not.toContain("vs. gem.");
});

/* The review's ~€24.000: an account imported for the newest month only. Core
 * refuses to compare it, and the block has to say so instead of printing the
 * rise. */
const AMEX: Account = {
  key: "AMEX1",
  iban: "",
  name: "Amex",
  bank: "Amex",
  entity: "Holding BV",
  currency: "EUR",
  balance: null,
};

const augustOnlyCard: Tx[] = [
  {
    id: "a1",
    accountKey: "AMEX1",
    date: "2026-08-02",
    amount: -24_000,
    currency: "EUR",
    counterparty: "Leverancier",
    description: "Groot",
    category: "Inkoop",
    manual: true,
  },
  {
    id: "a2",
    accountKey: "AMEX1",
    date: "2026-08-09",
    amount: -400,
    currency: "EUR",
    counterparty: "Restaurant",
    description: "Diner",
    category: "",
    manual: false,
  },
];

test("an account that only covers the newest month is named, never silently added to the delta", () => {
  const html = block([...txs, ...augustOnlyCard]);
  const cmp = categoryComparison([...txs, ...augustOnlyCard], rules, own);
  // Core keeps the comparison alive on the accounts that DO cover both months,
  // and hands over what it left out.
  expect(cmp.coverage.comparable).toBe(true);
  expect(cmp.coverage.excludedAccountKeys).toEqual(["AMEX1"]);
  expect(cmp.coverage.excludedOut.current).toBeCloseTo(24_400, 6);
  // So the block still shows a delta — for the compared accounts only — and
  // states what stands outside it.
  expect(html).toContain("blijft buiten de vergelijking");
  expect(html).toContain(formatEuro(24_400));
  // The excluded card's spend is not in the ranked rows.
  expect(html).not.toContain(formatEuro(24_000));
});

test("when NO account covers both months the block says so instead of printing a number", () => {
  // A vault holding one card, imported for August only: nothing to compare
  // July with.
  const only = ownAccounts([AMEX]);
  const html = renderToStaticMarkup(
    <TopUitgavenBlock txs={augustOnlyCard} rules={rules} own={only} onSelectCategory={() => {}} />,
  );
  const cmp = categoryComparison(augustOnlyCard, rules, only);
  expect(cmp.coverage.comparable).toBe(false);
  expect(cmp.rows).toEqual([]);

  expect(html).toContain("niet vergelijkbaar");
  expect(html).toContain("geen enkele rekening heeft gegevens in beide maanden");
  // No percentage, no arrow, no "0%" — nothing that could be read as a measured
  // change.
  expect(html).not.toContain("cat-delta");
  expect(html).not.toMatch(/▲|▼/);
  expect(html).not.toContain("Δ t.o.v.");
});

test("a half-imported newest month is compared AND flagged, with the days named", () => {
  const html = block(txs);
  const cmp = categoryComparison(txs, rules, own);
  // The fixture's newest transaction is 11 August, so August is eleven of
  // thirty-one days — core says partial, the block prints the fraction.
  expect(cmp.current.partial).toBe(true);
  expect(cmp.current.daysObserved).toBe(11);
  expect(cmp.current.daysInMonth).toBe(31);
  expect(html).toContain("aug 2026 telt tot nu toe 11 van 31 dagen");
});

test("a complete month carries no partial-month warning", () => {
  // The newest transaction lands on the last day of July, so core sees a whole
  // month rather than a month still filling up.
  const complete: Tx[] = [
    { ...txs[2], id: "c1", accountKey: "A1", date: "2026-07-31", amount: -100 },
    { ...txs[2], id: "c2", accountKey: "A1", date: "2026-06-30", amount: -80 },
  ];
  const cmp = categoryComparison(complete, rules, own);
  expect(cmp.current.partial).toBe(false);
  const html = view(cmp);
  expect(html).not.toContain("van 31 dagen");
  expect(html).not.toContain("cat-nocompare");
});

test("TopUitgavenBlock renders an empty state with no transactions at all", () => {
  const html = block([]);
  expect(html).toContain("Nog geen uitgaven deze maand.");
  expect(html).not.toContain("cat-bar");
  expect(html).not.toContain("cat-nocompare");
});
