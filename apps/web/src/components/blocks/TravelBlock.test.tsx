// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test } from "vitest";
import type { Account, LearnedFact } from "@lavega/core";
import { makeFact, planTravel, TRAVEL_AGENT } from "@lavega/core";
import TravelBlock, { termsState, type TravelBlockProps, figureAge, TermsNotice } from "./TravelBlock";
import type { CatalogueEntryLike } from "@lavega/core";
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
  onRefreshTerms: () => {}, onRecheckAi: () => {},
  onCorrectFact: () => {},
};

test("TravelBlock renders as a module and asks for a destination first", () => {
  const html = renderToStaticMarkup(<TravelBlock {...props} />);
  expect(html).toContain('class="module module-span-3 module-tall"');
  // Named after the question he asks, not after the software that answers it
  // (review 3, item 4). The Module puts the title in its aria-label too.
  expect(html).toContain("Ik ga op reis");
  expect(html).not.toContain("reisagent");
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
  expect(notice.textContent).toContain("Cijfers laatst gecontroleerd op 1 aug 2026");
  expect(byText("button", "Ververs voorwaarden")).toBeTruthy();
});

test("a figure is dated by how old it is, so a stale one cannot pass as fresh", () => {
  expect(figureAge("2026-08-17", "2026-08-17")).toBe("vandaag opgezocht");
  expect(figureAge("2026-08-16", "2026-08-17")).toBe("gisteren opgezocht");
  expect(figureAge("2026-08-13", "2026-08-17")).toContain("4 dagen geleden");
  // bank.nl's own stated check date, seven months back — it must READ old.
  expect(figureAge("2026-01-15", "2026-08-17")).toContain("maanden geleden");
});

test("the no-key state offers a way to re-check, because the key check runs once at page load", () => {
  // This is the state that says "this server has no AI key" — and it is exactly
  // the state where that fact may already be stale, since LaVega asks the server
  // only at mount. Without a control here the only cure is knowing to reload,
  // which the screen never says.
  const html = renderToStaticMarkup(
    <TermsNotice
      state={{ kind: "no-key", unknown: ["ING betaalpas"] }}
      busy={false}
      aiAvailable={false}
      termsAsked={0}
      termsGaveUp={false}
      onSearch={() => {}}
      onRecheckAi={() => {}}
    />,
  );
  expect(html).toContain("geen AI-sleutel");
  expect(html).toContain("Opnieuw controleren");
});

test("'still looking' is not the same claim as 'nothing came back'", () => {
  const plan = planTravel({ accounts, txs: [], rates: [], facts: [], destination: "US", asOf: ASOF });

  // The server said it is working on ING. Reporting that as a failed search told
  // the owner his lookup had come back empty while a banner two lines up said it
  // was still running — and the fee appeared moments later.
  const busy = termsState(plan, true, true, ["ING betaalpas"]);
  expect(busy.kind).toBe("searching");
  if (busy.kind === "searching") expect(busy.pending).toContain("ING betaalpas");

  // Nothing pending: then, and only then, it really did come back empty.
  expect(termsState(plan, true, true, []).kind).toBe("searched-empty");

  const html = renderToStaticMarkup(
    <TermsNotice state={busy} busy={false} aiAvailable={true} termsAsked={0} termsGaveUp={false} onSearch={() => {}} onRecheckAi={() => {}} />,
  );
  expect(html).toContain("zoekt de voorwaarden op");
  expect(html).not.toContain("geen bruikbaar tarief");
});

test("while the server is looking, the block SHOWS it working and counts up", () => {
  // The HTTP call returns in ~200ms; the lookup runs for minutes. Tracking the
  // request left the screen still while the work happened, which is what made
  // him ask whether anything was working at all.
  const html = renderToStaticMarkup(
    <TermsNotice
      state={{ kind: "searching", pending: ["Revolut betaalpas", "Trading 212 betaalpas"] }}
      busy={false}
      aiAvailable={true}
      termsAsked={4}
      termsGaveUp={false}
      onSearch={() => {}}
      onRecheckAi={() => {}}
    />,
  );

  expect(html).toContain("spinner");
  expect(html).toContain("2 van 4 gevonden"); // 4 asked, 2 still pending
  expect(html).toContain("werkt zichzelf bij");
  expect(html).toContain('aria-live="polite"'); // it changes under him; say so
});

test("when the lookups run out of time it says so, rather than spinning forever", () => {
  const html = renderToStaticMarkup(
    <TermsNotice
      state={{ kind: "searching", pending: ["Revolut betaalpas"] }}
      busy={false}
      aiAvailable={true}
      termsAsked={1}
      termsGaveUp={true}
      onSearch={() => {}}
      onRecheckAi={() => {}}
    />,
  );
  expect(html).toContain("Er kwam niets meer binnen");
});

