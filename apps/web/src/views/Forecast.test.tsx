// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { Account, Tx } from "@lavega/core";
import Forecast from "./Forecast";

/* App review 2, 20 August: "remove the Forecast explainer about the
 * deterministic 13-week forecast, and the notes."
 *
 * Both blocks were true and both were defensible — the footnote answered "no ML,
 * every figure can be redone by hand" and the notes answered "prove you forecast
 * better than my spreadsheet". He has read them; they now cost a screen and earn
 * nothing. The chart, the banner, the drivers and the "gestopt" list all stay,
 * because those carry numbers rather than explain them.
 *
 * `coverageNotes` itself stays in forecast-view.ts with its own unit tests: the
 * derivation is still correct and still cheap, and it is the obvious input for a
 * hover or a disclosure later. Only the rendering is gone. */

const ACCOUNTS: Account[] = [
  {
    key: "ING1",
    iban: "NL01INGB",
    name: "Betaalrekening",
    bank: "ING",
    entity: "Prive",
    currency: "EUR",
    balance: 8_000,
  },
];

/** A year of a salary in and a rent out, so the engine has real streams and a
 *  basis — the state in which the removed blocks used to have the most to say. */
function history(): Tx[] {
  const txs: Tx[] = [];
  for (let m = 1; m <= 12; m++) {
    const mm = String(m).padStart(2, "0");
    txs.push({
      id: `in${m}`,
      accountKey: "ING1",
      date: `2026-${mm}-25`,
      amount: 3200,
      currency: "EUR",
      counterparty: "Werkgever BV",
      description: "salaris",
      category: "",
      manual: false,
    });
    txs.push({
      id: `out${m}`,
      accountKey: "ING1",
      date: `2026-${mm}-01`,
      amount: -1450,
      currency: "EUR",
      counterparty: "Woningstichting Rochdale",
      description: "huur",
      category: "",
      manual: false,
    });
  }
  return txs;
}

const render = () =>
  renderToStaticMarkup(
    <Forecast
      txs={history()}
      accounts={ACCOUNTS}
      entityScope=""
      asOf="2026-12-28"
      bufferCents={250_000}
      scheduledFlows={[]}
    />,
  );

test("the deterministic-forecast explainer is gone", () => {
  const html = render();
  expect(html).not.toContain("Deterministische");
  expect(html).not.toContain("forecast-footnote");
  expect(html).not.toContain("standaardafwijking van gemeten variatie");
});

test("the 'waar deze prognose op rust' notes are gone", () => {
  expect(render()).not.toContain("Waar deze prognose op rust");
});

test("what carries numbers stays: the chart, the drivers and the banner", () => {
  const html = render();
  expect(html).toContain("13-weeks cashflow-forecast");
  expect(html).toContain("Verwachte inkomsten");
  expect(html).toContain("Werkgever BV");
  expect(html).toContain("Tekort-signalering");
});
