// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Account, CatalogueEntryLike } from "@lavega/core";
import Globe, { DEFAULT_SIZE, globeViewport } from "./Globe";
import Valuta from "../views/Valuta";
import { globeFrame, project } from "../globeProjection.js";
import { countryById, countryFocus } from "../worldMap.js";

/* Wat hier bewaakt wordt is niet "tekent de bol 236 landen" — dat kan jsdom niet
 * eens, er is geen 2D-context — maar de vier manieren waarop een aanklikbare
 * wereld stil kan gaan liegen. Ze stonden in de test van de platte kaart en ze
 * gelden onveranderd, want de opdracht was de kaart vervangen en niet het gedrag:
 *
 *  1. een eurozone-land dat als een geslaagde, gratis omwisseling eindigt. Er is
 *     daar geen omwisseling; er hoort dus ook geen percentage op het scherm te
 *     staan, ook niet 0%.
 *  2. een valuta waarvan wij geen koers hebben die als doelvaluta wordt gezet.
 *     Dan staat er "onbekend" zonder oorzaak.
 *  3. een land met twee valuta's waarvan de bol er eigenhandig één pakt.
 *  4. een wereld die alleen met een muis werkt.
 *
 * Daar komt bij wat NIEUW is aan een bol en op een platte kaart niet kon
 * bestaan: de helft van de wereld is niet in beeld. Dus wordt hier ook gemeten
 * dat een klik op het doek het land onder de cursor oplevert, dat slepen niets
 * kiest, en dat een land uit de lijst de bol echt naar zich toe draait — met als
 * bewijs dat datzelfde punt vóór het draaien aan de ACHTERKANT zat.
 *
 * De bol wordt twee keer gemonteerd: los (dan is `onPick` te zien) en ín Valuta
 * (dan is te zien wat de BEREKENING ervan maakt — en dat is de enige plek waar een
 * 0%-route kan opduiken). */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** De valuta's die de Valuta-tab kent als de koersaanroep mislukt
 *  (FX_RATE_FALLBACK). Expliciet, zodat deze test niet meebeweegt met een
 *  uitbreiding van de ECB-lijst. */
const SUPPORTED = ["EUR", "USD", "GBP", "CHF", "JPY", "SEK", "NOK", "DKK", "PLN", "CAD", "AUD"];

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  /* jsdom heeft geen 2D-context. Dat is precies de toestand die de component moet
   * overleven — geen doek, maar de lijst en het antwoord werken door — en door hem
   * hier expliciet te maken staat er geen "Not implemented" van jsdom in het
   * verslag. Vijftien van die regels is ruis waarin een echte fout zich verstopt. */
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
  // Valuta haalt de middenkoers op. Hier niet: de test moet over de bol gaan,
  // niet over het netwerk, en de terugval is een geldige toestand.
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("geen netwerk in de test"))));
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

/** Een land in de lijst ernaast. Die lijst is de tweede besturing en niet een
 *  suggestiedoosje, dus elk land staat er altijd in. */
