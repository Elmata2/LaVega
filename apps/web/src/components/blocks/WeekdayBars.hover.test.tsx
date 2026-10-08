// @vitest-environment jsdom
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
    <WeekdayBars
      days={week}
      format={euro}
      ariaLabel="Gemiddelde uitgaven per weekdag"
      peakIndex={4}
    />,
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
  const html = renderToStaticMarkup(
    <WeekdayBars days={partial} format={euro} ariaLabel="Uitgaven" />,
  );
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

test("de stippellijn ligt ná de staven in de DOM — daar komt het probleem vandaan", () => {
  const html = renderToStaticMarkup(
    <WeekdayBars days={week} format={euro} ariaLabel="Uitgaven" peakIndex={4} />,
  );
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
