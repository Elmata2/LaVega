// @vitest-environment jsdom
import { useState, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test } from "vitest";
import ModulePicker, { WidgetPicker } from "./ModulePicker";
import NavBar from "./NavBar";
import {
  DEFAULT_MODULES,
  DEFAULT_WIDGETS,
  HOME_MODULE,
  MODULES,
  WIDGETS,
  enabledModules,
  enabledWidgets,
  getEnabledWidgets,
  navModules,
  normaliseWidgets,
  toggleModule,
  toggleWidget,
  useOverviewWidgets,
  type ModuleId,
} from "./moduleRegistry";
import { AandachtWidget } from "./blocks/AandachtBlock";
import { BetaalschemaWidget } from "./blocks/BetaalschemaBlock";
import { PositieWidget } from "./blocks/PositieBlock";
import { getEnabledModules, setEnabledModules } from "../settings";

/* The nav is now the owner's own selection. These prove the two halves of that
 * promise: the picker really moves a module in and out of the nav, and the
 * choice really survives a reload — plus the one module that can never leave. */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

/* The shell in miniature: the nav renders whatever the picker last chose, and
 * the choice is persisted exactly as App.tsx persists it. */
function Shell() {
  const [modules, setModules] = useState<ModuleId[]>(() => enabledModules(getEnabledModules()));
  return (
    <>
      <NavBar view="overview" modules={navModules(modules)} onNavigate={() => {}} onOpenProfile={() => {}} />
      <ModulePicker
        enabled={modules}
        onChange={(next) => {
          setModules(next);
          setEnabledModules(next);
        }}
      />
    </>
  );
}

function render() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<Shell />));
  return container;
}

function navLabels(): string[] {
  return [...container!.querySelectorAll(".navrail .nav-item")].map((n) => (n.textContent ?? "").trim());
}

function toggle(label: string): HTMLButtonElement {
  const el = container!.querySelector(`[aria-label="${label} in de navigatie"]`);
  if (!el) throw new Error(`no toggle for ${label}`);
  return el as HTMLButtonElement;
}