function option(el: HTMLElement, id: string): HTMLElement {
  const li = el.querySelector<HTMLElement>(`#lv-globe-list [data-country="${id}"]`);
  if (!li) throw new Error(`${id} staat niet in de landenlijst`);
  return li;
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

/** Een pointer-gebeurtenis op het doek. jsdom heeft geen PointerEvent, maar React
 *  luistert op de naam van de gebeurtenis en leest clientX/clientY en pointerId
 *  van het native event — een MouseEvent met die naam is dus voldoende, en dat is
 *  eerlijker dan de handlers rechtstreeks aanroepen. */
function pointer(node: Element, type: string, x: number, y: number) {
  act(() => {
    const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
    Object.defineProperty(e, "pointerId", { value: 1 });
    node.dispatchEvent(e);
  });
}

/** Klikken op de bol: neer en op zonder ertussen te bewegen. */
function tapGlobe(el: HTMLElement, x: number, y: number) {
  const canvas = el.querySelector('[data-testid="bol-canvas"]')!;
  pointer(canvas, "pointerdown", x, y);
  pointer(canvas, "pointerup", x, y);
}

/** Waar een punt op aarde op het doek terechtkomt als de bol op `rot` staat. In
 *  jsdom is er geen layout, dus `getBoundingClientRect()` is 0×0 en rekent de
 *  component 1:1 met clientX/clientY — precies wat dit bruikbaar maakt. */
const VIEW = globeViewport(DEFAULT_SIZE);
function screenAt(lon: number, lat: number, rot: { lon: number; lat: number }) {
  return project(lon, lat, globeFrame(rot, VIEW));
}

const answer = (el: HTMLElement) => el.querySelector('[data-testid="bol-antwoord"]')!.textContent ?? "";
const readout = (el: HTMLElement) => el.querySelector('[data-testid="bol-readout"]')!.textContent ?? "";

/** Elke knop met deze tekst, ongeacht waar hij in het antwoordpaneel staat. */
function button(el: HTMLElement, text: string): HTMLButtonElement {
  const found = [...el.querySelectorAll("button")].find((b) => (b.textContent ?? "").includes(text));
  if (!found) throw new Error(`geen knop met "${text}"`);
  return found as HTMLButtonElement;
}

function type(el: HTMLElement, text: string) {
  const input = el.querySelector<HTMLInputElement>("#lv-globe-q")!;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}

// ---------------------------------------------------------------- los gemonteerd

test("een prijsbaar land zet de doelvaluta", () => {
  const onPick = vi.fn();
  const el = mount(<Globe value="USD" from="EUR" onPick={onPick} supported={SUPPORTED} />);

  click(option(el, "JP"));

  expect(onPick).toHaveBeenCalledWith("JPY");
  expect(onPick).toHaveBeenCalledTimes(1);
  expect(answer(el)).toContain("JPY");
  // Precies één land is het gekozen land.
  expect(el.querySelectorAll('#lv-globe-list [aria-selected="true"]').length).toBe(1);
  expect(option(el, "JP").getAttribute("aria-selected")).toBe("true");
});

test("een eurozone-land zegt dat er niets te wisselen valt, zonder een percentage", () => {
  const onPick = vi.fn();
  const el = mount(<Globe value="USD" from="EUR" onPick={onPick} supported={SUPPORTED} />);

  click(option(el, "NL"));

  const text = answer(el);
  expect(text).toContain("niets om te wisselen");
  expect(text).toContain("geen tarief");
  // Geen tarief betekent ook geen 0%: er hoort helemaal geen percentage te staan.
  expect(text).not.toMatch(/%/);
  expect(text).not.toMatch(/gratis/i);
  expect(onPick).toHaveBeenCalledWith("EUR");
});

test("een land zonder koers noemt de oorzaak en laat de doelvaluta staan", () => {
  const onPick = vi.fn();
  const el = mount(<Globe value="USD" from="EUR" onPick={onPick} supported={SUPPORTED} />);

  click(option(el, "CU")); // Cuba betaalt in CUP; daar hebben wij geen koers van

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

test("de live koerslijst beslist wat prijsbaar is, niet de vlag uit de bundel", () => {
  /* Nieuw-Zeeland staat in de bundel als prijsbaar (NZD stond in de ECB-lijst op
   * de dag van de sweep) maar zit niet in de lijst waar de tab vandaag mee rekent.
   * Een bol die dan NZD als doelvaluta zet, zet iets wat het <select> ernaast niet
   * kent — dat is een leeg vakje en een "onbekend" zonder uitleg. */
  expect(countryById("NZ")!.currencies).toEqual([{ code: "NZD", priceable: true }]);
  const onPick = vi.fn();
  const el = mount(<Globe value="USD" from="EUR" onPick={onPick} supported={SUPPORTED} />);

  click(option(el, "NZ"));

  expect(onPick).not.toHaveBeenCalled();
  expect(answer(el)).toContain("geen koers");
  expect(answer(el)).toContain("NZD");
});

test("een land met meer dan één valuta vraagt welke, en kiest zelf niet", () => {
  const onPick = vi.fn();
  const el = mount(<Globe value="EUR" from="EUR" onPick={onPick} supported={SUPPORTED} />);

  click(option(el, "PA")); // Panama: USD kennen wij, PAB niet

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

test("de lijst bereikt elk land, ook de landen die niet op de bol staan", () => {
  const onPick = vi.fn();
  const el = mount(<Globe value="USD" from="EUR" onPick={onPick} supported={SUPPORTED} />);

  // Alle 249 landen staan er bij een leeg zoekveld in: de lijst is de tweede
  // besturing en niet een suggestiedoosje dat pas iets doet als je het goede
  // woord al weet.
  expect(el.querySelectorAll("#lv-globe-list [data-country]").length).toBe(249);

  type(el, "Gibraltar");
  const list = el.querySelector('[data-testid="bol-landen"]')!;
  expect(list.textContent).toContain("niet op de bol"); // Gibraltar heeft geen vlak
  click(list.querySelector("[data-country]")!);

  expect(answer(el)).toContain("GIP");
  // En het paneel zegt waarom er niets op de bol te zien is, in plaats van een
  // bol te laten zien waarop niets gebeurde.
  expect(answer(el)).toContain("niet getekend");
});

test("de lijst is met het toetsenbord te bedienen", () => {
  const onPick = vi.fn();
  const el = mount(<Globe value="USD" from="EUR" onPick={onPick} supported={SUPPORTED} />);
  const input = type(el, "Japan");

  const active = () => el.querySelector('#lv-globe-list [data-active="1"]')?.getAttribute("data-country") ?? null;
  expect(active()).toBeNull();

  press(input, "ArrowDown");
  expect(active()).toBe("JP");
  expect(input.getAttribute("aria-activedescendant")).toBe("lv-globe-opt-JP");

  press(input, "Enter");
  expect(onPick).toHaveBeenCalledWith("JPY");
  // En zonder hover staat de naam plus de valutacode er nog — dat is wat een
  // telefoon nodig heeft, want daar bestaat hover niet.
  expect(readout(el)).toContain("Japan");
  expect(readout(el)).toContain("JPY");
});

// -------------------------------------------------------------------- de bol zelf

test("klikken op de bol kiest het land onder de cursor", () => {
  const onPick = vi.fn();
  const el = mount(<Globe value="USD" from="EUR" onPick={onPick} supported={SUPPORTED} />);

  // Eerst naar Frankrijk, zodat de stand van de bol vaststaat en Zwitserland in
  // beeld is. Frankrijk is euro, dus daarna is elke CHF-aanroep van de klik.
  click(option(el, "FR"));
  onPick.mockClear();

  const rot = countryFocus("FR")!.center;
  const ch = countryById("CH")!.pin!;
  const p = screenAt(ch[0], ch[1], { lon: rot[0], lat: rot[1] });
  expect(p.front).toBe(true);

  tapGlobe(el, p.x, p.y);

  expect(onPick).toHaveBeenCalledWith("CHF");
  expect(answer(el)).toContain("Zwitserland");
  expect(readout(el)).toContain("CHF");
});

test("slepen draait de bol en kiest niets", () => {
  const onPick = vi.fn();
  const el = mount(<Globe value="USD" from="EUR" onPick={onPick} supported={SUPPORTED} />);
  click(option(el, "FR"));
  onPick.mockClear();

  const rot = countryFocus("FR")!.center;
  const ch = countryById("CH")!.pin!;
  const p = screenAt(ch[0], ch[1], { lon: rot[0], lat: rot[1] });

  const canvas = el.querySelector('[data-testid="bol-canvas"]')!;
  pointer(canvas, "pointerdown", p.x, p.y);
  expect(canvas.getAttribute("data-dragging")).toBe("1");
  pointer(canvas, "pointermove", p.x + 60, p.y + 10);
  pointer(canvas, "pointerup", p.x + 60, p.y + 10);

  // Een sleep is geen keuze. Zonder dit onderscheid verandert de doelvaluta bij
  // elke keer dat je de bol een kwartslag draait.
  expect(onPick).not.toHaveBeenCalled();
  expect(answer(el)).toContain("Frankrijk");
  expect(canvas.getAttribute("data-dragging")).toBeNull();
});

test("een klik zonder land noemt de oorzaak en verandert niets", () => {
  const onPick = vi.fn();
  const el = mount(<Globe value="USD" from="EUR" onPick={onPick} supported={SUPPORTED} />);
  click(option(el, "FR"));
  onPick.mockClear();

  const rot = countryFocus("FR")!.center;
  // De Golf van Biskaje: binnen de schijf, geen land in onze grenzen.
  const zee = screenAt(-4, 46, { lon: rot[0], lat: rot[1] });
  tapGlobe(el, zee.x, zee.y);

  expect(onPick).not.toHaveBeenCalled();
  let text = el.querySelector('[data-testid="bol-misser"]')!.textContent ?? "";
  expect(text).toContain("geen land");
  // De melding zegt óók dat de vorige keuze staat blijven — anders lijkt de klik
  // niet aangekomen.
  expect(text).toContain("Frankrijk blijft gekozen");
  // En hij noemt de andere mogelijke oorzaak: een land dat wij niet tekenen staat
  // wél in de lijst.
  expect(text).toContain("lijst");

  // Naast de bol geklikt is een ander antwoord dan zee: daar is geen bol.
  tapGlobe(el, 4, 4);
  text = el.querySelector('[data-testid="bol-misser"]')!.textContent ?? "";
  expect(text).toContain("naast de bol");
  expect(onPick).not.toHaveBeenCalled();
});

test("een land uit de lijst draait de bol naar zich toe", () => {
  const onPick = vi.fn();
  const el = mount(<Globe value="USD" from="EUR" onPick={onPick} supported={SUPPORTED} />);

  const nz = countryById("NZ")!.pin!;
  const focus = countryFocus("NZ")!.center;

  /* Bij de beginstand zit Nieuw-Zeeland aan de ACHTERKANT van de bol. Dat is de
   * reden dat toedraaien moet: zonder dat vind je met de zoekbalk een land dat
   * je vervolgens niet kunt zien of aanklikken. */
  const voor = screenAt(nz[0], nz[1], { lon: 8, lat: 30 });
  expect(voor.front).toBe(false);

  click(option(el, "NZ"));

  // Na het kiezen staat het land in het midden, en dus is de speld aanklikbaar.
  const na = screenAt(nz[0], nz[1], { lon: focus[0], lat: focus[1] });
  expect(na.front).toBe(true);
  tapGlobe(el, na.x, na.y);
  expect(answer(el)).toContain("Nieuw-Zeeland");
});

test("de pijltjestoetsen draaien de bol", () => {
  const onPick = vi.fn();
  const el = mount(<Globe value="USD" from="EUR" onPick={onPick} supported={SUPPORTED} />);
  const canvas = el.querySelector('[data-testid="bol-canvas"]')!;

  /* De beginstand staat op 8° oost / 30° noord, en dat is Algerije. Twee keer naar
   * rechts is 20° oost erbij: dan staat Egypte in het midden. Deze test meet dus
   * twee dingen tegelijk — dat de toetsen de stand echt verzetten, en dat het
   * aanwijzen die nieuwe stand gebruikt. */
  tapGlobe(el, VIEW.cx, VIEW.cy);
  expect(answer(el)).toContain("Algerije");

  press(canvas, "ArrowRight");
  press(canvas, "ArrowRight");
  tapGlobe(el, VIEW.cx, VIEW.cy);
  expect(answer(el)).toContain("Egypte");
  // Geen van beide heeft een koers bij ons, dus de doelvaluta hoort niet te
  // bewegen — dat is dezelfde regel als bij de lijst.
  expect(onPick).not.toHaveBeenCalled();
});

test("het doek heeft een beschrijving en wijst naar de lijst", () => {
  const el = mount(<Globe value="USD" from="EUR" onPick={vi.fn()} supported={SUPPORTED} />);
  const canvas = el.querySelector('[data-testid="bol-canvas"]')!;
  const label = canvas.getAttribute("aria-label") ?? "";
  // Een canvas is voor een schermlezer leeg. Dan moet er tenminste staan wat het
  // is en waar het wél te doen is.
  expect(label).toContain("Wereldbol");
  expect(label).toContain("landenlijst");
  expect(canvas.getAttribute("tabindex")).toBe("0");
  expect(el.querySelector('#lv-globe-list[role="listbox"]')).not.toBeNull();
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

  click(option(el, "NL"));

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

  click(option(el, "JP"));

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

  click(option(el, "CU"));

  expect(naar().value).toBe(before);
  expect(answer(el)).toContain("CUP");
  expect(answer(el)).toContain("geen koers");
});
