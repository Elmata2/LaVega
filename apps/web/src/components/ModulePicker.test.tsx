// @vitest-environment jsdom
import { useState, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test } from "vitest";
import ModulePicker from "./ModulePicker";
import NavBar from "./NavBar";
import { DEFAULT_MODULES, HOME_MODULE, MODULES, enabledModules, navModules, toggleModule, type ModuleId } from "./moduleRegistry";
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

test("the picker toggles a module into the nav and back out again", () => {
  render();
  expect(navLabels()).not.toContain("Valuta");

  click(toggle("Valuta"));
  expect(navLabels()).toContain("Valuta");
  expect(toggle("Valuta").getAttribute("aria-checked")).toBe("true");

  click(toggle("Valuta"));
  expect(navLabels()).not.toContain("Valuta");
  expect(toggle("Valuta").getAttribute("aria-checked")).toBe("false");
});

test("the selection survives a reload — it is a local preference, not React state", () => {
  render();
  click(toggle("Punten"));
  expect(navLabels()).toContain("Punten");

  // What a reload actually reads back.
  expect(JSON.parse(localStorage.getItem("lavega.navModules") ?? "null")).toContain("punten");

  // Tear the whole tree down and mount a fresh one, as a reload would.
  act(() => root!.unmount());
  container!.remove();
  render();
  expect(navLabels()).toContain("Punten");
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
