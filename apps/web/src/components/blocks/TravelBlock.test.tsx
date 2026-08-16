// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test } from "vitest";
import type { Account, LearnedFact } from "@lavega/core";
import { makeFact, planTravel, TRAVEL_AGENT } from "@lavega/core";
import TravelBlock, { type TravelBlockProps } from "./TravelBlock";
import { accounts, ASOF, txs } from "./fixtures";

/* The travel plan itself is covered by @lavega/core's travel tests; this pins
 * how the BLOCK presents it: one answer first, the priced routes behind
 * "waarom", and an unknown route that says so instead of reading as free. */

const props: TravelBlockProps = {
  accounts,
  txs,
  rates: [],
  facts: [],
  asOf: ASOF,
  homeCountry: "NL",
  busy: false,
  aiAvailable: false,
  onRefreshTerms: () => {},
  onCorrectFact: () => {},
};

test("TravelBlock renders as a module and asks for a destination first", () => {
  const html = renderToStaticMarkup(<TravelBlock {...props} />);
  expect(html).toContain('class="module module-span-3 module-tall"');
  expect(html).toContain("Op reis");
  expect(html).toContain("Ik reis vanuit NL naar");
  expect(html).toContain("Kies een land");
  // No destination picked, so there is no plan and no refresh control yet.
  expect(html).not.toContain("module-controls");
});

/* --- The block with a destination. Needs a real DOM because the destination,
 * the "waarom" disclosure and the corrections are all interactions. --- */

// The same shape as core's journey fixtures: two banks, so "move it first" is a
// route that actually exists.
const travelAccounts: Account[] = [
  { key: "ing", iban: "NL01INGB0001", name: "Zakelijk", bank: "ING", entity: "Holding BV", currency: "EUR", balance: 4_000, type: "Betaalrekening" },
  { key: "rev", iban: "LT01REVO0001", name: "Reisgeld", bank: "Revolut", entity: "Privé", currency: "EUR", balance: 100, type: "Betaalrekening" },
];

const fact = (subject: string, key: string, value: string): LearnedFact =>
  makeFact({ agent: TRAVEL_AGENT, subject, key, value, source: "agent", updatedAt: "2026-08-01" });

// Revolut's whole route is priced; ING's conversion leg deliberately is not, so
// one known winner and one unknown route render side by side.
const travelFacts: LearnedFact[] = [
  fact("ING betaalpas", "fxFeePct", "1.4"),
  fact("Revolut betaalpas", "fxFeePct", "0.5"),
  fact("Revolut betaalpas", "convertFeePct", "0"),
  fact("Revolut betaalpas", "transferFreeViaIdeal", "1"),
];

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

function setNativeValue(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** The one button/element whose text starts with `text`. Fails loudly rather
 *  than returning undefined, so a renamed label breaks the test that relies on
 *  it instead of silently passing. */
function byText(selector: string, text: string): HTMLElement {
  const hit = [...container!.querySelectorAll(selector)].find((n) => (n.textContent ?? "").includes(text));
  if (!hit) throw new Error(`no ${selector} containing "${text}"`);
  return hit as HTMLElement;
}

/** Render the block, pick the United States, and open "waarom". */
function renderWithDestination(overrides: Partial<TravelBlockProps> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <TravelBlock {...props} accounts={travelAccounts} facts={travelFacts} txs={[]} {...overrides} />,
    );
  });
  const select = container.querySelector("select")!;
  act(() => setNativeValue(select, "US"));
  return container;
}

test("the block leads with the plan's headline — the one answer, in euros", () => {
  const c = renderWithDestination();
  const expected = planTravel({
    accounts: travelAccounts, txs: [], rates: [], facts: travelFacts, destination: "US", asOf: ASOF,
  }).headline;

  const answer = c.querySelector(".travel-winner-name")!;
  expect(answer.textContent).toBe(expected);
  expect(expected).toContain("Revolut betaalpas"); // the cheapest whole route, not the cheapest card
  expect(expected).toContain("iDEAL");

  // The routes and the three sections are detail, not a rival answer: they only
  // appear once "waarom" is opened.
  expect(c.querySelector(".travel-journeys")).toBeNull();
  expect(c.textContent).not.toContain("Bewaren");
});

