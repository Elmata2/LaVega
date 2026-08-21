// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test } from "vitest";
import WeekdayBars from "./WeekdayBars";

/* Item 12, for the weekday chart. He asked for the chart itself to be left
 * alone ("weekdays and the growth chart are fine as they are") and only for the
 * reading to be added, so this file tests exactly that: every measured bar can
 * be read by hover, by tap and by keyboard, and a day with no measurement still
 * shows no number at all.
 *
 * A separate file from WeekdayBars.test.tsx because the reading is an
 * interaction: this one mounts the component for real (React's own root API —
 * no testing library is installed in this repo). */

const euro = (v: number) => `€${Math.round(v)}`;

const week = [
  { label: "ma", value: 20 },
  { label: "di", value: 35 },
  { label: "wo", value: 15 },
  { label: "do", value: 40 },
  { label: "vr", value: 120 },
  { label: "za", value: 60 },
  { label: "zo", value: 10 },
];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
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

test("each weekday bar carries its own number, named with the day it belongs to", () => {
  const html = renderToStaticMarkup(
    <WeekdayBars days={week} format={euro} ariaLabel="Gemiddelde uitgaven per weekdag" peakIndex={4} />,
  );
  // Seven measured days, seven buttons — not seven divs with a title only a
  // desktop mouse can reach.
  expect(html.match(/<button /g)?.length).toBe(7);
  expect(html.match(/class="lv-tip-value"/g)?.length).toBe(7);
  expect(html).toContain('<span class="lv-tip-when">vr</span>');
  expect(html).toContain('<span class="lv-tip-value">€120</span>');
  expect(html).toContain('aria-label="vr: €120"');
  // The peak bar fills the plot, so its chip has to read inside the bar rather
  // than on top of the peak chip that already sits above it.
  expect(html).toContain('class="lv-tip lv-tip-inside"');
});

test("a day that was never measured gets no bar and therefore no number", () => {
  const partial = [
    { label: "ma", value: null },
    { label: "di", value: 20 },
    { label: "wo", value: null },
  ];
  const html = renderToStaticMarkup(<WeekdayBars days={partial} format={euro} ariaLabel="Uitgaven" />);
  // Unknown is not zero: the untouched days have no chip to hover, because
  // there is no number to show. Inventing "€0" would say "that day is free".
  expect(html.match(/<button /g)?.length).toBe(1);
  expect(html.match(/class="lv-tip-value"/g)?.length).toBe(1);
  expect(html).toContain('aria-label="di: €20"');
});

test("a tap opens a weekday's number and a second tap closes it", () => {
  const el = mount(<WeekdayBars days={week} format={euro} ariaLabel="Uitgaven" peakIndex={4} />);
  // De knop is de KOLOM, niet de staaf — zie de sectie over punt 1 hieronder
  // voor de meting die dat afdwong. Wie hier weer op `button.lv-bar` selecteert,
  // heeft de staaf terug tot knop gemaakt en het tikdoel terug tot 42 bij 6.
  const bars = [...el.querySelectorAll<HTMLButtonElement>("button.weekday-column")];
  expect(bars).toHaveLength(7);

  act(() => bars[2].click());
  expect(bars[2].dataset.tip).toBe("on");
  act(() => bars[2].click());
  expect(bars[2].dataset.tip).toBe("off");

  act(() => bars[2].click());
  act(() => bars[5].click());
  expect(bars[2].dataset.tip).toBe("off");
  expect(bars[5].dataset.tip).toBe("on");
});

test("the plot is a group, not an image — an image would hide every bar again", () => {
  const html = renderToStaticMarkup(<WeekdayBars days={week} format={euro} ariaLabel="Uitgaven" />);
  // role="img" makes descendants presentational, which would have taken the
  // seven buttons straight back out of the screen reader's reach.
  expect(html).toContain('role="group"');
  expect(html).not.toContain('role="img"');
  expect(html).toContain('aria-label="Uitgaven"');
});

