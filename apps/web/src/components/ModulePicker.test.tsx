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
  toggleModule,
  toggleWidget,
  useOverviewWidgets,
  type ModuleId,
} from "./moduleRegistry";
import { AandachtWidget } from "./blocks/AandachtBlock";
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
 * Overzicht-widgets — Aandacht and Positie per bedrijf
 *
 * These two were hard-placed on the homescreen, which is exactly why they
 * could not be switched: nothing declared them, so there was nothing to
 * toggle. They are now registry entries with their own preference, and the
 * rules they have to obey are different from the nav's:
 *
 *   - a fresh install shows NEITHER ("instead of it always being default
 *     there"), and
 *   - an install that predates them shows neither either — its stored list
 *     cannot contain an id that did not exist, and "absent" must be read as
 *     off, never as on.
 * ---------------------------------------------------------------------- */

test("both widgets are off until he switches them on — fresh install and old install alike", () => {
  // Never chosen. For the NAV that means "everything", because emptying a nav
  // someone already uses reads as a fault; for these two it means nothing,
  // because they were never asked for.
  expect(getEnabledWidgets()).toBeNull();
  expect(enabledWidgets(null)).toEqual([]);
  expect(DEFAULT_WIDGETS).toEqual([]);

  // An older stored list — whatever it holds — carries no widget id, and an
  // absent id is off.
  expect(enabledWidgets(["overview", "valuta", "punten"])).toEqual([]);
  expect(enabledWidgets([])).toEqual([]);
});

test("a stored widget list is cleaned, deduped and kept in registry order", () => {
  expect(enabledWidgets(["positie", "aandacht", "positie", "een-widget-die-niet-bestaat"])).toEqual([
    "aandacht",
    "positie",
  ]);
  expect(toggleWidget([], "positie", true)).toEqual(["positie"]);
  expect(toggleWidget(["aandacht", "positie"], "aandacht", false)).toEqual(["positie"]);
  // No widget is locked on: unlike Overzicht in the nav, the homescreen is not
  // broken by having neither of these on it.
  expect(toggleWidget(["positie"], "positie", false)).toEqual([]);
});

const widgetAccounts = [
  { key: "bv1", entity: "BV1 Holding", balance: 120_00 },
  { key: "prive", entity: "Privé", balance: 40_00 },
] as unknown as Parameters<typeof PositieWidget>[0]["accounts"];

/** The homescreen and the profile at once: the two widgets as Overzicht would
 *  place them, plus the switch that decides whether they are there. */
function WidgetShell() {
  const [widgets, setWidgets] = useOverviewWidgets();
  return (
    <>
      <AandachtWidget alerts={[]} bufferCents={250_000} onBufferChange={() => {}} />
      <PositieWidget accounts={widgetAccounts} onNavigate={() => {}} />
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
  expect(JSON.parse(localStorage.getItem("lavega.overviewWidgets") ?? "null")).toEqual(["aandacht"]);

  // Tear the tree down and mount a fresh one, as a reload would.
  act(() => root!.unmount());
  container!.remove();
  renderWidgets();
  expect(card("Aandacht")).not.toBeNull();
  expect(card("Positie per bedrijf")).toBeNull();
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
