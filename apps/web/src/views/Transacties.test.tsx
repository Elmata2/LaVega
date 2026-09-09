// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { Account, Tx } from "@lavega/core";
import Transacties from "./Transacties";

/* The FX amount cell: original-currency amount stays primary in every mode, a
 * "approx € x" secondary figure appears only for a non-EUR row in "convert"
 * mode with a resolved rate, and an EUR row or "separate" mode is unchanged
 * from before FX support existed. */

const APPROX = "≈";

const ACCOUNTS: Account[] = [
  {
    key: "NL01INGB",
    iban: "NL01INGB",
    name: "Betaalrekening",
    bank: "ING",
    entity: "Prive",
    currency: "EUR",
    balance: 100,
  },
];

const tx = (id: string, amount: number, currency: string, date = "2026-01-05"): Tx => ({
  id,
  accountKey: "NL01INGB",
  date,
  amount,
  currency,
  counterparty: "Winkel",
  description: "Aankoop",
  category: "",
  manual: false,
});

const FX_HISTORY = { USD: { "2026-01-05": 1.1 } };

const props = (
  txs: Tx[],
  mode: "convert" | "separate",
  fxHistory: Record<string, Record<string, number>> = FX_HISTORY,
) =>
  ({
    accounts: ACCOUNTS,
    scopedTxs: txs,
    rules: [],
    own: { all: [], byKey: new Map<string, string[]>() },
    fxHistory,
    mode,
    entityOptions: ["Prive"],
    entityScope: "",
    fEntity: "",
    onFEntityChange: () => {},
    fAccount: "",
    onFAccountChange: () => {},
    fSearch: "",
    onFSearchChange: () => {},
    fFrom: "",
    onFFromChange: () => {},
    fTo: "",
    onFToChange: () => {},
    fCategory: "",
    onFCategoryChange: () => {},
    configured: false,
    onApplyCategories: async () => {},
  }) as unknown as Parameters<typeof Transacties>[0];

test("a EUR row is unchanged: no approx figure, in either mode", () => {
  for (const mode of ["convert", "separate"] as const) {
    const html = renderToStaticMarkup(<Transacties {...props([tx("t1", -25, "EUR")], mode)} />);
    expect(html).toContain("25,00");
    expect(html).not.toContain(APPROX);
  }
});

test("a non-EUR row in separate mode shows only its own currency, no approx figure", () => {
  const html = renderToStaticMarkup(
    <Transacties {...props([tx("t1", -100, "USD")], "separate")} />,
  );
  expect(html).toContain("US$");
  expect(html).not.toContain(APPROX);
});

test("a non-EUR row in convert mode shows the original amount plus an approx euro figure", () => {
  const html = renderToStaticMarkup(<Transacties {...props([tx("t1", -110, "USD")], "convert")} />);
  expect(html).toContain("US$");
  expect(html).toContain(APPROX);
  // -110 USD / 1.1 = -100 EUR
  expect(html).toContain("100,00");
});

test("a non-EUR row in convert mode with no resolvable rate shows no approx figure", () => {
  const html = renderToStaticMarkup(
    <Transacties {...props([tx("t1", -50, "SEK")], "convert", {})} />,
  );
  expect(html).toContain("SEK");
  expect(html).not.toContain(APPROX);
});