/* ── REVIEW 4, PUNT 1 — waarom de hover er wél stond en toch niet werkte ──
 *
 * Hij vroeg dit voor de derde keer (review 2 punt 12, review 3 punt 7, review 4
 * punt 1) terwijl de code erboven al klopte en de vier tests erboven al groen
 * waren. Dat is precies het probleem: jsdom doet GEEN raakvlaktest. `.click()`
 * gaat daar rechtstreeks naar de knop, ook als er in een echte browser een
 * andere laag overheen ligt — dus de tests bewezen alleen dat de knop bestond,
 * niet dat je erbij kon.
 *
 * Gemeten in Chrome (headless, op dit onderdeel met tokens/base/charts/blocks
 * erbij): alle zeven staven gaven `document.elementFromPoint` → `svg.lv-chart-svg`
 * in plaats van de knop, zowel midden op de staaf als erboven. Een <svg> is voor
 * het aanwijzen een gewoon vervangen element: zijn hele vak vangt de aanwijzer,
 * ook waar de tekening leeg is. De stippellijn lag dus als een glasplaat over de
 * grafiek en ving elke muisbeweging én elke tik. Alleen het toetsenbord kwam er
 * nog bij, want focus doorloopt geen raakvlaktest — daarom haalde de weekdag-
 * grafiek het wel door de a11y-lat en niet door zijn eigen bedoeling.
 *
 * Twee dingen zijn hieronder vastgelegd, want ze moeten samen waar blijven:
 * de STAPELING (svg ná de staven, anders is er geen probleem én geen fix nodig)
 * en de REGEL in charts.css die de svg laat doorlaten. Een van de twee alleen
 * zegt niets.
 *
 * ── EN DE TWEEDE HELFT: DE TELEFOON ──
 *
 * Met de glasplaat weg werkte de muis, en toen bleef er een gat over dat met
 * dezelfde meting boven kwam: de staven zijn 42 bij 6 pixels op de goedkoopste
 * dag (iPhone-13-profiel, echte stylesheets). Op een telefoon bestaat hover
 * niet, dus daar blijft alleen de tik over — en 6 pixels hoog is geen tikdoel.
 * De eerste poging hierop was een CSS-regel `.lv-bars-group:hover .lv-tip`: die
 * maakte de kolom aanwijsbaar met de MUIS terwijl de tik en de focus via de knop
 * bleven lopen. Twee mechanismen voor hetzelfde, en de telefoon zat aan de
 * verkeerde kant van de scheiding.
 *
 * Nu is de <button> zélf de kolom (`.weekday-column`) en is de staaf een <span>
 * erbinnen. Gemeten na de wijziging: het trefvlak is 107 bij 196 in plaats van
 * 42 bij 6, een tik hoog in de lege kolom opent de chip van díe dag en er staat
 * er nooit meer dan één open. Wat de tests hieronder daarvan kunnen vasthouden
 * is de CONSTRUCTIE (de knop is de kolom, de staaf zit erin) en de REGELS in
 * charts.css die hem de volle hoogte geven — jsdom heeft geen opmaakmotor, dus
 * de pixels zelf zijn hier niet na te meten. */

const chartsCss = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../styles/charts.css"), "utf8");
/** Zonder commentaar: er staat het woord "pointer-events" ook in een uitleg, en
 *  een test die op proza slaagt bewijst niets over de opmaak. */