test("waarom reveals the ranked routes, each with its three legs", () => {
  const c = renderWithDestination();
  click(byText("button", "Waarom?"));

  const journeys = [...c.querySelectorAll(".travel-journey")];
  expect(journeys.length).toBeGreaterThan(1);

  // Cheapest first, and the winner is the one the headline named.
  expect(journeys[0].classList.contains("travel-journey-best")).toBe(true);
  expect(journeys[0].textContent).toContain("Via Revolut betaalpas");
  expect(journeys[0].textContent).toContain("vanaf ING");

  const legs = [...journeys[0].querySelectorAll(".travel-leg-name")].map((n) => n.textContent ?? "");
  expect(legs[0]).toContain("Overzetten");
  expect(legs[1]).toContain("Wisselen");
  expect(legs[2]).toContain("Betalen");

  // A leg that costs nothing is "€ 0,00", never the negative zero that falls out
  // of "minus no cashback".
  expect(c.textContent).not.toContain("-0,00");

  // The three original sections survive, as detail under the answer.
  expect(c.textContent).toContain("Bewaren");
  expect(c.textContent).toContain("Wisselen");
  expect(c.textContent).toContain("Betalen");
});

test("a route with an unknown leg says so and never renders as free", () => {
  const c = renderWithDestination();
  click(byText("button", "Waarom?"));

  const unknown = c.querySelector(".travel-journey-unknown");
  expect(unknown).not.toBeNull();
  // ING's conversion leg was never learned, so the whole route is unpriced.
  expect(unknown!.textContent).toContain("Via ING betaalpas");

  const total = unknown!.querySelector(".travel-journey-cost")!.textContent ?? "";
  expect(total).toBe("onbekend");
  expect(total).not.toMatch(/[0-9]/); // not "€ 0,00", not any number
  expect(unknown!.textContent).toContain("Onbekend is niet gratis");

  // ...and it sorts behind the known winner.
  const all = [...c.querySelectorAll(".travel-journey")];
  expect(all.indexOf(unknown as Element)).toBeGreaterThan(0);
});

test("convertFeePct is correctable inline and fires the same callback shape as fxFeePct", () => {
  const learned: LearnedFact[] = [];
  const c = renderWithDestination({ onCorrectFact: (f: LearnedFact) => learned.push(f) });
  click(byText("button", "Waarom?"));

  const correct = (buttonText: string, inputLabel: string, value: string) => {
    click(byText("button", buttonText));
    const input = c.querySelector<HTMLInputElement>(`input[aria-label="${inputLabel}"]`);
    if (!input) throw new Error(`no input labelled "${inputLabel}"`);
    act(() => setNativeValue(input, value));
    click(byText("button", "Bewaar"));
  };

  // The via-route's conversion leg — the fact the whole route ranking hangs on.
  correct("omwisselkosten (0%) aanpassen", "omwisselkosten (0%) van Revolut betaalpas", "1,5");
  // The direct route's card surcharge — the correction that already existed.
  correct("wisselkosten (1.4%) aanpassen", "wisselkosten (1.4%) van ING betaalpas", "2");

  expect(learned).toHaveLength(2);
  const [convert, fx] = learned;

  const today = new Date().toISOString().slice(0, 10);
  expect(convert).toEqual(
    makeFact({ agent: TRAVEL_AGENT, subject: "Revolut betaalpas", key: "convertFeePct", value: "1.5", source: "user", updatedAt: today }),
  );
  expect(fx).toEqual(
    makeFact({ agent: TRAVEL_AGENT, subject: "ING betaalpas", key: "fxFeePct", value: "2", source: "user", updatedAt: today }),
  );
  // Same shape, same learning rule: only agent/subject/key/value differ.
  expect(Object.keys(convert).sort()).toEqual(Object.keys(fx).sort());
  expect(convert.source).toBe(fx.source);
  expect(convert.agent).toBe(fx.agent);
});
