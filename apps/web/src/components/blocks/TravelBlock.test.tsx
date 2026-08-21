// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test } from "vitest";
import type { Account, CatalogValue, LearnedFact } from "@lavega/core";
import { makeFact, planTravel, TRAVEL_AGENT } from "@lavega/core";
import TravelBlock, { termsState, type TravelBlockProps, figureAge, TermsNotice, ROUTES_HEADING } from "./TravelBlock";
// De klassenamen van de uitklap uit hun eigen bestand, niet overgetikt: een
// hernoeming daar komt dan ook hier langs in plaats van deze test stil te laten
// slagen op een klasse die niet meer bestaat.
import { TOONMEER_CLASS } from "../ToonMeer";
import type { CatalogueEntryLike } from "@lavega/core";
import { formatEuro } from "../../format";
import { accounts, ASOF, txs } from "./fixtures";

/* The travel plan itself is covered by @lavega/core's travel tests; this pins
 * how the BLOCK presents it: one answer first, the priced routes behind the
 * shared "toon meer" fold, and an unknown route that says so instead of reading
 * as free. (De knop heette "Waarom?" tot review 4; zie DE UITKLAP hieronder.) */

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
  expect(html).toContain("Travel Agent");
  expect(html).not.toContain("reisagent");
  expect(html).toContain("Ik reis vanuit NL naar");
  expect(html).toContain("Kies een land");
  // No destination picked, so there is no plan and no terms notice yet.
  expect(html).not.toContain("travel-terms");
});

/* --- The block with a destination. Needs a real DOM because the destination,
 * the fold and the corrections are all interactions. --- */

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

/* ── DE UITKLAP ───────────────────────────────────────────────────────────────
 *
 * De knop "Waarom?" is weg; het blok gebruikt het gedeelde <ToonMeer>
 * (components/ToonMeer.tsx) en dat staat op <details>/<summary>. Twee dingen
 * zijn daardoor anders, en ze hebben allebei een test hier laten omvallen:
 *
 * 1. DICHT IS NIET WEG. De kinderen van een <details> blijven in de DOM; de
 *    browser verbergt ze en houdt ze uit de schermlezer. `not.toContain(...)`
 *    faalt dus terwijl het onderdeel precies goed werkt. Getest wordt de STAND
 *    (`details.open`) en de PLAATS (staat het in het paneel of ervoor).
 * 2. HET FRONTPANEEL IS `.travel-winner`, en de uitklap staat er bewust naast in
 *    plaats van erin. Anders telt `winnerText` de hele onderbouwing mee en meldt
 *    een telling "één keer" over een scherm waar het bedrag vier keer staat —
 *    precies de dubbeling wegtoetsen die de test moest vinden.
 */
const fold = (c: HTMLElement = container!): HTMLDetailsElement =>
  c.querySelector<HTMLDetailsElement>(`details.${TOONMEER_CLASS.root}`)!;
const foldPanel = (c: HTMLElement = container!): HTMLElement =>
  c.querySelector<HTMLElement>(`.${TOONMEER_CLASS.panel}`)!;
const foldText = (c: HTMLElement = container!): string => foldPanel(c).textContent ?? "";

/** Klik de samenvatting open. jsdom voert de KLIK-activering van een <summary>
 *  wel uit; de toetsactivering niet, dus een Enter-test hier zou niets bewijzen
 *  (zie de waarschuwingen boven in ToonMeer.tsx). */
function openFold(c: HTMLElement = container!): HTMLElement {
  click(fold(c).querySelector("summary")!);
  return foldPanel(c);
}

/** Render the block and pick the United States. De uitklap blijft DICHT: dat is
 *  de begintoestand van het scherm, en een test die hem meteen opent kan niet
 *  meer zien wat er vooraan stond. Openen doe je met `openFold()`. */
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

  // The routes and the three sections are detail, not a rival answer: ze staan
  // in het paneel van de uitklap, en die is dicht. Ze staan wél in de DOM — zo
  // werkt <details> — dus getoetst wordt de stand en de plaats, niet afwezigheid.
  expect(fold(c).open).toBe(false);
  expect(c.querySelector(".travel-winner .travel-journeys")).toBeNull();
  expect(foldText(c)).toContain("Bewaren");
  expect(c.querySelector(".travel-winner")!.textContent).not.toContain("Bewaren");
});

test("de uitklap toont de gerangschikte routes, elk met hun drie stappen", () => {
  const c = renderWithDestination();
  openFold();

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
  openFold();

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
  openFold();

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
  openFold();
  expect(c.textContent).not.toContain("ververs eerst de voorwaarden");
});

/* --- B3: the control has to be findable. ---------------------------------
 *
 * Vindbaar is niet hetzelfde als vooraan. B3 ging erover dat de knop in de "…"
 * van de module stond, waar niets erbij zei waarom je hem zou indrukken; review
 * 4 punt 16 zet hem in de uitklap, bij de rest van de onderbouwing. Wat vooraan
 * bleef is de ZIN die de oorzaak noemt — anders staat er een aanbeveling zonder
 * dat het scherm zegt wat er ontbrak toen we hem deden. */

