// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test } from "vitest";
import ToonMeer, { TOONMEER_CLASS, type ToonMeerProps } from "./ToonMeer";

/* Wat hier vastligt, ligt vast voor vier andere lanes: zij bouwen hun eigen
 * "toon meer" op dit onderdeel en op deze klassenamen.
 *
 * Twee helften moeten het eens blijven — de JSX kiest de klasse, modules.css
 * zegt wat de klasse doet — dus het stylesheet wordt hier echt gelezen, net als
 * in module-grid.test.ts. Een stille hernoeming aan één kant haalt anders
 * niets omver behalve het uiterlijk, en dat merkt geen enkele test.
 *
 * WAT DEZE TESTS NIET BEWIJZEN, eerlijk gezegd: jsdom voert de toetsactivering
 * van een <summary> niet uit (een Enter-keydown doet daar niets), dus de claim
 * "met het toetsenbord bedienbaar" leunt op de elementkeuze — een echte
 * <summary> in een echte <details> — en op de focusregel in het stylesheet.
 * Beide staan hieronder wél gepind. Een nagespeelde toetsaanslag zou hier
 * groen worden zonder iets over een browser te zeggen. */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* Het pad wordt uit een STRING opgebouwd, niet uit `new URL(...)`: in de
 * jsdom-omgeving is `URL` die van jsdom, en node's fileURLToPath weigert dat
 * object met "The URL must be of scheme file". Met een string doet node de
 * parsing zelf en klopt het pad wél. */
const here = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(resolve(here, "../styles/modules.css"), "utf8");

/** Alleen onze eigen sectie, zodat "geen animatie" niet over de hele grid gaat. */
const MARKER = '/* ---------- "Toon meer"';
const start = css.indexOf(MARKER);
// Zonder deze regel zou een hernoemde kop `slice(-1)` opleveren — één teken CSS
// waarin niets meer te vinden is, en dan faalt alles hieronder met een raadsel.
if (start === -1) throw new Error(`modules.css heeft geen sectie ${MARKER}`);
const section = css.slice(start);
/** Zonder commentaar, anders telt een woord uit een uitleg mee als regel. */
const rules = section.replace(/\/\*[\s\S]*?\*\//g, "");

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

function render(props: Partial<ToonMeerProps> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <ToonMeer summary="Waar dit cijfer vandaan komt" {...props}>
        {props.children ?? <p>ING, saldo van 19 augustus.</p>}
      </ToonMeer>,
    ),
  );
  return {
    details: container.querySelector<HTMLDetailsElement>(`.${TOONMEER_CLASS.root}`)!,
    summary: container.querySelector<HTMLElement>(`.${TOONMEER_CLASS.summary}`)!,
  };
}

