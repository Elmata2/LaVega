// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Account, CatalogueEntryLike } from "@lavega/core";
import WorldMap from "./WorldMap";
import Valuta from "../views/Valuta";

/* Wat hier bewaakt wordt is niet "tekent de kaart 236 vlakken", maar de vier
 * manieren waarop een klikbare kaart stil kan gaan liegen:
 *
 *  1. Een eurozone-land dat als een geslaagde, gratis omwisseling eindigt. Er is
 *     daar geen omwisseling; er hoort dus ook geen percentage op het scherm te
 *     staan, ook niet 0%.
 *  2. Een valuta waarvan wij geen koers hebben die als doelvaluta wordt gezet.
 *     Dan staat er "onbekend" zonder oorzaak, en de derde regel zegt dat een
 *     melding de echte oorzaak noemt.
 *  3. Een land met twee valuta's waarvan de kaart er eigenhandig één pakt.
 *  4. Een kaart die alleen met een muis werkt.
 *
 * De kaart wordt daarom twee keer gemonteerd: los (dan is `onPick` te zien) en
 * ín Valuta (dan is te zien wat de BEREKENING ervan maakt — en dat is de enige
 * plek waar een 0%-route kan opduiken). */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** De valuta's die de Valuta-tab kent als de koersaanroep mislukt
 *  (FX_RATE_FALLBACK). Expliciet, zodat deze test niet meebeweegt met een
 *  uitbreiding van de ECB-lijst. */
const SUPPORTED = ["EUR", "USD", "GBP", "CHF", "JPY", "SEK", "NOK", "DKK", "PLN", "CAD", "AUD"];

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  // Valuta haalt de middenkoers op. Hier niet: de test moet over de kaart gaan,
  // niet over het netwerk, en de terugval is een geldige toestand.
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("geen netwerk in de test"))));
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.unstubAllGlobals();
});

function mount(ui: ReactElement): HTMLDivElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  const el = host;
  act(() => {
    root = createRoot(el);
    root.render(ui);
  });
  return el;
}

function land(el: HTMLElement, id: string): Element {
  const path = el.querySelector(`[data-country="${id}"]`);
  if (!path) throw new Error(`${id} staat niet op de kaart`);
  return path;
}

