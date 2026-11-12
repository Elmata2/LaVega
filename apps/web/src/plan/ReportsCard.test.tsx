// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { Account, Tx, Valuation } from "@lavega/core";
import { computeReports } from "@lavega/core";
import type { OwnAccounts } from "@lavega/core";
import ReportsCard from "./ReportsCard.js";

/* The reports card (WS3.3, issue #292): the balance sheet and the income
 * statements as the owner reads them, with the cross-foot and the "how
 * calculated" sentences. The engine is pinned by core's reports.test.ts; these
 * assertions are the rendering contract. */

const AS_OF = "2026-11-11";

const account = (overrides: Partial<Account> = {}): Account => ({
  key: "betaal",
  iban: "NL01",
  name: "Betaalrekening",
  bank: "ING",
  entity: "Prive",
  currency: "EUR",
  balance: null,
  type: "Betaalrekening",
  openingBalanceCents: 100000,
  openingDate: "2026-11-01",
  ...overrides,
});

const tx = (date: string, amount: number, category: string, id: string): Tx => ({
  id,
  accountKey: "betaal",
  date,
  amount,
  currency: "EUR",
  counterparty: "",
  description: "",
  category,
  manual: false,
});

const OWN: OwnAccounts = { all: [], byKey: new Map() };

const VALUATION: Valuation = {
  id: "woning|2026-11-05",
  accountKey: "woning",
  date: "2026-11-05",
  amountCents: 42_000_000,
  currency: "EUR",
  kind: "reconciliation",
  source: "manual",
  createdAt: AS_OF,
};

function reports(valuations: Valuation[] = [VALUATION]) {
  return computeReports({
    txs: [
      tx("2026-11-03", -100, "Housing & energy", "t1"),
      tx("2026-11-05", 3000, "Inkomen", "t2"),
      tx("2026-10-02", -50, "Housing & energy", "t3"),
    ],
    accounts: [
      account(),
      account({
        key: "woning",
        name: "Woning",
        bank: "",
        type: "Woning",
        openingBalanceCents: undefined,
        openingDate: undefined,
      }),
    ],
    entityProfiles: [],
    rules: [],
    own: OWN,
    valuations,
    mode: "separate",
    fxHistory: {},
    movedCategories: new Set(),
    asOf: AS_OF,
  });
}

test("the card renders the balance sheet with assets, liabilities and equity", () => {
  const html = renderToStaticMarkup(<ReportsCard reports={reports()} />);
  expect(html).toContain("Balans");
  expect(html).toContain("Bezittingen");
  expect(html).toContain("Schulden");
  expect(html).toContain("Vermogen");
  // The house valuation is a row on the asset side.
  expect(html).toContain('data-testid="reports-row-woning"');
  expect(html).toContain('data-testid="reports-balance-totals"');
  // Equity = assets − liabilities; with only assets here it equals the assets.
  expect(html).toContain("423.900");
});

test("an unknown valuation is a sentence, not a zero", () => {
  const html = renderToStaticMarkup(<ReportsCard reports={reports([])} />);
  expect(html).toContain('data-testid="reports-gap"');
  expect(html).toContain("Onbekend");
  expect(html).toContain("niet nul");
  // The row itself says unknown; it is never printed as €0.
  expect(html).toContain('data-testid="reports-row-woning"');
});

test("the income statement shows the cross-foot per period, partial month labelled", () => {
  const html = renderToStaticMarkup(<ReportsCard reports={reports()} />);
  expect(html).toContain('data-testid="reports-income-2026-11"');
  expect(html).toContain('data-testid="reports-income-2026-10"');
  // asOf's own month is not over: it is labelled, never presented as full.
  expect(html).toContain('data-testid="reports-partial-2026-11"');
  expect(html).not.toContain('data-testid="reports-partial-2026-10"');
  const november = html.slice(
    html.indexOf('data-testid="reports-totals-2026-11"'),
    html.indexOf('data-testid="reports-totals-2026-10"'),
  );
  // income 3000, spend 100, net 2900 — all three on screen.
  expect(november).toContain("3.000");
  expect(november).toContain("Netto besparing");
  expect(november).toContain("2.900");
  expect(november).toContain("Spaarquote");
});

test("a zero-income period says the savings rate is unknown", () => {
  const html = renderToStaticMarkup(<ReportsCard reports={reports()} />);
  // September has no income in this fixture: its rate must be the word, not 0.
  const september = html.slice(html.indexOf('data-testid="reports-totals-2026-09"'));
  expect(september).toContain("onbekend");
});

test("the how-calculated sentences are on screen for both reports", () => {
  const html = renderToStaticMarkup(<ReportsCard reports={reports()} />);
  expect(html).toContain('data-testid="reports-calc"');
  expect(html).toContain('data-testid="reports-income-calc-2026-11"');
  expect(html).toContain("Zo is dit berekend");
  expect(html).toContain("inkomen min uitgaven");
});