const chartsRules = chartsCss.replace(/\/\*[\s\S]*?\*\//g, "");

/** Het regelblok van één selector, of null. `{` en `}` zijn genoeg om te
 *  splitsen omdat charts.css geen geneste at-regels binnen deze selectors heeft. */
function ruleBlock(selector: string): string | null {
  const re = new RegExp(`(^|[},])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "m");
  return re.exec(chartsRules)?.[2] ?? null;
}

test("de stippellijn ligt ná de staven in de DOM — daar komt het probleem vandaan", () => {
  const html = renderToStaticMarkup(<WeekdayBars days={week} format={euro} ariaLabel="Uitgaven" peakIndex={4} />);
  const groups = html.indexOf('class="lv-bars-groups"');
  const svg = html.indexOf('class="lv-chart-svg"');
  expect(groups).toBeGreaterThan(-1);
  expect(svg).toBeGreaterThan(-1);
  // Allebei absoluut gepositioneerd zonder z-index, dus de DOM-volgorde bepaalt
  // wie bovenop ligt. De lijn moet over de staven heen worden getekend (anders
  // verdwijnt hij erachter), dus deze volgorde blijft — en daarom moet de svg
  // de aanwijzer doorlaten in plaats van hem te vangen.
  expect(svg).toBeGreaterThan(groups);
});

test("charts.css laat die stippellijn de aanwijzer doorgeven", () => {
  const block = ruleBlock(".lv-chart-svg");
  expect(block, "charts.css heeft geen .lv-chart-svg-regel meer").not.toBeNull();
  // Zonder deze ene declaratie is geen enkele staaf met muis of vinger te
  // bereiken. Gemeten, niet beredeneerd — zie de kop van deze sectie.
  expect(block).toMatch(/pointer-events:\s*none/);
});

test("de knop is de hele kolom en de staaf zit erin — niet andersom", () => {
  const html = renderToStaticMarkup(<WeekdayBars days={week} format={euro} ariaLabel="Uitgaven" peakIndex={4} />);
  // Zeven kolommen, zeven knoppen. De staaf is tekening geworden: geen <button>
  // draagt nog `lv-bar`, want dán is het tikdoel weer 42 bij 6 pixels.
  expect(html.match(/<button [^>]*class="weekday-column"/g)?.length).toBe(7);
  expect(html).not.toMatch(/<button[^>]*class="[^"]*\blv-bar\b/);
  // En de staaf staat ín die knop, met zijn chip erin — de chip hoort net boven
  // de STAAF te hangen, niet bovenaan een kolom van volle plothoogte.
  expect(html).toMatch(
    /<button [^>]*class="weekday-column"[^>]*>\s*<span class="lv-bar weekday-bar[^"]*"[^>]*>\s*<span class="lv-tip/,
  );

  // De maat waar dit allemaal om begonnen is, komt uit charts.css: zonder deze
  // twee declaraties is de knop weer zo groot als zijn inhoud en is er niets
  // gewonnen. `height: 100%` is de plothoogte, `flex: 1` de dagbreedte.
  const kolom = ruleBlock(".weekday-column");
  expect(kolom, "charts.css mist de .weekday-column-regel").not.toBeNull();
  expect(kolom).toMatch(/height:\s*100%/);
  expect(kolom).toMatch(/flex:\s*1/);
});

test("muis, vinger en toetsenbord openen de chip via diezelfde ene knop", () => {
  // Eén selectorblok voor alle drie: dat is de hele winst van deze opzet. Toen
  // de muis via `.lv-bars-group:hover` liep en de tik via de knop, viel de
  // telefoon tussen de twee door zonder dat een test dat merkte.
  for (const weg of [".weekday-column:hover", ".weekday-column:focus", '.weekday-column[data-tip="on"]']) {
    expect(chartsRules, `charts.css mist ${weg} .lv-tip`).toContain(`${weg} .lv-tip`);
  }
  // De drie delen die selectorlijst staan in één blok; `[data-tip="on"]` is het
  // laatste deel, dus dáár hangt het blok aan — en dat blok moet de chip echt
  // tonen en niet alleen genoemd worden.
  const blok = ruleBlock('.weekday-column[data-tip="on"] .lv-tip');
  expect(blok, "de chip-tonende regel is niet gevonden").not.toBeNull();
  expect(blok).toMatch(/visibility:\s*visible/);
  expect(blok).toMatch(/opacity:\s*1/);

  // De oude muis-only regel mag niet terugkomen, en al helemaal niet ongebonden:
  // in CategoryBars staan twee of drie staven in één groep, en dan zou één
  // beweging alle chips van die groep over elkaar heen openen.
  expect(chartsRules).not.toMatch(/\.lv-bars-group:hover/);
});

test("de focusring verdwijnt niet met de knopopmaak mee", () => {
  // `.weekday-column` zet `outline: none` om geen kader van de volle plothoogte
  // te tekenen. Dat is alleen toegestaan zolang de ring een regel verderop om de
  // STAAF terugkomt; zonder die tweede regel is de grafiek met het toetsenbord
  // onvindbaar en is dit een a11y-regressie in plaats van opmaak.
  expect(ruleBlock(".weekday-column:focus-visible")).toMatch(/outline:\s*none/);
  const ring = ruleBlock(".weekday-column:focus-visible > .lv-bar");
  expect(ring, "de focusring om de staaf is weg").not.toBeNull();
  expect(ring).toMatch(/outline:\s*2px solid/);
});

test("een dag zonder meting krijgt ook geen kolom om aan te wijzen", () => {
  // De kolomregel hangt aan `.lv-tip`, en die bestaat alleen binnen een staaf.
  // Een niet-gemeten dag heeft geen staaf, dus daar valt niets te openen — geen
  // lege chip, geen "€ 0". Onbekend blijft onbekend, ook nu de kolom meedoet.
  const partial = [
    { label: "ma", value: null },
    { label: "di", value: 20 },
    { label: "wo", value: null },
  ];
  const el = mount(<WeekdayBars days={partial} format={euro} ariaLabel="Uitgaven" />);
  expect(el.querySelectorAll(".lv-bars-group")).toHaveLength(3);
  expect(el.querySelectorAll(".lv-tip")).toHaveLength(1);
});