function click(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

test("the picker toggles a module out of the nav and back in again", () => {
  // Everything starts on, so decluttering means switching OFF what you do not
  // want — an existing install must never open with its tabs missing.
  render();
  expect(navLabels()).toContain("Valuta");

  click(toggle("Valuta"));
  expect(navLabels()).not.toContain("Valuta");
  expect(toggle("Valuta").getAttribute("aria-checked")).toBe("false");

  click(toggle("Valuta"));
  expect(navLabels()).toContain("Valuta");
  expect(toggle("Valuta").getAttribute("aria-checked")).toBe("true");
});

test("the selection survives a reload — it is a local preference, not React state", () => {
  render();
  click(toggle("Punten"));
  expect(navLabels()).not.toContain("Punten");

  // What a reload actually reads back: the choice is stored, and it is the
  // ABSENCE of "punten" that has to survive.
  expect(JSON.parse(localStorage.getItem("lavega.navModules") ?? "null")).not.toContain("punten");

  // Tear the whole tree down and mount a fresh one, as a reload would.
  act(() => root!.unmount());
  container!.remove();
  render();
  expect(navLabels()).not.toContain("Punten");
});

test("Overzicht cannot be switched off — an app with no home is a broken app", () => {
  render();
  const home = toggle("Overzicht");
  expect(home.disabled).toBe(true);
  expect(home.getAttribute("aria-checked")).toBe("true");

  click(home); // a disabled button ignores it; prove the registry refuses too
  expect(navLabels()).toContain("Overzicht");

  expect(toggleModule(["overview", "valuta"], HOME_MODULE, false)).toContain("overview");
  expect(enabledModules([])).toEqual(["overview"]);
});

test("an unset preference is the default set, an emptied one is not", () => {
  expect(getEnabledModules()).toBeNull(); // never chosen
  expect(enabledModules(null)).toEqual(DEFAULT_MODULES);
  // Explicitly switching everything off is a real choice, not "never chosen".
  expect(enabledModules([])).toEqual([HOME_MODULE]);
});

test("the stored list is cleaned, deduped and kept in registry order", () => {
  const messy = ["valuta", "overview", "valuta", "een-module-die-niet-meer-bestaat"];
  const resolved = enabledModules(messy);
  expect(resolved).toEqual(["overview", "valuta"]);
  expect(navModules(resolved).map((m) => m.label)).toEqual(["Overzicht", "Valuta"]);
});

test("Transacties is een module die je kunt aanzetten, en die uit begint", () => {
  /* Review 4, punt 6. De route bestaat al — je komt er via een rekening — maar
   * er was geen eigen ingang meer sinds commit a52da45 hem uit de nav haalde.
   *
   * UIT als standaard, en dat is geen halve uitvoering van zijn vraag maar het
   * gevolg van diezelfde vraag: hij vroeg om een tab die je kunt AANZETTEN. Hem
   * in de gewone lijst zetten zou die verwijdering stilzwijgend terugdraaien bij
   * iedereen die nooit iets koos, en dat is een wijziging die niemand vroeg. */
  expect(DEFAULT_MODULES).not.toContain("transactions");
  render();
  expect(navLabels()).not.toContain("Transacties");
  // Wél in de picker: uit staan en niet bestaan zijn twee verschillende dingen,
  // en alleen het eerste is te veranderen.
  expect(toggle("Transacties").getAttribute("aria-checked")).toBe("false");

  click(toggle("Transacties"));
  expect(navLabels()).toContain("Transacties");
  expect(JSON.parse(localStorage.getItem("lavega.navModules") ?? "null")).toContain("transactions");

  // En dat overleeft een herstart, net als elke andere keuze in deze lijst.
  act(() => root!.unmount());
  container!.remove();
  render();
  expect(navLabels()).toContain("Transacties");
});

test("every registry entry carries what the picker shows: label, one line, icon, preview", () => {
  render();
  for (const m of MODULES) {
    expect(m.label.length, `${m.id} needs a Dutch label`).toBeGreaterThan(0);
    expect(m.what.length, `${m.id} needs a line of what it does`).toBeGreaterThan(0);
    expect(m.icon).toBeTruthy();
    expect(m.preview).toBeTruthy();
    expect(container!.textContent).toContain(m.label);
    expect(container!.textContent).toContain(m.what);
  }
  // One preview thumbnail per module, drawn (not screenshotted).
  expect(container!.querySelectorAll(".mp-preview svg.mp-thumb").length).toBe(MODULES.length);
});

/* ---------------------------------------------------------------------- *
 * Overzicht-widgets — Aandacht, Positie per bedrijf, Betaalagenda
 *
 * De eerste twee stonden vast op de startpagina, en dat is precies waarom ze
 * niet te schakelen waren: niets declareerde ze, dus er was niets om om te
 * zetten. Ze zijn nu registerregels met een eigen voorkeur, en de regels die
 * ze moeten volgen zijn andere dan die van de nav:
 *
 *   - een verse installatie toont ze NIET ("instead of it always being default
 *     there"), en
 *   - een installatie van vóór hen toont ze ook niet — hun id kan niet in de
 *     opgeslagen lijst staan, en "afwezig" moet daar als uit gelezen worden.
 *
 * BETAALAGENDA (review 4, punt 8) HOORT BIJ DEZELFDE LIJST MAAR NIET BIJ
 * DEZELFDE STANDAARD, en dat is de reden dat de drie tests hieronder herschreven
 * zijn in plaats van uitgebreid. Die kaart stond er al vóór er een schakelaar
 * was; hij vroeg om hem uit te kunnen zetten, niet om hem kwijt te raken. Hem
 * met de andere twee mee op "uit" zetten zou van één zin ("maak er een widget
 * van") een wijziging maken die niemand vroeg: de kaart verdwijnt dan bij
 * iedereen die nooit iets koos, en dat leest als verlies, niet als keuze.
 *
 * Daarom draagt de voorkeur nu twee lijsten (`{on, seen}`) en niet één. Eén
 * lijst kan het verschil niet dragen tussen "uitgezet" en "nooit gevraagd", en
 * dat verschil is precies waar een nieuwe widget in valt — dezelfde regel als
 * overal: onbekend is geen nul.
 * ---------------------------------------------------------------------- */

test("een verse installatie toont de twee gekozen kaarten niet, en de Betaalagenda wel", () => {
  // Nooit gekozen. Voor de NAV betekent dat "alles", want een nav leegmaken die
  // iemand al gebruikt leest als een storing; voor deze lijst betekent het per
  // kaart iets anders, en dat staat in `defaultOn`.
  expect(getEnabledWidgets()).toBeNull();
  expect(DEFAULT_WIDGETS).toEqual(["betaalagenda"]);
  expect(enabledWidgets(null)).toEqual(["betaalagenda"]);
});

test("een oude opgeslagen lijst zet alleen uit waar hij toen over ging", () => {
  /* De kale array is de vorm van vóór de Betaalagenda. Hij kan die id dus niet
   * bevatten, en zijn afwezigheid mag niet als "uitgezet" gelezen worden — de
   * vraag is die installatie nooit gesteld. Wat er WEL in stond gaat over
   * Aandacht en Positie, en daar is afwezig een echt antwoord. */
  expect(enabledWidgets(["aandacht"])).toEqual(["aandacht", "betaalagenda"]);
  expect(enabledWidgets([])).toEqual(["betaalagenda"]);
  // Een nav-lijst die per ongeluk hier belandt levert geen enkele widget op
  // behalve de standaard: geen van die ids is een widget.
  expect(enabledWidgets(["overview", "valuta", "punten"])).toEqual(["betaalagenda"]);
});

test("uitzetten werkt ook voor de kaart die standaard aan staat", () => {
  /* Zodra hij zich heeft uitgesproken telt afwezigheid wél, en niet meer
   * `defaultOn`. Zonder deze tweede lijst kwam de Betaalagenda door de deur van
   * "nooit gevraagd" terug en deed de schakelaar niets. */
  const gezien = ["aandacht", "positie", "betaalagenda"];
  expect(enabledWidgets({ on: [], seen: gezien })).toEqual([]);
  expect(enabledWidgets({ on: ["aandacht"], seen: gezien })).toEqual(["aandacht"]);
});

test("een lijst ids opschonen is iets anders dan een voorkeur lezen", () => {
  /* `normaliseWidgets` schoont een LIJST op; `enabledWidgets` leest een
   * VOORKEUR. Toen dat één functie was, kwam een uitgezette kaart terug: de
   * opgeschoonde lijst ging weer door de "nooit gevraagd"-deur. */
  expect(normaliseWidgets(["positie", "aandacht", "positie", "een-widget-die-niet-bestaat"])).toEqual([
    "aandacht",
    "positie",
  ]);
  expect(toggleWidget([], "positie", true)).toEqual(["positie"]);
  expect(toggleWidget(["aandacht", "positie"], "aandacht", false)).toEqual(["positie"]);
  // Geen enkele widget zit vast aan: anders dan Overzicht in de nav gaat de
  // startpagina niet stuk als er geen van deze kaarten op staat.
  expect(toggleWidget(["positie"], "positie", false)).toEqual([]);
  expect(toggleWidget(["betaalagenda"], "betaalagenda", false)).toEqual([]);
});

const widgetAccounts = [
  { key: "bv1", entity: "BV1 Holding", balance: 120_00 },
  { key: "prive", entity: "Privé", balance: 40_00 },
] as unknown as Parameters<typeof PositieWidget>[0]["accounts"];

/** The homescreen and the profile at once: the widgets as Overzicht would place
 *  them, plus the switch that decides whether they are there.
 *
 *  De Betaalagenda staat erbij als `BetaalschemaWidget`, en dat is de wrapper die
 *  Overzicht via de default-export óók krijgt. Alleen zo bewijst deze test wat er
 *  op het scherm gebeurt: een schakelaar toetsen zonder de kaart ernaast heeft
 *  eerder een schakelaar opgeleverd die niets deed (commit f4ee5fb). */
function WidgetShell() {
  const [widgets, setWidgets] = useOverviewWidgets();
  return (
    <>
      <AandachtWidget alerts={[]} bufferCents={250_000} onBufferChange={() => {}} />
      <PositieWidget accounts={widgetAccounts} onNavigate={() => {}} />
      <BetaalschemaWidget scheduledFlows={[]} txs={[]} asOf="2026-08-16" />
      <WidgetPicker enabled={widgets} onChange={setWidgets} />
    </>
  );
}

function renderWidgets() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<WidgetShell />));
  return container;
}