function click(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** Het toggle-event van <details> komt per spec in een volgende task. */
const nextTask = () => act(async () => await new Promise((r) => setTimeout(r, 0)));

/* ── dicht, en dat is de hele bedoeling ────────────────────────────────── */

test("hij staat dicht, zonder dat een aanroeper daar iets voor doet", () => {
  const { details } = render();
  expect(details.open).toBe(false);
  // Ook in de platte markup: geen open-attribuut op de <details> zelf, dus geen
  // verschil tussen wat de server schrijft en wat de browser toont.
  const html = renderToStaticMarkup(<ToonMeer summary="x">y</ToonMeer>);
  expect(html).toMatch(/^<details class="toonmeer toonmeer-regel">/);
});

test("de samenvattingstekst staat er ook als hij dicht is — anders is hij onvindbaar", () => {
  const { details, summary } = render();
  expect(details.open).toBe(false);
  expect(summary.textContent).toContain("Waar dit cijfer vandaan komt");
});

test("de tekst verandert niet bij het openen: dezelfde belofte, open en dicht", () => {
  const { details, summary } = render();
  const dicht = summary.textContent;
  click(summary);
  expect(details.open).toBe(true);
  expect(summary.textContent).toBe(dicht);
});

/* ── openen en sluiten ─────────────────────────────────────────────────── */

test("een klik op de samenvatting opent hem, en een tweede klik sluit hem", () => {
  const { details, summary } = render();
  click(summary);
  expect(details.open).toBe(true);
  click(summary);
  expect(details.open).toBe(false);
});

test("onToggle meldt de NIEUWE stand, één task na de klik", async () => {
  const gemeld: boolean[] = [];
  const { summary } = render({ onToggle: (open) => gemeld.push(open) });
  click(summary);
  await nextTask();
  click(summary);
  await nextTask();
  expect(gemeld).toEqual([true, false]);
});

test("de kinderen blijven in de DOM als hij dicht is — test op .open, niet op afwezige tekst", () => {
  // Deze test staat er voor de andere lanes: wie hier `not.toContain` schrijft,
  // schrijft een test die faalt terwijl het onderdeel precies goed werkt.
  const { details } = render({ children: <p>Bron: geld.nl, 12 augustus.</p> });
  expect(details.open).toBe(false);
  expect(details.querySelector(`.${TOONMEER_CLASS.panel}`)!.textContent).toContain(
    "Bron: geld.nl, 12 augustus.",
  );
});

/* ── toetsenbord en schermlezer ────────────────────────────────────────── */

test("het klikvlak is een echte <summary> in een echte <details>", () => {
  // Dít is waar Enter/Space, Tab-focus en het uitspreken van de stand vandaan
  // komen. Een <div> met een klikhandler zou elke test hierboven halen.
  const { details, summary } = render();
  expect(details.tagName).toBe("DETAILS");
  expect(summary.tagName).toBe("SUMMARY");
  expect(summary.parentElement).toBe(details);
});

test("de samenvatting is met Tab te bereiken en houdt de focus", () => {
  const { summary } = render();
  expect(summary.tabIndex).toBe(0);
  summary.focus();
  expect(document.activeElement).toBe(summary);
});

test("de focus is ook te zíen: modules.css geeft de samenvatting een eigen ring", () => {
  // base.css doet dat alleen voor button:focus-visible; een <summary> is geen
  // button, dus zonder deze regel tabt iemand blind door het scherm.
  expect(rules).toMatch(/\.toonmeer-summary:focus-visible\s*\{[^}]*outline:/);
});

test("het teken naast de tekst is verborgen voor een schermlezer", () => {
  // De <details> vertelt de stand al; "plus" erachteraan is dubbelop.
  const { summary } = render();
  const mark = summary.querySelector(`.${TOONMEER_CLASS.mark}`)!;
  expect(mark.getAttribute("aria-hidden")).toBe("true");
});

/* ── de twee verschijningsvormen ───────────────────────────────────────── */

test("de standaard is de volle regel", () => {
  const { details } = render();
  expect(details.className).toBe("toonmeer toonmeer-regel");
});

test("het ⓘ zet de kop in de samenvatting en houdt de belofte leesbaar op hover", () => {
  const { details, summary } = render({
    variant: "info",
    heading: <h3 className="module-title">Categorieën</h3>,
    summary: "Hoe deze indeling tot stand komt",
  });
  expect(details.className).toBe("toonmeer toonmeer-info");
  expect(summary.querySelector("h3")?.textContent).toBe("Categorieën");
  // Naast een kop is een hele zin te veel beeld, maar de belofte mag niet weg:
  // hij staat in de markup (schermlezer) en in de tooltip (muis).
  expect(summary.textContent).toContain("Hoe deze indeling tot stand komt");
  expect(summary.getAttribute("title")).toBe("Hoe deze indeling tot stand komt");
});

test("de volle regel krijgt géén tooltip: die zou de zichtbare tekst herhalen", () => {
  const { summary } = render();
  expect(summary.getAttribute("title")).toBe(null);
});

test("een eigen klasse komt erachteraan, zonder de vorm te verdringen", () => {
  const { details } = render({ className: "overzicht-categorieen" });
  expect(details.className).toBe("toonmeer toonmeer-regel overzicht-categorieen");
});

/* ── de opmaak: elke klasse die we beloven bestaat, en beweegt niet ────── */

test("elke klasse uit TOONMEER_CLASS en beide varianten hebben een regel in modules.css", () => {
  const classes = [...Object.values(TOONMEER_CLASS), "toonmeer-regel", "toonmeer-info"];
  for (const cls of classes) {
    expect(rules, `.${cls} heeft geen regel in modules.css`).toMatch(
      new RegExp(`\\.${cls}[\\s,{:\\[]`),
    );
  }
});

test("de stand van de volle regel komt uit CSS, want React houdt hem niet bij", () => {
  expect(rules).toMatch(/\.toonmeer-regel\s+\.toonmeer-mark::after\s*\{\s*content:\s*"\+"/);
  expect(rules).toMatch(/\.toonmeer-regel\[open\]\s+\.toonmeer-mark::after\s*\{\s*content:/);
});

test("het driehoekje van de browser is in beide motoren weggehaald", () => {
  // list-style dekt Chrome en Firefox, ::-webkit-details-marker dekt Safari.
  expect(rules).toMatch(/\.toonmeer-summary\s*\{[^}]*list-style:\s*none/);
  expect(rules).toContain(".toonmeer-summary::-webkit-details-marker");
});

test("er beweegt niets: geen transition, animation of keyframes (huisregel 12)", () => {
  expect(rules).not.toMatch(/transition|animation|@keyframes/);
});
