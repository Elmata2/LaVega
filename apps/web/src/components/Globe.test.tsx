// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
  /* DE ZIN IS WEG, DE EIS NIET. "Dat is een leemte bij ons en het is geen nul"
   * is er op zijn verzoek uit — het was uitleg over ONS in plaats van over zijn
   * geld. Wat die zin moest tegenhouden staat hier nu als eis: er verschijnt
   * geen percentage en geen bedrag, want dat is precies hoe een leemte zich als
   * een nul zou voordoen. Een tekst kan verdwijnen; deze eis niet. */
  expect(text).not.toMatch(/\d\s*%/);
  expect(text).not.toContain("€");
  expect(text).not.toContain("0,00");
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

  // Alle 250 landen staan er bij een leeg zoekveld in (249 ISO-codes plus XK voor
  // Kosovo): de lijst is de tweede besturing en niet een suggestiedoosje dat pas
  // iets doet als je het goede woord al weet.
  expect(el.querySelectorAll("#lv-globe-list [data-country]").length).toBe(250);

  type(el, "Gibraltar");
  const list = el.querySelector('[data-testid="bol-landen"]')!;
  // Gibraltar heeft geen vlak maar wél een labelpunt: de bol kan er dus wel
  // naartoe, er staat alleen niets getekend. Dat is iets anders dan de acht
  // landen hieronder, en de lijst zegt het ook anders.
  expect(list.textContent).toContain("geen vlak, wel een plek");
  click(list.querySelector("[data-country]")!);

  expect(answer(el)).toContain("GIP");
  // En het paneel zegt waarom er niets op de bol te zien is, in plaats van een
  // bol te laten zien waarop niets gebeurde.
  expect(answer(el)).toContain("niet getekend");
});