test("de melding met de knop staat in de uitklap, de oorzaak zelf vooraan", () => {
  const c = renderWithDestination({ facts: noFacts, aiAvailable: true });

  const controls = c.querySelector(".module-controls");
  expect(controls).toBeNull(); // it used to hide here

  const notice = c.querySelector(".travel-terms")!;
  expect(notice).not.toBeNull();
  expect(notice.querySelector("button")).not.toBeNull();
  // The notice explains itself: the button never stands on its own.
  expect((notice.textContent ?? "").length).toBeGreaterThan(40);
  expect(foldPanel(c).contains(notice)).toBe(true);

  // De uitklap volgt de samenvatting direct, dus hij wordt in dezelfde blik
  // gelezen — en vooraan staat geen enkele knop meer.
  const winner = c.querySelector(".travel-winner")!;
  expect(winner.nextElementSibling).toBe(fold(c));
  expect(winner.querySelector("button")).toBeNull();

  // De oorzaak wél: één zin, vooraan, zonder de hele melding eromheen.
  expect(c.querySelector(".travel-winner-cause")).not.toBeNull();
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
  openFold();
  const cash = el.querySelector(".travel-cash")!;
  expect(cash.textContent).toContain("Revolut betaalpas");
  // Revolut's fee row says nothing about cash, so the price is missing.
  expect(cash.textContent).toContain("onbekend");
  expect(cash.textContent).not.toContain("gratis");
});

