// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test } from "vitest";
import type { Account, LearnedFact } from "@lavega/core";
import { makeFact, planTravel, TRAVEL_AGENT } from "@lavega/core";
import TravelBlock, { termsState, type TravelBlockProps, figureAge } from "./TravelBlock";
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
  // No destination picked, so there is no plan and no terms notice yet.
  expect(html).not.toContain("travel-terms");
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

/** Re-render the same root with changed props, keeping the block's own state
 *  (the chosen destination, the session's search log). */
function rerender(overrides: Partial<TravelBlockProps> = {}) {
  act(() => {
    root!.render(
      <TravelBlock {...props} accounts={travelAccounts} facts={travelFacts} txs={[]} {...overrides} />,
    );
  });
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

/* --- L1: never advise an action that cannot work. -------------------------
 *
 * The reported bug was "clicking a destination says 'ververs eerst de
 * voorwaarden'" while the server had no ANTHROPIC_API_KEY, so the refresh it
 * asked for answered 503. The block receives `aiAvailable`; these pin that it
 * now uses it, and that the three no-price situations read as three. --- */

// Nothing learned at all: no card is priced, so there is no route to show.
const noFacts: LearnedFact[] = [];

test("termsState separates a missing key, a lookup never run, and a lookup that found nothing", () => {
  const plan = planTravel({
    accounts: travelAccounts, txs: [], rates: [], facts: noFacts, destination: "US", asOf: ASOF,
  });
  expect(plan.journeys.some((j) => j.known)).toBe(false); // the situation under test

  expect(termsState(plan, false, false).kind).toBe("no-key");
  expect(termsState(plan, false, true).kind).toBe("no-key"); // no key beats everything
  expect(termsState(plan, true, false).kind).toBe("never-searched");
  expect(termsState(plan, true, true).kind).toBe("searched-empty");

  // A priced plan is "known", and it still reports which cards are missing.
  const priced = planTravel({
    accounts: travelAccounts, txs: [], rates: [], facts: travelFacts, destination: "US", asOf: ASOF,
  });
  const known = termsState(priced, true, false);
  expect(known.kind).toBe("known");
  expect(known.kind === "known" && known.lastUpdated).toBe("2026-08-01");

  // Euro destinations need no terms at all, key or no key.
  const euro = planTravel({
    accounts: travelAccounts, txs: [], rates: [], facts: noFacts, destination: "ES", asOf: ASOF,
  });
  expect(termsState(euro, false, false).kind).toBe("euro");
});

test("with no API key the block names the key, not a refresh that cannot work", () => {
  const c = renderWithDestination({ facts: noFacts, aiAvailable: false });

  expect(c.textContent).toContain("deze server heeft geen AI-sleutel");
  expect(c.textContent).toContain("ANTHROPIC_API_KEY");
  // The exact advice that cost him an afternoon.
  expect(c.textContent).not.toContain("ververs eerst de voorwaarden");
  // And no button offering it, anywhere in the block.
  const labels = [...c.querySelectorAll("button")].map((b) => b.textContent ?? "");
  expect(labels.some((l) => /Ververs|Zoek voorwaarden|Opnieuw zoeken/.test(l))).toBe(false);

  // It points at the correction that DOES work without a key.
  expect(c.textContent).toContain("vul de percentages zelf in");
});

test("never looked up says exactly that, and puts the lookup one click away", () => {
  const c = renderWithDestination({ facts: noFacts, aiAvailable: true });

  expect(c.textContent).toContain("nog nooit opgezocht");
  expect(c.textContent).not.toContain("ververs eerst de voorwaarden");

  const button = byText("button", "Zoek voorwaarden");
  expect(button.textContent).toContain("(2)"); // both cards, counted
  expect(button.className).toContain("btn-primary");
});

test("a lookup that came back empty is not the same sentence as one never run", () => {
  const asked: string[] = [];
  const c = renderWithDestination({
    facts: noFacts, aiAvailable: true, onRefreshTerms: (d: string) => asked.push(d),
  });
  expect(c.textContent).toContain("nog nooit opgezocht");

  click(byText("button", "Zoek voorwaarden"));
  expect(asked).toEqual(["US"]);

  // The request goes out and comes back with nothing learned.
  rerender({ facts: noFacts, aiAvailable: true, busy: true });
  expect(c.textContent).toContain("Bezig met zoeken…");
  rerender({ facts: noFacts, aiAvailable: true, busy: false });

  expect(c.textContent).toContain("geen bruikbaar tarief terug");
  expect(c.textContent).not.toContain("nog nooit opgezocht");
  expect(c.textContent).not.toContain("ververs eerst de voorwaarden");
  // Retrying is still offered — it is a real thing to try, unlike a refresh
  // against a server with no key.
  expect(byText("button", "Opnieuw zoeken")).toBeTruthy();
});

test("an unpriced answer card is not marked as a winning route", () => {
  const c = renderWithDestination({ facts: noFacts, aiAvailable: true });
  expect(c.querySelector(".travel-winner-unpriced")).not.toBeNull();
  expect(c.querySelector(".travel-journey-best")).toBeNull();

  // ...and the "Wisselen" step does not repeat the impossible advice either.
  click(byText("button", "Waarom?"));
  expect(c.textContent).not.toContain("ververs eerst de voorwaarden");
});

/* --- B3: the control has to be findable. --------------------------------- */

test("the terms control sits in the body under the answer, not in the module header", () => {
  const c = renderWithDestination({ facts: noFacts, aiAvailable: true });

  const controls = c.querySelector(".module-controls");
  expect(controls).toBeNull(); // it used to hide here

  const notice = c.querySelector(".travel-terms")!;
  expect(notice).not.toBeNull();
  expect(notice.querySelector("button")).not.toBeNull();
  // The notice explains itself: the button never stands on its own.
  expect((notice.textContent ?? "").length).toBeGreaterThan(40);

  // It follows the answer directly, so it is read in the same glance.
  const winner = c.querySelector(".travel-winner")!;
  expect(winner.nextElementSibling).toBe(notice);
});

test("a card whose direct leg is priced but whose route is not is reported as a gap, not as known", () => {
  const c = renderWithDestination({ aiAvailable: true });
  const notice = c.querySelector(".travel-terms")!;

  // ING's fxFeePct is known, so core's `unknownProviders` is empty and the
  // block used to be able to say "alles bekend". Its move-it-first route has no
  // convertFeePct, and that route renders "onbekend" two paragraphs down — so
  // the notice has to name it rather than claim everything is priced.
  expect(notice.textContent).toContain("ING betaalpas");
  // Core's own reason for the gap, repeated rather than guessed at.
  expect(notice.textContent).toContain("wisselkosten nog onbekend");
  expect(notice.textContent).not.toContain("Alle routes zijn beprijsd");
  expect(byText("button", "Zoek voorwaarden").textContent).toContain("(1)");
});

test("with every route priced the control stays visible as a refresh, with its date", () => {
  const complete = [
    ...travelFacts,
    fact("ING betaalpas", "convertFeePct", "1.2"),
    fact("ING betaalpas", "transferFreeViaIdeal", "1"),
  ];
  const c = renderWithDestination({ aiAvailable: true, facts: complete });
  const notice = c.querySelector(".travel-terms")!;

  expect(notice.textContent).toContain("Alle routes zijn beprijsd");
  expect(notice.textContent).toContain("Laatst opgezocht op 1 aug 2026");
  expect(byText("button", "Ververs voorwaarden")).toBeTruthy();
});

test("a figure is dated by how old it is, so a stale one cannot pass as fresh", () => {
  expect(figureAge("2026-08-17", "2026-08-17")).toBe("vandaag opgezocht");
  expect(figureAge("2026-08-16", "2026-08-17")).toBe("gisteren opgezocht");
  expect(figureAge("2026-08-13", "2026-08-17")).toContain("4 dagen geleden");
  // bank.nl's own stated check date, seven months back — it must READ old.
  expect(figureAge("2026-01-15", "2026-08-17")).toContain("maanden geleden");
});