test("een land waarvan wij de plek niet kennen zegt dat, en draait de bol niet", () => {
  /* De acht landen met vlak noch labelpunt (BV, CC, CX, GF, RE, SJ, UM, YT). Hun
   * valuta-antwoord bestaat wél, dus ze mogen in de lijst blijven staan en
   * gevonden worden — maar dan moet er ook staan dat de kaart ze niet kent. De
   * fout die dit voorkomt is de stille: klikken, en er gebeurt niets. */
  const onPick = vi.fn();
  const el = mount(<Globe value="USD" from="EUR" onPick={onPick} supported={SUPPORTED} />);

  // Eerst een land met een bekende plek, zodat er een stand van de bol is om mee
  // te vergelijken.
  click(option(el, "FR"));
  const canvas = el.querySelector('[data-testid="bol-canvas"]')!;
  const fr = countryFocus("FR")!.center;
  const voor = screenAt(2.35, 48.85, { lon: fr[0], lat: fr[1] });

  type(el, "Bouvet");
  const list = el.querySelector('[data-testid="bol-landen"]')!;
  expect(list.textContent).toContain("geen vlak, plek onbekend");
  click(list.querySelector('[data-country="BV"]')!);

  // Het valuta-antwoord staat er gewoon — Bouveteiland betaalt in Noorse kronen.
  expect(answer(el)).toContain("NOK");
  // En de mededeling over de kaart: wij weten niet waar het ligt.
  expect(answer(el)).toContain("Waar dit land ligt weet LaVega niet");
  // De bol is NIET gedraaid: Parijs staat nog op dezelfde plek op het doek. Zonder
  // deze controle zou een sprong naar [0, 0] — de Golf van Guinee — er van buiten
  // uitzien als "hij deed iets".
  expect(countryFocus("BV")).toBeNull();
  pointer(canvas, "pointermove", voor.x, voor.y);
  expect(readout(el)).toContain("Frankrijk");
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

test("waar de gebundelde grenzen ophouden zegt de bol dát, met de echte grens erbij", () => {
  /* Hier stond een melding over de ZUIDkant: "onder 55,6° zuiderbreedte staat er
   * niets in — Antarctica is weggelaten". Antarctica staat er nu wel, dus die zin
   * was in één sweep onwaar geworden zonder dat er iets rood werd. Dat is de fout
   * die deze test bewaakt: de grenzen komen uit WORLD_LATLON_BOUNDS en staan niet
   * in de zin.
   *
   * De noordkant houdt wél nog op — op de noordpunt van Groenland — en dat is nu
   * de kant waar deze melding echt verschijnt. */
  const onPick = vi.fn();
  const el = mount(<Globe value="USD" from="EUR" onPick={onPick} supported={SUPPORTED} />);
  const canvas = el.querySelector('[data-testid="bol-canvas"]')!;

  // Zes stappen omhoog vanaf 30° noord: recht op de noordpool.
  for (let i = 0; i < 6; i++) press(canvas, "ArrowUp");
  tapGlobe(el, DEFAULT_SIZE / 2, DEFAULT_SIZE / 2);

  const tekst = el.querySelector('[data-testid="bol-misser"]')!.textContent ?? "";
  expect(tekst).toContain("83,6° noorderbreedte");
  expect(tekst).toContain("90° zuiderbreedte");
  // Geen bewering over wat daar dan wél ligt, en geen verwijzing meer naar een
  // weggelaten Antarctica.
  expect(tekst).not.toContain("Antarctica");
  expect(tekst).not.toContain("zee");
  expect(onPick).not.toHaveBeenCalled();

  // En de tegenhanger: aan de zuidkant houdt er niets meer op. Recht op de
  // zuidpool is land, geen melding.
  for (let i = 0; i < 18; i++) press(canvas, "ArrowDown");
  tapGlobe(el, DEFAULT_SIZE / 2, DEFAULT_SIZE / 2);
  expect(el.querySelector('[data-testid="bol-misser"]')).toBeNull();
  expect(answer(el)).toContain("Antarctica");
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

test("Antarctica is aan te klikken en geeft het zesde antwoord, zonder tarief", () => {
  /* Antarctica stond niet in de bundel; onder 55,6° zuiderbreedte was de bol leeg.
   * Nu staat het er, en dan moeten drie dingen tegelijk waar zijn:
   *
   *  1. er is een vlak om op te klikken (anders is "wel tekenen, wel aanklikbaar"
   *     alleen op papier waar),
   *  2. het antwoord is "geen wettig betaalmiddel" en niet "geen koers" — dat
   *     eerste gaat over de plek, dat tweede over ons,
   *  3. er komt geen percentage op het scherm. Ook geen 0%: er is geen munt, dus
   *     er is niets om een tarief van te hebben. Dat is de val waar deze hele tab
   *     omheen gebouwd is. */
  const onPick = vi.fn();
  const el = mount(<Globe value="USD" from="EUR" onPick={onPick} supported={SUPPORTED} />);

  click(option(el, "FR"));
  onPick.mockClear();
  expect(answer(el)).toContain("Frankrijk");

  // Naar de zuidpool draaien met het toetsenbord: de beginstand is 30° noord, dus
  // elf stappen van 10° komen op 80° zuid uit. Zo wordt de klik hieronder een
  // echte klik op het doek en niet een keuze uit de lijst.
  const canvas = el.querySelector('[data-testid="bol-canvas"]')!;
  for (let i = 0; i < 11; i++) press(canvas, "ArrowDown");

  const pool = screenAt(0, -90, { lon: 8, lat: -80 });
  expect(pool.front).toBe(true);
  tapGlobe(el, pool.x, pool.y);

  expect(answer(el)).toContain("Antarctica");
  expect(answer(el)).toContain("geen wettig betaalmiddel");
  // Niet de melding voor een land waarvan wij de koers missen: dat zou een leemte
  // bij ons beweren waar er geen munt is.
  expect(answer(el)).not.toContain("geen koers");
  expect(answer(el)).not.toContain("valuta onbekend");
  // Geen percentage, en geen doelvaluta gezet.
  expect(answer(el)).not.toMatch(/%/);
  expect(onPick).not.toHaveBeenCalled();
  // En de leesregel zegt hetzelfde als het paneel: geen betaalmiddel, geen
  // streepje dat als nul te lezen is.
  expect(readout(el)).toContain("Antarctica");
  expect(readout(el)).toContain("geen betaalmiddel");
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

test("Antarctica laat geen route en geen 0% in de berekening achter", () => {
  const el = mount(<Valuta accounts={accounts} facts={[]} entries={entries} />);
  const naar = () =>
    [...el.querySelectorAll<HTMLSelectElement>("select")].find((s) => s.getAttribute("aria-label") === "Naar valuta")!;
  const before = naar().value;

  click(option(el, "AQ"));

  // De berekening staat nog op wat hij stond: er valt niets te wisselen, dus er
  // is ook niets om naartoe te rekenen.
  expect(naar().value).toBe(before);
  // Het antwoord noemt de echte reden en zet er geen getal bij. Een 0% hier zou
  // beweren dat een omwisseling naar Antarctica gratis is; er is geen omwisseling.
  const paneel = el.querySelector('[data-testid="bol-antwoord"]')!.textContent ?? "";
  expect(paneel).toContain("geen wettig betaalmiddel");
  expect(paneel).not.toMatch(/%/);
  expect(paneel).not.toMatch(/0,00/);
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

// ------------------------------------------------- de indeling van 21 augustus

/* "Onder de bol de legenda, en daaronder het zoekveld." De bol staat sinds deze
 * ronde in de RECHTERkolom naast de rekenmachine, dus de tweede kolom waar de
 * lijst in stond bestaat niet meer.
 *
 * Waarom dit als volgorde getest wordt en niet als opmaak: jsdom heeft geen
 * layout-engine, dus "staat eronder" is hier niet te meten. Wat wél te meten is,
 * is de bronvolgorde — en dat is precies wat een flexkolom (.lv-globe in
 * worldmap.css) op het scherm oplevert, op elke breedte hetzelfde. */

/** De ankers van de opstelling, in de volgorde waarin ze in het blok staan. */
const ANKERS: Record<string, string> = {
  bol: ".lv-globe-canvas",
  legenda: ".lv-globe-legend",
  antwoord: ".lv-globe-answer",
  zoekveld: ".lv-globe-search input",
  lijst: "#lv-globe-list",
  bron: ".lv-globe-source",
};

function volgorde(el: HTMLElement): string[] {
  const namen = Object.keys(ANKERS);
  // querySelectorAll levert documentvolgorde; dat is hier de hele meting.
  return [...el.querySelectorAll(Object.values(ANKERS).join(","))].map(
    (n) => namen.find((k) => n.matches(ANKERS[k])) ?? "?",
  );
}

test("de bol, dan de legenda, dan het antwoord, dan het zoekveld met de lijst", () => {
  const el = mount(<Globe value="USD" from="EUR" onPick={vi.fn()} supported={SUPPORTED} />);

  expect(volgorde(el)).toEqual(["bol", "legenda", "antwoord", "zoekveld", "lijst", "bron"]);

  // De legenda hoort BIJ de bol: hij staat in hetzelfde blok als het doek, zodat
  // er niets tussen kan schuiven dat de kleuren van hun uitleg wegduwt.
  const figure = el.querySelector(".lv-globe-figure")!;
  expect(figure.contains(el.querySelector(".lv-globe-canvas")!)).toBe(true);
  expect(figure.contains(el.querySelector(".lv-globe-legend")!)).toBe(true);
  expect(figure.contains(el.querySelector(".lv-globe-search")!)).toBe(false);

  // De vijf vlakjes van de legenda, met de kleurrol die het doek ook gebruikt.
  const tonen = [...el.querySelectorAll(".lv-globe-legend .lv-globe-swatch")].map((s) => s.getAttribute("data-tone"));
  expect(tonen).toEqual(["euro", "rate", "norate", "notender", "selected"]);
});

test("het antwoord op de klik staat vóór de lijst van 250 regels", () => {
  const el = mount(<Globe value="USD" from="EUR" onPick={vi.fn()} supported={SUPPORTED} />);
  click(option(el, "JP"));

  /* Dit is de enige plek waar deze lane van zijn woorden afwijkt: hij noemde de
   * legenda en het zoekveld, en niet het antwoordpaneel. Het staat ertussen omdat
   * het het antwoord is op de klik die je net op de bol deed; achter een lijst van
   * 250 regels verschijnt dat een halve pagina onder je vinger, en een melding die
   * je niet ziet is geen melding. */
  const antwoord = el.querySelector('[data-testid="bol-antwoord"]')!;
  const lijst = el.querySelector("#lv-globe-list")!;
  expect(antwoord.compareDocumentPosition(lijst) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(antwoord.textContent).toContain("JPY");
});

// --------------------------------------------------- de kleuren van het doek

/* HET BLAUW MOEST ANDERS, en de vorige ronde leverde een gemeten probleem op dat
 * groter was dan de vraag: "geen wettig betaalmiddel" stond op 1,21 contrast tegen
 * "geen koers" en 1,24 tegen "koers". Op een bol waar elk land een stroke in zijn
 * EIGEN vulkleur krijgt (dat dicht de haarlijn tussen twee vereenvoudigde vlakken,
 * zie Globe.tsx) is er geen landsgrens getekend — het kleurverschil is het enige
 * verschil, en twee tinten op 1,07 zijn op het scherm één land.
 *
 * Waarom dit hier gemeten wordt en niet in een zin in het stijlblad staat: die zin
 * stond er, en toen de kleuren veranderden bleef hij staan. Deze test leest
 * worldmap.css en tokens.css, lost de color-mix() op en rekent het na. Zet iemand
 * er een kleur in die de grens niet haalt, dan valt dit om.
 *
 * WAT DIT NIET IS: een oordeel over hoe het eruitziet. Contrast is een getal over
 * helderheid; het verschil tussen teal en grijs zit voor een groot deel in de hue
 * en dat meet deze formule niet mee. De grenzen hieronder liggen daarom laag —
 * ruim boven wat er stond, ruim onder wat er nu is — en ze bewaken de bodem, niet
 * de smaak. Met eigen ogen in een browser is er niets van gezien; dat staat als
 * open punt bij deze lane. */

/** Een stijlblad uit src/styles, als tekst.
 *
 *  Het pad wordt uit een STRING opgebouwd en niet met `new URL(pad,
 *  import.meta.url)`. In de jsdom-omgeving is de globale `URL` die van jsdom, en
 *  die lost een relatief pad op tegen het document (http://localhost:3000/…) in
 *  plaats van tegen dit bestand — dan leest readFileSync stilletjes iets anders
 *  in, en dat is precies wat hier gebeurde: `CSS` bevatte de bron van deze test
 *  en de eerste assertie viel over een "@keyframes" die in dit commentaar staat.
 *  Dezelfde valkuil staat in ToonMeer.test.tsx en CategoryBars.test.tsx. */
const here = dirname(fileURLToPath(import.meta.url));
const blad = (naam: string) => readFileSync(resolve(here, "../styles", naam), "utf8");

const CSS = blad("worldmap.css");
const TOKENS_CSS = blad("tokens.css");

/** Elke `--naam: #hex` uit tokens.css. Alleen hex: alles wat de bol gebruikt is
 *  daar een hex, en een token dat het niet is hoort hier niet stil als zwart
 *  binnen te komen. */
const TOKENS: Record<string, string> = Object.fromEntries(
  [...TOKENS_CSS.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)].map((m) => [m[1], m[2].toLowerCase()]),
);

/** De kleurrollen van de bol, zoals ze in .lv-globe staan. */
const ROLLEN: Record<string, string> = Object.fromEntries(
  [...CSS.matchAll(/(--lv-globe-[a-z]+):\s*([^;]+);/g)].map((m) => [m[1].replace("--lv-globe-", ""), m[2].trim()]),
);

type RGB = [number, number, number];

function hexNaarRgb(h: string): RGB {
  return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
}

/** Eén kleurwaarde uit het stijlblad naar echte kanalen.
 *
 *  Alleen `var(--token)` en `color-mix(in srgb, var(--a) N%, var(--b))` worden
 *  begrepen, en dat is met opzet de hele grammatica: een losse hex in dit blad
 *  komt hier als een fout naar buiten in plaats van als een kleur die het thema
 *  niet volgt. color-mix in srgb interpoleert de gamma-gecodeerde kanalen recht
 *  toe recht aan — dat is wat de browser doet en dus wat hier staat. */
function kleur(waarde: string): RGB {
  const token = /^var\((--[a-z0-9-]+)\)$/.exec(waarde);
  if (token) {
    const hex = TOKENS[token[1]];
    if (!hex) throw new Error(`onbekend token: ${token[1]}`);
    return hexNaarRgb(hex);
  }
  const gemengd = /^color-mix\(in srgb,\s*var\((--[a-z0-9-]+)\)\s*([\d.]+)%,\s*var\((--[a-z0-9-]+)\)\s*\)$/.exec(waarde);
  if (gemengd) {
    const a = kleur(`var(${gemengd[1]})`);
    const b = kleur(`var(${gemengd[3]})`);
    const p = Number(gemengd[2]) / 100;
    return a.map((v, i) => v * p + b[i] * (1 - p)) as RGB;
  }
  throw new Error(`kleur niet op te lossen uit tokens: ${waarde}`);
}

/** WCAG-contrast. De formule meet helderheid en niets anders; zie de kop. */
function contrast(a: RGB, b: RGB): number {
  const lum = (c: RGB) => {
    const [r, g, bl] = c.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hoog, laag] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hoog + 0.05) / (laag + 0.05);
}

const paar = (a: string, b: string) => contrast(kleur(ROLLEN[a]), kleur(ROLLEN[b]));

test("elke kleur van de bol komt uit een token, en er staat geen hex in het blad", () => {
  // Alle tien de rollen die readPalette() opvraagt, en geen ervan met een eigen
  // kleurwaarde: een canvas kan geen var() lezen, dus de verleiding om hier een
  // hex neer te zetten is echt en dit is wat haar tegenhoudt.
  expect(Object.keys(ROLLEN).sort()).toEqual(
    ["euro", "grid", "hover", "norate", "notender", "pin", "rate", "rim", "sea", "selected"].sort(),
  );
  for (const [rol, waarde] of Object.entries(ROLLEN)) {
    expect(() => kleur(waarde), `${rol}: ${waarde}`).not.toThrow();
  }
  const zonderCommentaar = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  expect(zonderCommentaar).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  expect(zonderCommentaar).not.toMatch(/\brgba?\(/);
});

test("de tint voor 'geen wettig betaalmiddel' ligt los van de twee waar hij tegenaan lag", () => {
  /* Dit is de meting die de eigenaar zelf noemde. Zijn getallen golden voor het
   * palet dat er stond: --muted 46% naast --muted 34% en naast --accent 48%. */
  expect(paar("notender", "norate")).toBeGreaterThan(2);
  expect(paar("notender", "rate")).toBeGreaterThan(1.35);
  /* En het paar dat er voor Antarctica echt toe doet, want dat land grenst
   * nergens aan een ander land: de tint tegen de zee. Dat was 1,68 — een werelddeel
   * dat in het water oploste. */
  expect(paar("notender", "sea")).toBeGreaterThan(4);
});

test("twee landen die aan elkaar grenzen zijn uit elkaar te houden", () => {
  /* De drie paren die op de kaart tegen elkaar aan liggen: Kroatië–Servië,
   * Griekenland–Albanië, Finland–Rusland. Ze stonden op 1,07 / 1,50 / 1,61 en dat
   * eerste getal is geen grens maar één vlak. */
  expect(paar("euro", "norate")).toBeGreaterThan(1.5);
  expect(paar("rate", "norate")).toBeGreaterThan(1.5);
  expect(paar("euro", "rate")).toBeGreaterThan(2);
  // En elke vulling moet van het water af te lezen zijn. Euro is hier het krapste
  // paar (het staat op 1,30) en dat is een bewuste ondergrens: donkerder zou euro
  // tegen "geen koers" aan duwen, en dát paar deelt wél een grens.
  for (const rol of ["euro", "rate", "norate", "notender"]) {
    expect(paar(rol, "sea"), `${rol} tegen de zee`).toBeGreaterThan(1.25);
  }
});

test("aanwijzen en kiezen vallen op tegen elk van de vier vullingen", () => {
  // Een hover die op de halve wereld onzichtbaar is, is geen hover. Dit is de
  // reden dat "geen wettig betaalmiddel" niet nóg donkerder is gemaakt: dan wint
  // die vulling van de hover erbovenop.
  for (const rol of ["euro", "rate", "norate", "notender"]) {
    expect(paar("hover", rol), `aangewezen op ${rol}`).toBeGreaterThan(2.2);
  }
  expect(paar("selected", "sea")).toBeGreaterThan(4);
  // En geen twee rollen zijn dezelfde kleur: dan zou een van de zes antwoorden op
  // het doek verdwijnen in een ander.
  const gebruikt = ["euro", "rate", "norate", "notender", "hover", "selected"].map((r) => kleur(ROLLEN[r]).join(","));
  expect(new Set(gebruikt).size).toBe(gebruikt.length);
});

test("het stijlblad van de bol beweegt niet en hangt niet aan de breedte van het venster", () => {
  const zonderCommentaar = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  // Regel 12: geen animaties, transitions of keyframes.
  expect(zonderCommentaar).not.toMatch(/\btransition\b/);
  expect(zonderCommentaar).not.toMatch(/\banimation\b/);
  expect(zonderCommentaar).not.toMatch(/@keyframes/);
  /* En geen breekpunt meer. De bol stond in twee kolommen met een @media op 760 px;
   * nu is het één flexkolom die op elke breedte hetzelfde staat, en de enige
   * opstelling die nog van de breedte afhangt is die van de tab zelf
   * (.module-grid.grid-2 in views.css, één kolom onder 900 px). Twee plekken die
   * allebei een beetje aan de indeling doen is hoe die indeling gaat verschillen. */
  expect(zonderCommentaar).not.toContain("@media");
  expect(zonderCommentaar).not.toContain("lv-globe-stage");
  expect(zonderCommentaar).not.toContain("lv-globe-side");
});

/* ════════════════ DE BREDERE KOERSLIJST (22 augustus) ════════════════
 *
 * De Valuta-tab kende 29 ECB-koersen; er ligt nu een tweede laag onder die de
 * lijst op 166 brengt (zie apps/server/src/fx.ts). De bol bepaalt "prijsbaar"
 * aan de LIVE lijst, dus er lichten vanzelf tientallen landen op. Gemeten op de
 * gebundelde wereld van 250 landen:
 *
 *              alleen ECB (30)      ECB + aggregator (166)
 *   prijsbaar          65                     204
 *   geen koers        140                       1
 *   eurozone           37                      37
 *   keuze               7                       7
 *   geen wettig         1                       1
 *
 * Wat hieronder bewaakt wordt is dat die verschuiving de bol niet KAPOT maakt:
 * alle antwoordsoorten blijven bereikbaar en blijven van elkaar te onderscheiden,
 * en geen enkele legenda-regel wordt een dode letter. Dat laatste was de echte
 * zorg — "geen koers" gaat van 140 landen naar één (Noord-Korea, KPW), en een
 * legenda-regel voor een kleur die nergens meer voorkomt is een regel die liegt
 * over wat je ziet. Hij blijft staan, want hij is de stand waar de bol naar
 * terugvalt zodra de tweede laag wegvalt — en dan zijn het er weer 140. */

/** De 29 ECB-koersen plus een handvol uit de tweede laag: Marokko, de Emiraten,
 *  Vietnam. Expliciet en niet uit de bundel gelezen, zodat deze test niet
 *  meebeweegt met wat een bron vandaag toevallig publiceert. */
const SUPPORTED_TWEE_LAGEN = [...SUPPORTED, "MAD", "AED", "VND", "CUP", "PAB"];

test("een land dat alleen de tweede laag kent, wordt prijsbaar zodra die laag er is", () => {
  // Marokko betaalt in MAD. De ECB publiceert die niet; de aggregator wel.
  expect(countryById("MA")!.currencies).toEqual([{ code: "MAD", priceable: false }]);

  const zonder = vi.fn();
  click(option(mount(<Globe value="USD" from="EUR" onPick={zonder} supported={SUPPORTED} />), "MA"));
  expect(zonder).not.toHaveBeenCalled();

  act(() => root?.unmount());
  host?.remove();

  const met = vi.fn();
  const el = mount(<Globe value="USD" from="EUR" onPick={met} supported={SUPPORTED_TWEE_LAGEN} />);
  click(option(el, "MA"));
  expect(met).toHaveBeenCalledWith("MAD");
  expect(answer(el)).toContain("MAD");
  // De vlag in de bundel staat nog op `priceable: false`; de LIJST wint. Dat is
  // dezelfde regel als bij Nieuw-Zeeland hierboven, maar dan de andere kant op.
  expect(answer(el)).not.toContain("geen koers");
});

test("met de bredere lijst blijven alle vijf de antwoordsoorten van elkaar te onderscheiden", () => {
  const onPick = vi.fn();
  const el = mount(<Globe value="USD" from="EUR" onPick={onPick} supported={SUPPORTED_TWEE_LAGEN} />);

  // 1. eurozone — geen omwisseling, en nog steeds geen percentage.
  click(option(el, "NL"));
  expect(answer(el)).toContain("euro");
  expect(answer(el)).not.toMatch(/\d\s*%/);

  // 2. prijsbaar via de tweede laag.
  click(option(el, "AE"));
  expect(onPick).toHaveBeenLastCalledWith("AED");

  // 3. keuze — Panama kent nu ALLEBEI de valuta's, en de bol kiest nog steeds
  //    zelf niet. Dat is het gevaar van een bredere lijst: met twee prijsbare
  //    munten is "de eerste pakken" ineens verleidelijk, en het verandert nog
  //    steeds het antwoord.
  const gekozen = onPick.mock.calls.length;
  click(option(el, "PA"));
  expect(answer(el)).toContain("Welke bedoel je?");
  expect(onPick.mock.calls.length).toBe(gekozen);

  // 4. geen koers — Noord-Korea is met 166 valuta het enige land dat overblijft.
  click(option(el, "KP"));
  expect(answer(el)).toContain("KPW");
  expect(answer(el)).toContain("geen koers");
  expect(answer(el)).not.toMatch(/\d\s*%/);

  // 5. geen wettig betaalmiddel — dit antwoord gaat NIET over ons en verandert
  //    dus niet mee met de koerslijst, hoe lang die ook wordt.
  click(option(el, "AQ"));
  expect(answer(el)).toContain("geen wettig betaalmiddel");
  expect(answer(el)).not.toContain("geen koers");
});

test("de legenda blijft waar met een bredere lijst, en geen regel wordt een dode letter", () => {
  const el = mount(<Globe value="USD" from="EUR" onPick={vi.fn()} supported={SUPPORTED_TWEE_LAGEN} />);
  const regels = [...el.querySelectorAll(".lv-globe-legend li")].map((li) => (li.textContent ?? "").trim());

  /* De legenda zegt "LaVega heeft een koers" en "geen koers bij LaVega" — over
   * ONS, niet over welke instelling de koers publiceerde. Dat is precies waarom
   * hij niet hoefde mee te bewegen: beide lagen zijn "een koers hebben". Het
   * verschil TUSSEN de lagen hoort waar de koers gebruikt wordt (de herkomstregel
   * in Valuta.tsx), niet in een kleur op een bol — een vijfde tint zou een
   * onderscheid als kleur coderen dat alleen in woorden klopt. */
  expect(regels).toEqual([
    "euro — niets te wisselen",
    "LaVega heeft een koers",
    "geen koers bij LaVega",
    "geen wettig betaalmiddel",
    "gekozen",
  ]);
  // Geen enkele regel noemt een bron, dus geen enkele regel wordt onwaar als er
  // een bron bij komt of wegvalt.
  for (const r of regels) {
    expect(r).not.toContain("ECB");
    expect(r).not.toContain("dagkoers");
  }
});