test("cards he does not hold sit in their own section and are never offered to pay with", () => {
  const el = renderWithCatalogue();
  openFold();
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

test("wat hij vandaag kan betalen blijft bestaan, maar staat in de uitklap", () => {
  const el = renderWithCatalogue({ facts: DEARER_OWN });
  // Het woord "vandaag" mocht van hem weg van de voorgrond (review 4, punt 14),
  // en dit is ook letterlijk niet de aanbeveling maar het alternatief.
  const winner = el.querySelector(".travel-winner")!;
  expect(winner.textContent).not.toMatch(/vandaag/i);

  // Verdwijnen doet het niet: hij moet morgenochtend nog steeds kunnen betalen.
  const vandaag = el.querySelector(".travel-winner-today")!;
  expect(vandaag).not.toBeNull();
  expect(foldPanel(el).contains(vandaag)).toBe(true);
  expect(vandaag.textContent).toContain("Revolut betaalpas"); // his own cheapest
  expect(flat(vandaag.textContent ?? "")).toContain("€ 10,00");
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
  openFold();
  const offers = el.querySelector(".travel-offers")!;
  expect(offers.textContent).toContain("0,5% cashback");
  expect(offers.textContent).toMatch(/crypto/i);
  // 1,5% minus 0,5% would have put Wirex above Revolut's 1%; it does not.
  const rows = [...offers.querySelectorAll(".travel-journey-name")].map((n) => n.textContent ?? "");
  expect(rows.indexOf("212 Card")).toBeLessThan(rows.findIndex((r) => r.includes("Wirex")));
});

test("with no catalogue there is no market section and no invented cash price", () => {
  const el = renderWithCatalogue({ catalogue: [] });
  openFold();
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
  openFold();
  // Nothing to switch to either — there is no conversion to be cheaper at.
  expect(container.querySelector(".travel-offers")).toBeNull();
});

/* ══════════════════ wat de kaart zelf kost, op het scherm ═══════════════════
 *
 * De rekensom staat in core (`netBenefit`, `accountCosts`) en is daar getest.
 * Deze tests pinnen dat ze het SCHERM bereikt, met de prijs en de periode als
 * eigen velden — en dat is geen formaliteit: de kaartprijs kwam alleen mee in
 * core's kopzin, en `termsHeadline` hierboven vervangt die hele zin zodra er geen
 * beprijsde eigen route is. Dat is de begintoestand van elke nieuwe gebruiker, en
 * dus precies het geval waarvoor de kostenlane die zin schreef.
 *
 * Drie toestanden, drie andere dingen op het scherm:
 *   kosten bekend, netto positief  → het nettobedrag, met de aftrek erbij
 *   kosten bekend, netto nul of −  → geen aanbeveling, met de reden in euro's
 *   kosten onbekend                → bruto, en het woord "netto" valt daar niet
 */

/** Het `accountFee`-veld zoals het echte artefact het draagt: een bedrag mét een
 *  periode. `CatalogValue` kent die periode niet — de kostenlane leest het veld
 *  als `unknown` en bepaalt de eenheid zelf (`readPeriod`), juist omdat een bedrag
 *  zonder eenheid stilzwijgend maandelijks noemen een factor twaalf scheelt.
 *  Vandaar de cast, en niet een opgerekt type. */
const feeField = (value: number, period: "maand" | "jaar"): CatalogValue =>
  ({
    value, period, route: "provider-page", sourceUrl: "https://example.test/tarieven",
    checkedAt: "2026-08-01", conditions: null, conditionsKnown: true,
  } as unknown as CatalogValue);

/** Eén kaart uit de catalogus: een opslag, en optioneel wat de kaart zelf kost.
 *  `fee: null` is een kaart waarvan geen bron de prijs noemt — de meest
 *  voorkomende rij, en de reden dat "onbekend is geen nul" hier hoort te blijken. */
const marketCard = (
  id: string,
  product: string,
  issuer: string,
  fxPct: number,
  fee: { value: number; period: "maand" | "jaar" } | null,
  fxConditions = "Opslag buiten de euro.",
): CatalogueEntryLike => ({
  id, product, issuer, kind: "betaalpas",
  fields: {
    fxFeePct: {
      value: fxPct, route: "provider-page", sourceUrl: "https://example.test/tarieven",
      checkedAt: "2026-08-01", conditionsKnown: true, conditions: fxConditions,
    },
    ...(fee ? { accountFee: feeField(fee.value, fee.period) } : {}),
  },
});

/* Zijn eigen beste route is 1% bij Revolut (DEARER_OWN), dus € 10,00 opslag op
 * € 1.000. Elke kaart hieronder heeft 0% opslag: het verschil is altijd € 10,00
 * bruto, en wat er overblijft hangt alleen nog af van wat de kaart zelf kost. */
const GOEDKOOP = [marketCard("licht", "Testkaart Licht", "Lichtbank N.V.", 0, { value: 1, period: "maand" })];
const TE_DUUR = [marketCard("zwaar", "Testkaart Zwaar", "Zwaarbank N.V.", 0, { value: 16.9, period: "maand" })];
const JAARKAART = [marketCard("jaar", "Testkaart Jaar", "Jaarbank N.V.", 0, { value: 42.95, period: "jaar" })];
const GEEN_PRIJS = [marketCard("stil", "Testkaart Stil", "Stilbank N.V.", 0, null)];

test("de aanbevolen kaart toont zijn eigen prijs, de periode en wat er netto overblijft", () => {
  const el = renderWithDestination({ facts: DEARER_OWN, catalogue: GOEDKOOP });
  const kosten = el.querySelector('[data-testid="travel-pay-kosten"]')!;
  expect(kosten).not.toBeNull();
  // De prijs in de eenheid van de bron, en de periode waarover gerekend is —
  // beide als eigen veld, niet als een getal om uit een zin te vissen.
  expect(kosten.textContent).toContain(`${formatEuro(1)} per maand`);
  expect(kosten.textContent).toContain("gerekend over 1 maand");

  // € 10,00 opslagverschil min € 1,00 kaartkosten = € 9,00 netto, en de aftrek
  // staat erbij zodat hij hem kan navolgen.
  const netto = el.querySelector('[data-testid="travel-pay-kosten-netto"]')!;
  expect(netto.textContent).toContain(formatEuro(9));
  expect(netto.textContent).toContain(formatEuro(10));
  expect(netto.textContent).toContain(formatEuro(1));
});

test("een kaart waarvan de prijs nergens staat komt BRUTO op het scherm, en het woord netto valt niet", () => {
  const el = renderWithDestination({ facts: DEARER_OWN, catalogue: GEEN_PRIJS });
  const winner = el.querySelector(".travel-winner")!;
  // De kaart wordt niet verzwegen: het brutovoordeel staat er. Het komt sinds
  // review 4 uit core's eigen kopzin (gewone spatie) in plaats van uit de
  // "Vandaag"-regel (`Intl`, vaste spatie) — vandaar `flat` aan beide kanten.
  expect(winner.textContent).toContain("Testkaart Stil");
  expect(flat(winner.textContent ?? "")).toContain(flat(formatEuro(10)));

  const kosten = el.querySelector('[data-testid="travel-pay-kosten"]')!;
  expect(kosten.textContent).toContain("Kaartkosten: onbekend");
  expect(kosten.textContent).toContain("staat niet in onze bronnen");
  expect(kosten.textContent).toContain("geen nul");
  expect(kosten.textContent).toContain("bruto");

  // DE REGEL WAAR HET OM GAAT: onbekende kosten hebben geen netto, dus het woord
  // mag in deze hele aanbeveling niet voorkomen.
  expect(winner.textContent).not.toMatch(/netto/i);
  expect(el.querySelector('[data-testid="travel-pay-kosten-netto"]')).toBeNull();
});

test("een kaart die meer kost dan hij oplevert wordt GEEN aanbeveling, en het scherm zegt waarom niet", () => {
  const el = renderWithDestination({ facts: DEARER_OWN, catalogue: TE_DUUR });
  // Zijn eigen kaart blijft de aanbeveling: € 10,00 lagere opslag tegen € 16,90
  // kaartkosten is achteruit, en core kiest daarom zijn eigen route.
  const name = el.querySelector(".travel-winner-name")!.textContent ?? "";
  expect(name).toContain("Revolut betaalpas");
  expect(name).not.toContain("Testkaart Zwaar");

  // En dat mag hij niet zelf hoeven uitrekenen: de kaart valt zichtbaar af.
  const afgevallen = el.querySelector('[data-testid="travel-pay-afgevallen"]')!;
  expect(afgevallen).not.toBeNull();
  expect(afgevallen.textContent).toContain("Niet aangeraden");
  expect(afgevallen.textContent).toContain("Testkaart Zwaar");
  expect(afgevallen.textContent).toContain("0% tegen 1%");
  expect(afgevallen.textContent).toContain(`${formatEuro(16.9)} per maand`);
  expect(afgevallen.textContent).toContain(`${formatEuro(6.9)} duurder`);
});

test("een kaart die hij al heeft krijgt geen kostenregel — die maandprijs loopt toch door", () => {
  // De standaardfeiten geven hem een route van 0%; dan wint zijn eigen kaart en
  // is de kaartprijs geen gevolg van deze keuze. `holdingCost` is dan null en er
  // hoort niets te staan: "kaartkosten € 0,00" zou suggereren dat de kaart gratis
  // is in plaats van al betaald.
  const el = renderWithDestination({ catalogue: GOEDKOOP });
  expect(el.querySelector('[data-testid="travel-pay-kosten"]')).toBeNull();
  expect(el.querySelector(".travel-winner")!.textContent).not.toMatch(/kaartkosten/i);
});

test("een jaarprijs blijft een jaarprijs — er wordt niet door twaalf gedeeld", () => {
  const el = renderWithDestination({ facts: DEARER_OWN, catalogue: JAARKAART });
  const afgevallen = el.querySelector('[data-testid="travel-pay-afgevallen"]')!;
  expect(afgevallen.textContent).toContain(`${formatEuro(42.95)} per jaar`);
  expect(afgevallen.textContent).toContain("over 1 jaar");
  // Je kunt geen twaalfde jaar kaart kopen, en dat staat er ook.
  expect(afgevallen.textContent).toContain("per jaar afgerekend");
  expect(afgevallen.textContent).toContain(`${formatEuro(32.95)} duurder`);
  // € 42,95 / 12 = € 3,58 — het bedrag dat in geen enkel document staat.
  expect(afgevallen.textContent).not.toContain("3,58");
});

test("de lijst met kaarten om te openen zegt per kaart wat ze zelf kost, en waarop de volgorde staat", () => {
  const el = renderWithDestination({
    facts: DEARER_OWN,
    catalogue: [...GOEDKOOP, ...GEEN_PRIJS],
  });
  openFold();
  const offers = el.querySelector(".travel-offers")!;
  expect(offers.textContent).toContain("De volgorde is wat een kaart je op deze reis kost");
  // Een kaart zonder bekende prijs staat met alleen de opslag in de rangschikking;
  // dat is een ondergrens en het scherm zegt het.
  expect(offers.textContent).toContain("ondergrens");

  const licht = el.querySelector('[data-testid="travel-offer-kosten-licht"]')!;
  expect(licht.textContent).toContain(`${formatEuro(1)} per maand`);
  const stil = el.querySelector('[data-testid="travel-offer-kosten-stil"]')!;
  expect(stil.textContent).toContain("Kaartkosten: onbekend");
  expect(stil.textContent).not.toMatch(/netto/i);
});

test("een te dure kaart in de lijst zegt per rij dat ze niets oplevert", () => {
  const el = renderWithDestination({ facts: DEARER_OWN, catalogue: TE_DUUR });
  openFold();
  const geen = el.querySelector('[data-testid="travel-offer-kosten-zwaar-geen"]')!;
  expect(geen).not.toBeNull();
  expect(geen.textContent).toContain("Geen aanbeveling");
  expect(geen.textContent).toContain(formatEuro(16.9));
  expect(geen.textContent).toContain("achteruit");
});

test("de pinaanbeveling noemt de kaartprijs ook als er geen voordeel is om hem tegen af te zetten", () => {
  // Een opnametarief van nul is geen gratis kaart: dit is een kaart die hij moet
  // OPENEN, en die brengt zijn eigen maandnota mee. Van zijn eigen kaarten prijst
  // geen bron een opname, dus er is niets om een voordeel tegen te meten — en dan
  // hoort de prijs er nog steeds te staan, zonder het woord netto.
  const el = renderWithDestination({
    facts: DEARER_OWN,
    catalogue: [marketCard("pin", "Testkaart Pin", "Pinbank N.V.", 0, { value: 2.55, period: "maand" },
      "Geldopnames in vreemde valuta zijn gratis.")],
  });
  const kosten = el.querySelector('[data-testid="travel-pin-kosten"]')!;
  expect(kosten).not.toBeNull();
  expect(kosten.textContent).toContain(`${formatEuro(2.55)} per maand`);
  expect(kosten.textContent).not.toMatch(/netto/i);
});

/* ════════════ HET BEDRAG STAAT PRECIES ÉÉN KEER OP HET SCHERM ═══════════════
 *
 * Core's kopzin droeg zijn eigen kostenstaart ("… kost zelf € 1,00 per maand en
 * dat betaal je minstens één maand, dus je houdt € 9,00 over") en de velden
 * hierboven zetten dezelfde bedragen er nóg een keer onder. Eén bedrag in twee
 * formuleringen leest als twee bedragen.
 *
 * De velden houden het, de kop laat het vallen — omdat `termsHeadline` de kop
 * volledig vervangt zodra er geen beprijsde eigen route is, en dat is de
 * begintoestand van iedere nieuwe gebruiker. Vandaar dat allebei die toestanden
 * hieronder geteld worden en niet alleen de makkelijke.
 */

/** Beide lagen schrijven euro's, maar niet met dezelfde spatie: core met de hand
 *  (gewone spatie) en de UI via `Intl` (vaste spatie, U+00A0). Op het scherm zijn
 *  het twee identieke bedragen. Zonder deze normalisatie ziet een telling ze als
 *  twee verschillende teksten en meldt ze "één keer" terwijl er twee staan — dan
 *  toetst de test precies de dubbeling weg die hij moest vinden. */
const flat = (s: string): string => s.replace(/\u00a0/g, " ");
const times = (haystack: string, needle: string): number =>
  flat(haystack).split(flat(needle)).length - 1;

/** Alles wat VOORAAN staat — de samenvatting, zonder de uitklap. Die staat naast
 *  `.travel-winner` en niet erin, juist zodat deze telling iets betekent. */
const winnerText = (el: HTMLElement): string => el.querySelector(".travel-winner")!.textContent ?? "";
/** Alleen de KOPZIN. `.travel-winner-name` draagt sinds review 4 ook het chipje
 *  "nog niet van jou", en dat woord zou de prefix-vergelijking met core's eigen
 *  zin op het merkteken laten stuklopen in plaats van op een echte herformulering. */
const headlineText = (el: HTMLElement): string =>
  el.querySelector(".travel-winner-headline")!.textContent ?? "";

test("de kaartprijs en het nettobedrag staan één keer in de aanbeveling, in de velden", () => {
  const el = renderWithDestination({ facts: DEARER_OWN, catalogue: GOEDKOOP });
  const winner = winnerText(el);
  // Geprijsd wordt de kaart precies één keer, en het nettobedrag valt één keer.
  // (€ 1,00 zélf komt daarna nog terug in "€ 10,00 voordeel min € 1,00
  // kaartkosten" — dat is geen tweede bewering maar de aftrek erbij, en zonder
  // die regel kan hij ons niet nakijken.)
  expect(times(winner, `${formatEuro(1)} per maand`)).toBe(1);
  expect(times(winner, formatEuro(9))).toBe(1);
  expect(winner).not.toContain("kost zelf");

  // En het is de KOP die loslaat, niet het veld: de kop zegt wat je moet doen,
  // het veld laat zien hoe het bedrag is opgebouwd.
  const kop = headlineText(el);
  expect(times(kop, formatEuro(1))).toBe(0);
  expect(times(kop, formatEuro(9))).toBe(0);
  expect(el.querySelector('[data-testid="travel-pay-kosten"]')!.textContent).toContain(`${formatEuro(1)} per maand`);
  expect(el.querySelector('[data-testid="travel-pay-kosten-netto"]')!.textContent).toContain(formatEuro(9));
});

test("de kop is core's eigen zin minus precies de kostenstaart, niet een eigen zin", () => {
  const el = renderWithDestination({ facts: DEARER_OWN, catalogue: GOEDKOOP });
  const full = planTravel({
    accounts: travelAccounts, txs: [], rates: [], facts: DEARER_OWN, destination: "US", asOf: ASOF,
    catalogue: GOEDKOOP,
  }).headline;
  const shown = headlineText(el);

  // PREFIX, en dat is de hele bewaking: er mag een staart af, er mag niets aan
  // veranderen. Zou de web-laag de zin zelf opnieuw formuleren, dan lopen twee
  // formuleringen van dezelfde aanbeveling uiteen zonder dat iemand het merkt.
  expect(full.startsWith(shown)).toBe(true);
  expect(shown.length).toBeLessThan(full.length);

  // En wat eraf gaat is precies het stuk dat de velden overnemen.
  const dropped = full.slice(shown.length);
  expect(dropped).toContain("kost zelf");
  expect(dropped).toContain("€ 1,00");
  expect(dropped).toContain("€ 9,00");
  expect(dropped).toContain("minstens één maand");
});

test("in de begintoestand van een nieuwe gebruiker staat de prijs er nog steeds, en ook één keer", () => {
  // Geen enkele opslag van hemzelf bekend: dan is er geen beprijsde route, en
  // `termsHeadline` verving vroeger de hele kop — inclusief de staart die core
  // erin had gezet. Dat was de bug: € 1,00 per maand stond dan nergens meer. Nu
  // komt het uit de velden, en uit niets anders.
  const el = renderWithDestination({ facts: [], catalogue: GOEDKOOP });
  expect(times(winnerText(el), formatEuro(1))).toBe(1);
  expect(el.querySelector('[data-testid="travel-pay-kosten"]')!.textContent).toContain(`${formatEuro(1)} per maand`);

  // En sinds review 4 draagt de kop de AANBEVELING, ook in deze toestand. Die
  // stond hier eerder alleen nog in de catalogusregel eronder — en die vouwt nu
  // op, dus zonder deze omkering blijft er "Kaartkosten: € 1,00 per maand" over
  // zonder dat er ergens staat van welke kaart.
  const kop = headlineText(el);
  expect(kop).toContain("Testkaart Licht");
  expect(times(kop, formatEuro(1))).toBe(0);
  // Wat er ontbreekt staat als eigen zin eronder, niet meer op de plek van het
  // antwoord.
  expect(el.querySelector(".travel-winner-cause")!.textContent).toMatch(/voorwaarden/i);
});

test("een onbekende kaartprijs wordt ook één keer gemeld — en blijft 'geen nul'", () => {
  const el = renderWithDestination({ facts: DEARER_OWN, catalogue: GEEN_PRIJS });
  const winner = winnerText(el);
  // Core's staart zei "Wat X zelf kost, staat niet in onze bronnen — dat is geen
  // nul" en het veld zei het er nog eens onder. Eén keer is genoeg; twee keer
  // leest als twee verschillende gaten. Geteld wordt de zin over DEZE kaart, niet
  // het losse "geen nul": de pinregel eronder gebruikt dezelfde woorden voor een
  // ander gat (zijn eigen kaarten, opnemen) en die hoort daar te blijven staan.
  expect(times(winner, "staat niet in onze bronnen")).toBe(1);
  const kop = headlineText(el);
  expect(kop).not.toContain("staat niet in onze bronnen");
  expect(kop).not.toContain("geen nul");

  // Het gat zelf verdwijnt niet: het veld noemt het, en zegt erbij dat het bedrag
  // in de kop dus bruto is.
  const kosten = el.querySelector('[data-testid="travel-pay-kosten"]')!.textContent ?? "";
  expect(kosten).toContain("Kaartkosten: onbekend");
  expect(kosten).toContain("geen nul");
  expect(kosten).toContain("bruto");
});


/* ═════════ HET OVERZICHT IS EXACT EEN SAMENVATTING (app review 4) ═══════════
 *
 * Zijn woorden: "this overview should be exactly a summary." Wat vooraan mag
 * blijven staan is een GESLOTEN lijst: waarmee betaal je, en waar kun je pinnen
 * — plus wat die twee kosten, want een kaart die je moet openen brengt zijn eigen
 * maandnota mee en dat is deel van het antwoord, niet van de onderbouwing.
 *
 * Al het andere zit in één uitklap: de bronregel (punt 12), de uitleg over de
 * catalogus (13), "vandaag" (14), alle routes en de opnamedetails (15) en de knop
 * "voorwaarden verversen" (16).
 *
 * DE VAL DIE HIER AL EEN KEER IS DICHTGEKLAPT, en die deze keer langs een andere
 * weg terugkwam: `termsHeadline` verving core's hele kopzin, en daarmee viel de
 * kostenstaart weg in precies de begintoestand van een nieuwe gebruiker. De
 * vorige ronde redde de PRIJS door hem in eigen velden te zetten. Maar in diezelfde
 * toestand stond de NAAM van de aanbevolen kaart alleen nog in de catalogusregel —
 * en die vouwt nu op. Dan blijft er "Kaartkosten: € 1,00 per maand" over zonder dat
 * ergens staat waarvan. Vandaar dat de aanbeveling de kop wint zodra er één is, en
 * dat de drie kostentoestanden hieronder allemaal dezelfde twee vragen krijgen. */

/** De vrije notitie van een geleerd feit, zoals de bank.nl-parser hem schrijft:
 *  een herhaling van het cijfer plus de bron. Dit is letterlijk de regel die hij
 *  aanwees, en hij komt op het scherm via `Journey.note` — hetzelfde veld dat soms
 *  een voorwaarde draagt. Splitsen op de tekst kan niet, dus wordt er gesplitst op
 *  het veld; zie de opmerkingen in TravelBlock.tsx. */
const BRONREGEL = "1,4% koersopslag Bron: bank.nl-vergelijking, laatst gecontroleerd 15-1-2026.";
const MET_BRON: LearnedFact[] = [
  makeFact({
    agent: TRAVEL_AGENT, subject: "ING betaalpas", key: "fxFeePct", value: "1.4",
    source: "agent", updatedAt: "2026-01-15", note: BRONREGEL,
  }),
];

/** Een catalogus­kaart met een HERKENDE grens aan haar tarief. Dit is de Revolut-
 *  fout in fixture-vorm: 0% dat alleen binnen een maandlimiet geldt. */
const GEDEKT = [
  marketCard("grens", "Testkaart Grens", "Grensbank N.V.", 0, { value: 1, period: "maand" },
    "Tot € 1.000 per maand geen koersopslag, daarna 1%."),
];

test("vooraan staan alleen de twee antwoorden en wat ze kosten", () => {
  const el = renderWithCatalogue({ facts: DEARER_OWN });
  const voor = winnerText(el);

  // Waarmee betaal je — met de prijs van die kaart, want zonder die prijs is het
  // een half advies.
  expect(el.querySelector(".travel-winner .travel-winner-name")).not.toBeNull();
  expect(voor).toContain("212 Card");
  // Waar kun je pinnen.
  expect(el.querySelector(".travel-winner .travel-winner-cash")).not.toBeNull();

  // En verder niets. Elk van deze punten wees hij één voor één aan.
  expect(voor).not.toMatch(/vandaag/i);              // punt 14
  expect(voor).not.toContain("staat in de catalogus"); // punt 13
  expect(voor).not.toContain("Alle routes");           // punt 15
  expect(voor).not.toContain("Bewaren");
  expect(voor).not.toContain("Alle bedragen gelden op");
  expect(el.querySelector(".travel-winner .travel-terms")).toBeNull(); // punt 16
  expect(el.querySelector(".travel-winner button")).toBeNull();

  // ...en het staat er allemaal wél, één klik verder. "Weg van de voorgrond" is
  // niet hetzelfde als weg: de details vindt hij goed.
  const paneel = openFold(el);
  expect(paneel.textContent).toMatch(/vandaag/i);
  expect(paneel.textContent).toContain("staat in de catalogus");
  expect(paneel.textContent).toContain("Alle routes");
  expect(paneel.textContent).toContain("Bewaren");
  expect(paneel.querySelector(".travel-terms")).not.toBeNull();
  expect(paneel.textContent).toContain("Alle bedragen gelden op");
});

test("de uitklap is het gedeelde onderdeel, staat dicht, en opent op een klik", () => {
  const el = renderWithCatalogue({ facts: DEARER_OWN });
  const d = fold(el);

  // Geen tweede variant naast components/ToonMeer.tsx: dit is <details>/<summary>,
  // waar de browser Tab-focus, Enter/Space en het uitspreken van de stand levert.
  expect(d.tagName).toBe("DETAILS");
  expect(d.classList.contains(TOONMEER_CLASS.root)).toBe(true);
  const summary = d.querySelector("summary")!;
  expect(summary.classList.contains(TOONMEER_CLASS.summary)).toBe(true);

  // Standaard dicht — dat is de hele bedoeling. Dicht is niet weg: de inhoud
  // staat in de DOM, de browser verbergt hem.
  expect(d.open).toBe(false);
  expect(d.hasAttribute("open")).toBe(false);
  expect(foldText(el).length).toBeGreaterThan(100);

  // Het label belooft iets. "Meer informatie" belooft niets, en dan is de
  // onderbouwing niet opgevouwen maar zoek.
  const label = d.querySelector(`.${TOONMEER_CLASS.label}`)!.textContent ?? "";
  expect(label).toContain("Alle routes, de bronnen en de voorwaarden");

  openFold(el);
  expect(d.open).toBe(true);
});

test("de bronregel staat niet meer vooraan, maar is wel te vinden", () => {
  const el = renderWithDestination({ facts: MET_BRON, catalogue: GOEDKOOP });

  // Punt 12: "1,4% koersopslag, bron bank.nl-vergelijking" stond direct onder de
  // aanbeveling. Daar staat hij niet meer.
  expect(winnerText(el)).not.toContain("bank.nl-vergelijking");
  expect(el.querySelector(".travel-winner .travel-winner-caveat")).toBeNull();

  // Maar hij is niet weggegooid: een cijfer zonder herkomst is in deze app een
  // gerucht, dus hij staat bovenaan de onderbouwing.
  expect(foldText(el)).toContain(BRONREGEL);
  const caveat = el.querySelector(".travel-winner-caveat")!;
  expect(foldPanel(el).contains(caveat)).toBe(true);
});

test("een voorwaarde bij het tarief dat de kop noemt blijft wél vooraan staan", () => {
  // De Revolut-fout: 0% dat alleen binnen € 1.000 per maand geldt, en een kop die
  // "dat kost je niets op € 1.000" zegt. Dit is een door `fxCaveat` HERKENDE
  // grens en geen vrije brontekst — daarom hoort ze naast het cijfer dat ze
  // begrenst en niet achter de uitklap.
  const el = renderWithDestination({ facts: DEARER_OWN, catalogue: GEDEKT });
  expect(headlineText(el)).toContain("Testkaart Grens");

  const caveat = el.querySelector(".travel-winner > .travel-winner-caveat")!;
  expect(caveat).not.toBeNull();
  expect(caveat.textContent).toContain("Let op");
  expect(caveat.textContent).toMatch(/grens|limiet/i);
  expect(foldPanel(el).contains(caveat)).toBe(false);
});

test("de knop 'voorwaarden verversen' zit in de uitklap, niet in de samenvatting", () => {
  // Punt 16. Alles beprijsd, dus de melding is puur een verversknop met zijn datum.
  const compleet = [
    ...travelFacts,
    fact("ING betaalpas", "convertFeePct", "1.2"),
    fact("ING betaalpas", "transferFreeViaIdeal", "1"),
  ];
  const el = renderWithDestination({ aiAvailable: true, facts: compleet, catalogue: [] });

  expect(el.querySelector(".travel-winner button")).toBeNull();
  const knop = byText("button", "Ververs voorwaarden");
  expect(foldPanel(el).contains(knop)).toBe(true);
  expect(foldText(el)).toContain("Cijfers laatst gecontroleerd op 1 aug 2026");
});

test("zonder aanbeveling neemt de oorzaak de kop, en nooit 'ververs eerst de voorwaarden'", () => {
  // Geen catalogus en geen beprijsde eigen route: er is niets aan te raden, dus is
  // de reden het enige wat er te zeggen valt. Dan staat ze in de kop en NIET ook
  // nog als eigen regel eronder — één keer, of het leest als twee problemen.
  const el = renderWithDestination({ facts: [], catalogue: [], aiAvailable: true });
  const zin = "De voorwaarden van je kaarten zijn nog niet opgezocht.";

  expect(headlineText(el)).toBe(zin);
  expect(el.querySelector(".travel-winner-cause")).toBeNull();
  expect(times(winnerText(el), zin)).toBe(1);
  // Core's eigen zin adviseert een verversing die op een server zonder sleutel
  // niets doet. Die komt hier nooit op het scherm.
  expect(winnerText(el)).not.toContain("ververs eerst de voorwaarden");
});

test("mét een aanbeveling staat die in de kop en de oorzaak als eigen regel eronder", () => {
  const el = renderWithDestination({ facts: [], catalogue: GOEDKOOP, aiAvailable: true });
  const zin = "De voorwaarden van je kaarten zijn nog niet opgezocht.";

  expect(headlineText(el)).toContain("Betaal met Testkaart Licht");
  expect(el.querySelector(".travel-winner-cause")!.textContent).toBe(zin);
  expect(times(winnerText(el), zin)).toBe(1); // niet ook in de kop
});

/* De drie kostentoestanden uit de vorige ronde, nu met de vraag die na het
 * opvouwen bij alle drie hetzelfde moet worden beantwoord: staat de AANBEVELING
 * vooraan, en staat de KAARTPRIJS vooraan — allebei precies één keer? */
const TOESTANDEN = [
  {
    naam: "geen eigen route beprijsd",
    facts: [] as LearnedFact[], catalogue: GOEDKOOP,
    product: "Testkaart Licht", prijs: `${formatEuro(1)} per maand`,
  },
  {
    naam: "wel beprijsd",
    facts: DEARER_OWN, catalogue: GOEDKOOP,
    product: "Testkaart Licht", prijs: `${formatEuro(1)} per maand`,
  },
  {
    naam: "kosten onbekend",
    facts: DEARER_OWN, catalogue: GEEN_PRIJS,
    product: "Testkaart Stil", prijs: "Kaartkosten: onbekend",
  },
];

for (const t of TOESTANDEN) {
  test(`de aanbeveling en de kaartprijs staan allebei precies één keer vooraan — ${t.naam}`, () => {
    const el = renderWithDestination({ facts: t.facts, catalogue: t.catalogue });
    const voor = winnerText(el);

    // DE AANBEVELING, in core's eigen formulering. Wegvallen deed ze toen
    // `termsHeadline` de hele zin verving; twee keer staan deed ze toen de
    // catalogusregel haar eronder herhaalde. Nu: de kop, en verder nergens.
    expect(headlineText(el)).toContain(`Betaal met ${t.product}`);
    expect(times(voor, `Betaal met ${t.product}`)).toBe(1);

    // DE KAARTPRIJS, in de velden van `Kaartkosten` en verder nergens vooraan.
    expect(times(voor, t.prijs)).toBe(1);
    expect(el.querySelector('[data-testid="travel-pay-kosten"]')!.textContent).toContain(t.prijs);

    // Het merkteken blijft vooraan: geen van deze drie kaarten heeft hij, en dat
    // moet zichtbaar anders zijn dan een kaart die hij morgen kan pinnen.
    expect(el.querySelector(".travel-winner-name .badge")).not.toBeNull();

    // En de herkomst is verplaatst, niet weggegooid.
    expect(foldText(el)).toContain("staat in de catalogus");
  });
}

/* ── DE UITWEG MOET BESTAAN WAAR DE MELDING HEM BELOOFT ───────────────────────
 *
 * Drie meldingen eindigen met dezelfde uitweg: typ het percentage zelf, want
 * jouw invoer wordt nooit door een agent overschreven. Ze wezen naar de knop
 * "Waarom?" — en die knop is met deze ronde vervangen door de gedeelde uitklap.
 * Daarmee was het advies een aanwijzing naar iets dat nergens meer op het scherm
 * staat, precies wat een melding niet mag doen: de gebruiker zoekt zich suf naar
 * een knop die is opgeheven, en concludeert dat de app kapot is.
 *
 * Getoetst wordt daarom niet de zin maar de VERWIJZING: staat de genoemde kop
 * er echt, staat hij ONDER de melding (de zin zegt "hieronder"), en staat onder
 * die kop ook echt een invulveld. Alleen de tekst lezen zou opnieuw groen zijn
 * op het moment dat de kop wordt hernoemd. */
function keurDeUitweg(c: HTMLElement) {
  const paneel = foldPanel(c);
  const melding = paneel.querySelector(".travel-terms")!;
  expect(melding).not.toBeNull();
  const tekst = melding.textContent ?? "";

  // De uitweg wordt genoemd, en niet meer met de naam van een knop die weg is.
  expect(tekst).toMatch(/zelf in/);
  expect(tekst).not.toContain("Waarom?");
  expect(tekst).toContain(`“${ROUTES_HEADING}” hieronder`);

  // De kop bestaat, en staat waar de zin zegt dat hij staat.
  const kop = [...paneel.querySelectorAll("h3")].find((h) => h.textContent === ROUTES_HEADING);
  expect(kop).toBeDefined();
  expect(melding.compareDocumentPosition(kop!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  // En eronder staat het veld waar de zin over gaat. Een verwijzing naar een kop
  // zonder invoerveld is nog steeds een advies dat niet uit te voeren is.
  const aanpassen = [...paneel.querySelectorAll("button")].filter((b) =>
    (b.textContent ?? "").includes("aanpassen"),
  );
  expect(aanpassen.length).toBeGreaterThan(0);
  expect(kop!.compareDocumentPosition(aanpassen[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
}

test("zonder sleutel wijst de melding naar de routelijst, niet naar de verdwenen knop", () => {
  keurDeUitweg(renderWithDestination({ facts: noFacts, aiAvailable: false }));
});

test("een zoekopdracht die niets opleverde wijst naar dezelfde bestaande plek", () => {
  const c = renderWithDestination({ facts: noFacts, aiAvailable: true });
  click(byText("button", "Zoek voorwaarden"));
  rerender({ facts: noFacts, aiAvailable: true, busy: true });
  rerender({ facts: noFacts, aiAvailable: true, busy: false });
  expect(foldText(c)).toContain("geen bruikbaar tarief terug");
  keurDeUitweg(c);
});

test("een zoekopdracht die vastliep wijst naar dezelfde bestaande plek", () => {
  const c = renderWithDestination({
    facts: noFacts, aiAvailable: true, pendingTerms: ["ING betaalpas"], termsAsked: 2, termsGaveUp: true,
  });
  expect(foldText(c)).toContain("Er kwam niets meer binnen");
  keurDeUitweg(c);
});