/* ─────────────────────────────────────────── cash, cashback and the market
 *
 * App review items 6/7/8. The plan itself is covered by core's travel tests;
 * these pin that the block puts the CASH answer on screen, and that a card he
 * does not hold can never be mistaken for one he can pay with today. */

const CATALOGUE: CatalogueEntryLike[] = [
  {
    id: "ing-betaalpas", product: "ING betaalpas", issuer: "ING Bank N.V.", kind: "betaalpas",
    fields: {
      fxFeePct: {
        value: 1.4, route: "agent", sourceUrl: "https://assets.ing.com/kosten.pdf", checkedAt: "2026-06-15",
        conditionsKnown: true,
        conditions: "Geldt bij betalen in vreemde valuta; bij geldopname in vreemde valuta geldt een apart tarief (€ 3,50 + 1,40%).",
      },
    },
  },
  {
    id: "revolut-standard-betaalpas", product: "Revolut Standard betaalpas",
    issuer: "Revolut Bank UAB", kind: "betaalpas",
    fields: {
      fxFeePct: {
        value: 1, route: "provider-page", sourceUrl: "https://revolut.com/fees", checkedAt: "2026-08-01",
        conditionsKnown: true, conditions: "1% opslag op het Standard-plan.",
      },
    },
  },
  {
    id: "212-card", product: "212 Card", issuer: "Paynetics; Trading 212 Markets Ltd", kind: "betaalpas",
    fields: {
      fxFeePct: {
        value: 0, route: "provider-page", sourceUrl: "https://trading212.com/card", checkedAt: "2026-08-01",
        conditionsKnown: true, conditions: "Geen wisselkoersopslag op kaartbetalingen in vreemde valuta.",
      },
    },
  },
  {
    // The one shape that proves a FREE foreign-currency withdrawal, in words.
    id: "n26-go-betaalpas", product: "N26 Go betaalpas", issuer: "N26 Bank AG (Germany)", kind: "betaalpas",
    fields: {
      fxFeePct: {
        value: 0, route: "agent", sourceUrl: "https://docs.n26.com/pricelist.pdf", checkedAt: "2026-06-26",
        conditionsKnown: true,
        conditions: "The 0 is written as 'Free'. Go ALSO gets foreign-currency ATM withdrawals free: 'For, N26 Go, N26 Business Go, N26 Metal Free'.",
      },
    },
  },
  {
    id: "wirex-card-wirex-one", product: "Wirex Card (Wirex One)", issuer: "Wirex", kind: "betaalpas",
    fields: {
      fxFeePct: {
        value: 1.5, route: "provider-page", sourceUrl: "https://wirex.com/fees", checkedAt: "2026-08-01",
        conditionsKnown: true, conditions: "1,5% opslag buiten de euro.",
      },
      cashbackPct: {
        value: 0.5, route: "provider-page", sourceUrl: "https://wirex.com/cryptoback", checkedAt: "2026-08-01",
        conditionsKnown: true,
        conditions: "Standard plan, Entry tier. PAID IN CRYPTO (Cryptoback), not euro. Everything above 0.5% needs 150,000 WXT locked.",
      },
    },
  },
];

/** The block with a destination AND the product catalogue, which is what the
 *  real app renders — the bundled catalogue is the default prop. */
function renderWithCatalogue(over: Partial<TravelBlockProps> = {}): HTMLElement {
  return renderWithDestination({ catalogue: CATALOGUE, ...over });
}

test("the block answers the cash question too, in euros, with the small-withdrawal warning", () => {
  const el = renderWithCatalogue();
  const text = el.textContent ?? "";
  // ING's own document: € 3,50 per opname + 1,40% — € 6,30 on € 200.
  expect(text).toContain("€ 6,30");
  expect(text).toContain("in één keer meer");
});

test("a card whose document prices no withdrawal says so, and never reads as free", () => {
  const el = renderWithCatalogue();
  click(byText("button", "Waarom?"));
  const cash = el.querySelector(".travel-cash")!;
  expect(cash.textContent).toContain("Revolut betaalpas");
  // Revolut's fee row says nothing about cash, so the price is missing.
  expect(cash.textContent).toContain("onbekend");
  expect(cash.textContent).not.toContain("gratis");
});

test("cards he does not hold sit in their own section and are never offered to pay with", () => {
  const el = renderWithCatalogue();
  click(byText("button", "Waarom?"));
  const offers = el.querySelector(".travel-offers")!;
  expect(offers.textContent).toContain("212 Card");
  expect(offers.textContent).toContain("geen kaarten van jou");
  // Marked per row, not only in the section's intro sentence.
  expect(offers.querySelectorAll(".badge").length).toBeGreaterThan(0);
  // And it is NOT inside the list of things to pay with.
  const spend = [...el.querySelectorAll(".travel-step")].find((s) => s.textContent?.startsWith("Betalen"));
  expect(spend?.textContent).not.toContain("212 Card");
});

