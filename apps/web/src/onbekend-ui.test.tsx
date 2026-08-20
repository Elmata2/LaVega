// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import type { Account, Tx } from "@lavega/core";
import Transacties from "./views/Transacties";
import Regels from "./views/Regels";

/* App review 20-08-2026, item 2 — the "onbekend" category, raised four times.
 *
 * The complaint was not that the number was wrong. It was that "onbekend" told
 * him nothing and the AI pass that exists for it was nowhere near the rows. So
 * what these tests pin down is what the SCREEN says:
 *   - the pile is quantified, and broken down by a reason we can prove from the
 *     row itself (the country code a card export prints);
 *   - the AI button sits with the unknowns and reports an honest count, never
 *     the batch cap dressed up as a total;
 *   - a row the AI cannot possibly read is not advertised as AI-fixable;
 *   - when the key is missing, the message names THAT, not something vaguer;
 *   - a hand-typed rule cannot quietly invent a second spelling of a category.
 */

const ACCOUNTS: Account[] = [
  { key: "NL01INGB", iban: "NL01INGB", name: "Betaalrekening", bank: "ING", entity: "Prive", currency: "EUR", balance: 100 },
];

const tx = (id: string, cp: string, desc: string, amount = -20): Tx => ({
  id, accountKey: "NL01INGB", date: "2026-07-14", amount, currency: "EUR",
  counterparty: cp, description: desc, category: "", manual: false,
});

const props = (txs: Tx[], configured = true) =>
  ({
    accounts: ACCOUNTS,
    scopedTxs: txs,
    rules: [],
    own: { all: [], byKey: new Map<string, string[]>() },
    entityOptions: ["Prive"],
    entityScope: "",
    fEntity: "", onFEntityChange: () => {},
    fAccount: "", onFAccountChange: () => {},
    fSearch: "", onFSearchChange: () => {},
    fFrom: "", onFFromChange: () => {},
    fTo: "", onFToChange: () => {},
    fCategory: "", onFCategoryChange: () => {},
    configured,
    onApplyCategories: async () => {},
  }) as unknown as Parameters<typeof Transacties>[0];

test("the onbekend pile is quantified on screen, per named reason", () => {
  const html = renderToStaticMarkup(
    <Transacties
      {...props([
        tx("t1", "TIENDA J LOPEZ", "VALENCIA ESP", -30),
        tx("t2", "LOJA DO SR SILVA", "LISBOA PRT", -12),
        tx("t3", "QUIOSC 4412", "priveopname", -8),
        tx("t4", "Albert Heijn", "Rotterdam", -25), // placed, so not in the pile
      ])}
    />,
  );
  expect(html).toContain("Onbekend");
  expect(html).toContain("3 transacties");
  // The reasons, and the countries we can prove from the rows themselves.
  expect(html).toContain("buitenlandse betaling");
  expect(html).toContain("ESP, PRT");
  expect(html).toContain("geen regel");
  // ...and it is a way IN to those rows, not just a number.
  expect(html).toContain("Toon alleen onbekend");
});

test("the AI button reports what it will actually send, not the batch cap", () => {
  const html = renderToStaticMarkup(
    <Transacties {...props([tx("t1", "TIENDA J LOPEZ", "VALENCIA ESP"), tx("t2", "QUIOSC 4412", "priveopname")])} />,
  );
  expect(html).toContain("Laat de AI ze lezen");
  expect(html).toContain("(2)"); // both fit in one run, so no "x van y" theatre
});

test("over the batch cap the button says 'x van y' — never the cap as the total", () => {
  // The whole bug this replaces: the button read "Categoriseer met AI (200)"
  // while 1.373 rows were unknown, so it looked finished after one run.
  const many: Tx[] = [];
  for (let i = 0; i < 250; i++) many.push(tx(`t${i}`, `TIENDA NR ${i}`, "VALENCIA ESP"));
  const html = renderToStaticMarkup(<Transacties {...props(many)} />);
  expect(html).toContain("250 transacties");
  expect(html).toContain("(200 van 250)");
});

test("a row with nothing readable is not sold as something the AI can fix", () => {
  // After redaction only account/reference numbers survive: there is no text for
  // any model to read. Saying "let the AI read it" here would be a loop that
  // can never close, so the panel says what it actually needs instead.
  const html = renderToStaticMarkup(
    <Transacties {...props([tx("t1", "NL17INGB0539576085", "0539576085 998877665544")])} />,
  );
  expect(html).toContain("alleen nummers");
  expect(html).toContain("Geen van deze transacties heeft tekst die de AI kan lezen");
  expect(html).not.toContain("Laat de AI ze lezen");
});

test("without a server key the panel names the missing key, not a vague failure", () => {
  const html = renderToStaticMarkup(
    <Transacties {...props([tx("t1", "TIENDA J LOPEZ", "VALENCIA ESP")], false)} />,
  );
  expect(html).toContain("geen Anthropic-sleutel");
  expect(html).not.toContain("Laat de AI ze lezen");
});

test("each onbekend row in the table says why, with its country when we have one", () => {
  const html = renderToStaticMarkup(
    <Transacties {...props([tx("t1", "TIENDA J LOPEZ", "VALENCIA ESP")])} />,
  );
  expect(html).toContain("onbekend");
  expect(html).toContain("buitenlandse betaling ESP");
});

test("a placed row shows its category and no reason badge", () => {
  const html = renderToStaticMarkup(<Transacties {...props([tx("t1", "MERCADONA", "VALENCIA ESP")])} />);
  // The Zuid-Europese block places this one, so there is no onbekend pile at all.
  expect(html).toContain("Boodschappen");
  expect(html).not.toContain("Onbekend</div>");
});

test("Regels warns when a typed category is a new one, and offers the existing list", () => {
  const base = {
    rules: [], busy: false, ruleMatch: "mercadona",
    onRuleMatchChange: () => {}, onRuleCategoryChange: () => {}, onSaveRules: () => {},
  };
  const listed = renderToStaticMarkup(<Regels {...base} ruleCategory="Boodschappen" />);
  expect(listed).toContain('list="regel-categorieen"');
  expect(listed).toContain("<datalist");
  expect(listed).not.toContain("staat niet in de lijst");

  // A different spelling of an existing category is exactly the case that
  // silently splits every total, so it has to be called out.
  const typo = renderToStaticMarkup(<Regels {...base} ruleCategory="boodschappen " />);
  expect(typo).not.toContain("staat niet in de lijst"); // same category, other case — fine
  const novel = renderToStaticMarkup(<Regels {...base} ruleCategory="Boodschapen" />);
  expect(novel).toContain("staat niet in de lijst");
});