function click(node: Element) {
  act(() => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function press(node: Element, key: string) {
  act(() => {
    node.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

const answer = (el: HTMLElement) => el.querySelector('[data-testid="kaart-antwoord"]')!.textContent ?? "";
const readout = (el: HTMLElement) => el.querySelector('[data-testid="kaart-readout"]')!.textContent ?? "";

/** Elke knop met deze tekst, ongeacht waar hij in het antwoordpaneel staat. */
function button(el: HTMLElement, text: string): HTMLButtonElement {
  const found = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(text));
  if (!found) throw new Error(`geen knop met "${text}"`);
  return found as HTMLButtonElement;
}

// ---------------------------------------------------------------- los gemonteerd

test("klikken op een prijsbaar land zet de doelvaluta", () => {
  const onPick = vi.fn();
  const el = mount(<WorldMap value="USD" from="EUR" onPick={onPick} supported={SUPPORTED} />);

  click(land(el, "JP"));

  expect(onPick).toHaveBeenCalledWith("JPY");
  expect(onPick).toHaveBeenCalledTimes(1);
  expect(answer(el)).toContain("JPY");
  // Duidelijk gemarkeerd: het gekozen land is het enige met data-selected.
  expect(el.querySelectorAll('[data-selected="1"][data-country]').length).toBe(1);
  expect(land(el, "JP").getAttribute("data-selected")).toBe("1");
});

test("een eurozone-land zegt dat er niets te wisselen valt, zonder een percentage", () => {
  const onPick = vi.fn();
  const el = mount(<WorldMap value="USD" from="EUR" onPick={onPick} supported={SUPPORTED} />);

  click(land(el, "NL"));

  const text = answer(el);
  expect(text).toContain("niets om te wisselen");
  expect(text).toContain("geen tarief");
  // Geen tarief betekent ook geen 0%: er hoort helemaal geen percentage te staan.
  expect(text).not.toMatch(/%/);
  expect(text).not.toMatch(/gratis/i);
  expect(onPick).toHaveBeenCalledWith("EUR");
});

test("een niet-prijsbaar land noemt de oorzaak en laat de doelvaluta staan", () => {
  const onPick = vi.fn();
  const el = mount(<WorldMap value="USD" from="EUR" onPick={onPick} supported={SUPPORTED} />);

  click(land(el, "CU")); // Cuba betaalt in CUP; daar hebben wij geen koers van

  const text = answer(el);
  expect(text).toContain("CUP");
  expect(text).toContain("geen koers");
  expect(text).toContain("geen nul");
  // De melding moet zeggen wat er NIET gebeurd is, anders zoekt iemand de
  // verandering in de berekening die er niet is.
  expect(text).toContain("niet veranderd");
  expect(text).toContain("USD");
  expect(onPick).not.toHaveBeenCalled();
  expect(text).not.toMatch(/%/);
});

test("een land met meer dan één valuta vraagt welke, en kiest zelf niet", () => {
  const onPick = vi.fn();
  const el = mount(<WorldMap value="EUR" from="EUR" onPick={onPick} supported={SUPPORTED} />);

  click(land(el, "PA")); // Panama: USD kennen wij, PAB niet

  expect(answer(el)).toContain("Welke bedoel je?");
  expect(onPick).not.toHaveBeenCalled();

  // De valuta zonder koers is wél aanwijsbaar — en zegt dan waarom er niets
  // verandert, in plaats van een knop te zijn die niets doet.
  click(button(el, "PAB"));
  expect(onPick).not.toHaveBeenCalled();
  expect(answer(el)).toContain("geen koers");

  click(button(el, "USD"));
  expect(onPick).toHaveBeenCalledWith("USD");
});

test("de kaart is met het toetsenbord te bedienen", () => {
  const onPick = vi.fn();
  const el = mount(<WorldMap value="USD" from="EUR" onPick={onPick} supported={SUPPORTED} />);

  // Eén tabstop, niet 236: de kaart mag de rest van de pagina niet onbereikbaar
  // maken, maar hij moet wel bereikbaar ZIJN.
  const stops = () => [...el.querySelectorAll('[data-country][tabindex="0"]')];
  expect(stops().length).toBe(1);

  const first = stops()[0].getAttribute("data-country");
  press(stops()[0], "ArrowRight");
  expect(stops().length).toBe(1);
  expect(stops()[0].getAttribute("data-country")).not.toBe(first);

  press(stops()[0], "Home");
  expect(stops()[0].getAttribute("data-country")).toBe(first);

  // Enter kiest het land waar de focus staat.
  press(land(el, "JP"), "Enter");
  expect(onPick).toHaveBeenCalledWith("JPY");
  // En zonder hover staat de naam plus de valutacode er nog — dat is wat een
  // telefoon nodig heeft, want daar bestaat hover niet.
  expect(readout(el)).toContain("Japan");
  expect(readout(el)).toContain("JPY");
});

test("de zoeklijst bereikt ook de landen zonder eigen vlak op de kaart", () => {
  const onPick = vi.fn();
  const el = mount(<WorldMap value="USD" from="EUR" onPick={onPick} supported={SUPPORTED} />);

  expect(el.querySelector('[data-country="GI"]')).toBeNull(); // Gibraltar heeft geen vlak

  const input = el.querySelector<HTMLInputElement>("#lv-map-q")!;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, "Gibraltar");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });

  const results = el.querySelector('[data-testid="kaart-zoekresultaten"]')!;
  expect(results.textContent).toContain("staat niet op de kaart");
  click(results.querySelector("button")!);
  expect(answer(el)).toContain("GIP");
});

// ------------------------------------------------------- ín de bestaande tab

const accounts: Account[] = [
  {
    key: "a1",
    iban: "NL00TEST0000000000",
    name: "Betaalrekening",
    bank: "Testbank",
    entity: "Privé",
    currency: "EUR",
    balance: 2500,
    type: "Betaalrekening",
  },
];

/** Eén onderbouwd tarief, zodat de berekening iets te zeggen heeft — en de test
 *  dus kan zien of dat iets bij een eurozone-land verdwijnt in plaats van 0%
 *  te worden. */
const entries: CatalogueEntryLike[] = [
  {
    id: "testbank-betaalpas",
    product: "Testbank betaalpas",
    issuer: "Testbank N.V.",
    fields: {
      fxFeePct: {
        value: 1.2,
        route: "provider-page",
        sourceUrl: "https://voorbeeld.test/tarieven",
        checkedAt: "2026-08-01",
        conditions: "geldt voor alle valuta",
        conditionsKnown: true,
      },
    },
  },
];

test("een eurozone-land zet in de berekening geen 0%-route", () => {
  const el = mount(<Valuta accounts={accounts} facts={[]} entries={entries} />);
  const uitleg = () => el.querySelector('[data-testid="uitleg"]')!.textContent ?? "";

  // Uitgangspositie: EUR → USD, dus er is een tarief en dat staat er als percentage.
  expect(uitleg()).toMatch(/%/);
  expect(uitleg()).toContain("Testbank");

  click(land(el, "NL"));

  const naar = [...el.querySelectorAll<HTMLSelectElement>("select")].find(
    (s) => s.getAttribute("aria-label") === "Naar valuta",
  )!;
  expect(naar.value).toBe("EUR");

  // Er is geen omwisseling, dus er is geen tarief — geen 1,2% en ook geen 0%.
  expect(uitleg()).toContain("zonder omwisseling");
  expect(uitleg()).not.toMatch(/%/);
  // En er wordt geen bank als gerekende route opgevoerd.
  expect(el.querySelector('[data-testid="gekozen-route"]')).toBeNull();
  expect(el.querySelector('[data-testid="goedkoper"]')).toBeNull();
});

test("een prijsbaar land laat de berekening met die valuta verder rekenen", () => {
  const el = mount(<Valuta accounts={accounts} facts={[]} entries={entries} />);

  click(land(el, "JP"));

  const naar = [...el.querySelectorAll<HTMLSelectElement>("select")].find(
    (s) => s.getAttribute("aria-label") === "Naar valuta",
  )!;
  expect(naar.value).toBe("JPY");
  expect(el.querySelector('[data-testid="arrives"]')!.textContent).not.toBe("onbekend");
});

test("een land zonder koers verandert de berekening niet", () => {
  const el = mount(<Valuta accounts={accounts} facts={[]} entries={entries} />);
  const naar = () =>
    [...el.querySelectorAll<HTMLSelectElement>("select")].find((s) => s.getAttribute("aria-label") === "Naar valuta")!;
  const before = naar().value;

  click(land(el, "CU"));

  expect(naar().value).toBe(before);
  expect(answer(el)).toContain("CUP");
  expect(answer(el)).toContain("geen koers");
});