function widgetToggle(label: string): HTMLButtonElement {
  const el = container!.querySelector(`[aria-label="${label} op je overzicht"]`);
  if (!el) throw new Error(`no widget toggle for ${label}`);
  return el as HTMLButtonElement;
}

function card(label: string): Element | null {
  return container!.querySelector(`section[aria-label="${label}"]`);
}

test("the picker puts a widget on the overview and takes it off again", () => {
  renderWidgets();
  // Off by default: the card is not on the page at all, not merely empty.
  expect(card("Aandacht")).toBeNull();
  expect(card("Positie per bedrijf")).toBeNull();
  expect(widgetToggle("Aandacht").getAttribute("aria-checked")).toBe("false");
  expect(widgetToggle("Aandacht").disabled).toBe(false);

  click(widgetToggle("Positie per bedrijf"));
  expect(card("Positie per bedrijf")).not.toBeNull();
  expect(card("Positie per bedrijf")!.textContent).toContain("BV1 Holding");
  expect(card("Aandacht")).toBeNull(); // one switch moves one widget

  click(widgetToggle("Positie per bedrijf"));
  expect(card("Positie per bedrijf")).toBeNull();
});

test("a widget he switched on survives a reload; one he never touched stays off", () => {
  renderWidgets();
  click(widgetToggle("Aandacht"));
  expect(card("Aandacht")).not.toBeNull();
  /* Wat er ECHT wordt weggeschreven: wat aan staat én waar hij zich over heeft
   * uitgesproken. De Betaalagenda staat in `on` omdat hij aan stond toen hij op
   * Aandacht klikte — een schakelaar omzetten mag nooit een andere kaart
   * meenemen. En `seen` is de hele lijst, want de picker toont ze alle drie
   * tegelijk: wie er één omzet heeft de rest ook voor zich gehad. */
  expect(JSON.parse(localStorage.getItem("lavega.overviewWidgets") ?? "null")).toEqual({
    on: ["aandacht", "betaalagenda"],
    seen: ["aandacht", "positie", "betaalagenda"],
  });

  // Tear the tree down and mount a fresh one, as a reload would.
  act(() => root!.unmount());
  container!.remove();
  renderWidgets();
  expect(card("Aandacht")).not.toBeNull();
  expect(card("Positie per bedrijf")).toBeNull();
  expect(card("Betaalagenda")).not.toBeNull();
});

