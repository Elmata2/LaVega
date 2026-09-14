// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { CatalogueEntryLike } from "@lavega/core";
import TravelBlock, { type TravelBlockProps } from "./TravelBlock";
import { ASOF } from "./fixtures";

/* `testSetup.ts` pins every other test in this directory to Dutch, so nothing
 * there can catch a Dutch word reaching the English screen — that is exactly
 * how "Betaal met Trade Republic betaalpas" shipped. This file is the one
 * place that flips the cookie (same pattern as `shell.english.test.tsx`) and
 * reads the rendered English output for real, with NO owned payment products
 * — so both the pay and the cash recommendation are forced onto a catalogue
 * card, the "held: false" path the leak lived in. */

function setCookie(locale: string) {
  document.cookie = `lavega_locale=${locale}`;
}

// React 18 only treats act() as real when this flag is set; without it every
// interaction logs "the current testing environment is not configured".
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

// One catalogue product, deliberately shaped "<bank> <tier> betaalpas" — the
// tier ("Standard") is the part a naive rebuild from `CardOffer.bank` alone
// would drop; splitProductName keeps it while still translating the trailing
// Dutch word. Its conditions carry a real withdrawal tariff (the same wording
// TravelBlock.test.tsx already proves `parseWithdrawalFee` reads), so this one
// entry forces BOTH the pay and the cash "not held" advice.
const CATALOGUE: CatalogueEntryLike[] = [
  {
    id: "revolut-standard-betaalpas",
    product: "Revolut Standard betaalpas",
    issuer: "Revolut Bank UAB",
    kind: "betaalpas",
    fields: {
      fxFeePct: {
        value: 1,
        route: "provider-page",
        sourceUrl: "https://revolut.com/fees",
        checkedAt: "2026-08-01",
        conditionsKnown: true,
        conditions:
          "1% opslag op het Standard-plan; bij geldopname in vreemde valuta geldt een apart tarief (€ 3,50 + 1,40%).",
      },
    },
  },
];

const baseProps: TravelBlockProps = {
  accounts: [], // no spendable products of his own — forces both advices onto the catalogue
  txs: [],
  rates: [],
  facts: [],
  asOf: ASOF,
  catalogue: CATALOGUE,
  homeCountry: "NL",
  busy: false,
  aiAvailable: false,
  onRefreshTerms: () => {},
  onRecheckAi: () => {},
  onCorrectFact: () => {},
};

function setNativeValue(el: HTMLSelectElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function renderWithDestinationUS(): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(<TravelBlock {...baseProps} />);
  });
  const select = container.querySelector("select")!;
  act(() => setNativeValue(select, "US"));
  return container;
}

beforeEach(() => setCookie("en"));

test("the English screen never prints the Dutch identity word", () => {
  const c = renderWithDestinationUS();

  const winnerName = c.querySelector(".travel-winner-name")!.textContent ?? "";
  // The reported bug, character for character: the tier survives translation.
  expect(winnerName).toContain("Revolut Standard debit card");
  expect(winnerName).not.toContain("betaalpas");

  const cashLine = c.querySelector(".travel-winner-cash")!.textContent ?? "";
  expect(cashLine).toContain("Revolut Standard debit card");
  expect(cashLine).not.toContain("betaalpas");

  // The whole rendered screen, not just the two headlines — every site this
  // fix touched (offers list, card-cost tail, terms notices) shares the same
  // catalogue product, so a leftover raw string anywhere would show up here.
  expect(c.textContent).not.toMatch(/\bbetaalpas\b/);
  expect(c.textContent).not.toMatch(/\bcreditcard\b/i);
});

test("the Dutch screen still prints core's own identity string, unchanged", () => {
  setCookie("nl");
  const c = renderWithDestinationUS();

  const winnerName = c.querySelector(".travel-winner-name")!.textContent ?? "";
  expect(winnerName).toContain("Revolut Standard betaalpas");

  const cashLine = c.querySelector(".travel-winner-cash")!.textContent ?? "";
  expect(cashLine).toContain("Revolut Standard betaalpas");
});