/* The default facts give him a € 0 route (move to Revolut via iDEAL, convert at
 * 0%), which no catalogue card can beat — and a tie must NEVER crown a card he
 * has to open first. So the scenario this test is about only exists when his own
 * best really is dearer: 1% direct at Revolut, nothing free to move it to. */
const DEARER_OWN: LearnedFact[] = [
  fact("ING betaalpas", "fxFeePct", "1.4"),
  fact("Revolut betaalpas", "fxFeePct", "1"),
];

test("a cheaper card he does not hold LEADS the answer, and is marked as not his", () => {
  const el = renderWithCatalogue({ facts: DEARER_OWN });
  const winner = el.querySelector(".travel-winner")!;
  // The headline itself, not a footnote under it (review 3, item 2).
  expect(el.querySelector(".travel-winner-name")!.textContent).toContain("212 Card");
  expect(winner.textContent).toContain("€ 10,00"); // 1% of € 1.000 saved
  expect(winner.textContent).toMatch(/nog niet van jou|heb je nog niet/i);
  // A card he cannot tap tomorrow morning must LOOK different from one he can.
  expect(winner.querySelector(".badge")).not.toBeNull();
});

test("what he can pay with today stays on screen, just no longer as the headline", () => {
  const el = renderWithCatalogue({ facts: DEARER_OWN });
  const winner = el.querySelector(".travel-winner")!;
  expect(winner.textContent).toContain("Revolut betaalpas"); // his own cheapest
  expect(winner.textContent).toMatch(/vandaag/i);
  expect(winner.textContent).toContain("€ 10,00");
});

test("a tie never crowns a card he has to open first", () => {
  // The default facts: his own route already costs nothing.
  const el = renderWithCatalogue();
  const name = el.querySelector(".travel-winner-name")!.textContent ?? "";
  expect(name).toContain("Revolut betaalpas");
  expect(name).not.toContain("212 Card");
  // No "you have to open this first" line for the PAYMENT advice. (The cash
  // advice is a separate ranking and may well still point at a card he lacks.)
  expect(el.querySelector(".travel-winner-switch")).toBeNull();
  expect(el.querySelector(".travel-winner-today")).toBeNull();
});

test("the cash line recommends the proven cheapest and names the card it cannot price", () => {
  const el = renderWithCatalogue({ facts: DEARER_OWN });
  const cash = el.querySelector(".travel-winner-cash")!.textContent ?? "";
  // Not ING — he is right about that — and not Revolut either, because no source
  // prices a Revolut withdrawal. N26 Go's price list does, at zero.
  expect(cash).toContain("N26 Go betaalpas");
  expect(cash).toContain("ING betaalpas"); // his own cheapest proven, for comparison
  expect(cash).toContain("Revolut betaalpas"); // the gap, named
  expect(cash).not.toMatch(/gratis|kost je niets/i);
  expect(el.querySelector(".travel-winner-cash .badge")).not.toBeNull();
});

test("catalogue cashback is shown with its gate, never subtracted from the price", () => {
  const el = renderWithCatalogue();
  click(byText("button", "Waarom?"));
  const offers = el.querySelector(".travel-offers")!;
  expect(offers.textContent).toContain("0,5% cashback");
  expect(offers.textContent).toMatch(/crypto/i);
  // 1,5% minus 0,5% would have put Wirex above Revolut's 1%; it does not.
  const rows = [...offers.querySelectorAll(".travel-journey-name")].map((n) => n.textContent ?? "");
  expect(rows.indexOf("212 Card")).toBeLessThan(rows.findIndex((r) => r.includes("Wirex")));
});

test("with no catalogue there is no market section and no invented cash price", () => {
  const el = renderWithCatalogue({ catalogue: [] });
  click(byText("button", "Waarom?"));
  expect(el.querySelector(".travel-offers")).toBeNull();
  expect(el.querySelector(".travel-cash")!.textContent).toContain("onbekend");
});

test("for a euro destination the cash line does not quote a foreign-currency tariff", () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <TravelBlock {...props} accounts={travelAccounts} facts={travelFacts} txs={[]} catalogue={CATALOGUE} />,
    );
  });
  act(() => setNativeValue(container!.querySelector("select")!, "ES"));

  const winner = container!.querySelector(".travel-winner")!;
  expect(winner.textContent).toContain("Pinnen:");
  expect(winner.textContent).not.toContain("€ 6,30");
  click(byText("button", "Waarom?"));
  // Nothing to switch to either — there is no conversion to be cheaper at.
  expect(container.querySelector(".travel-offers")).toBeNull();
});