test("de Betaalagenda staat er vanaf de eerste render, en gaat pas weg als hij hem uitzet", () => {
  /* Review 4, punt 8 in twee helften. Het is één kaart die allebei moet doen:
   * er staan zonder dat iemand erom vroeg (want dat deed hij al), en weggaan
   * zodra hij dat zegt (want dat is wat hij vroeg). */
  renderWidgets();
  expect(card("Betaalagenda")).not.toBeNull();
  expect(widgetToggle("Betaalagenda").getAttribute("aria-checked")).toBe("true");
  expect(widgetToggle("Betaalagenda").disabled).toBe(false);

  click(widgetToggle("Betaalagenda"));
  expect(card("Betaalagenda")).toBeNull();

  // En dat uitzetten overleeft een herstart — anders komt de kaart terug door de
  // deur van "nooit gevraagd" en heeft de schakelaar alleen deze sessie gehaald.
  act(() => root!.unmount());
  container!.remove();
  renderWidgets();
  expect(card("Betaalagenda")).toBeNull();
  expect(widgetToggle("Betaalagenda").getAttribute("aria-checked")).toBe("false");
});

test("the widget preference is its own key — switching a widget leaves the nav alone", () => {
  renderWidgets();
  click(widgetToggle("Aandacht"));
  // The nav list is untouched: two lists that mean different things must not
  // share a key, or an old nav preference would decide a widget's default.
  expect(localStorage.getItem("lavega.navModules")).toBeNull();
  expect(getEnabledModules()).toBeNull();
  expect(enabledModules(getEnabledModules())).toEqual(DEFAULT_MODULES);
});

test("every widget entry carries what the picker shows: label, one line, preview", () => {
  renderWidgets();
  for (const w of WIDGETS) {
    expect(w.label.length, `${w.id} needs a Dutch label`).toBeGreaterThan(0);
    expect(w.what.length, `${w.id} needs a line of what it does`).toBeGreaterThan(0);
    expect(w.preview).toBeTruthy();
    expect(container!.textContent).toContain(w.label);
    expect(container!.textContent).toContain(w.what);
  }
  expect(container!.querySelectorAll(".module-picker .mp-preview svg.mp-thumb").length).toBeGreaterThanOrEqual(
    WIDGETS.length,
  );
});
