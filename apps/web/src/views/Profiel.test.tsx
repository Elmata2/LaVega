// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Account } from "@lavega/core";
import { entitySummaries } from "@lavega/core";
import type { VaultStorage } from "@lavega/adapters";
import Profiel from "./Profiel";
import { enabledModules } from "../components/moduleRegistry";
import { getHomeCountry } from "../settings";

/* Regels, Koppelingen, Back-up and Import were never workspaces — they are
 * settings, and they now live in the profile. These prove they are really
 * THERE (the same components, rendered on this page), that the country the tax
 * rules read is editable here, and that Vergrendelen is reachable. */

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

/** Backup only calls storage on a click; rendering it needs nothing else. */
const storage = { export: () => null, restore: async () => false } as unknown as VaultStorage;

function render(overrides: Partial<Parameters<typeof Profiel>[0]> = {}) {
  const props: Parameters<typeof Profiel>[0] = {
    enabledModules: enabledModules(null),
    onModulesChange: () => {},
    focusModules: 0,
    entities: entitySummaries(
      [
        { key: "prive", entity: "Privé" } as Account,
        { key: "bv1", entity: "BV1 Holding" } as Account,
      ],
      [],
    ),
    onClassifyEntity: () => {},
    homeCountry: "NL",
    onHomeCountryChange: () => {},
    onLock: () => {},
    entity: "BV1",
    onEntityChange: () => {},
    busy: false,
    problems: [],
    onImport: () => {},
    rules: [{ id: "r1", match: "albert heijn", category: "Boodschappen" }],
    ruleMatch: "",
    onRuleMatchChange: () => {},
    ruleCategory: "",
    onRuleCategoryChange: () => {},
    onSaveRules: () => {},
    storage,
    asOf: "2026-08-16",
    onRestored: () => {},
    ...overrides,
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<Profiel {...props} />));
  return container;
}

function section(label: string): HTMLElement {
  const el = container!.querySelector(`[aria-label="${label}"]`);
  if (!el) throw new Error(`no section labelled "${label}"`);
  return el as HTMLElement;
}

test("Regels, Koppelingen, Back-up and Import all render inside the profile", () => {
  render();
  expect(section("Regels").textContent).toContain("albert heijn");
  // Koppelingen has no aria-label wrapper of its own; its fields identify it.
  expect(container!.querySelector('[aria-label="n8n webhook-URL"]')).not.toBeNull();
  expect(section("Importeren").querySelector('input[type="file"]')).not.toBeNull();
  expect(container!.textContent).toContain("Back-up");
});

test("the module picker is on the profile, with Overzicht locked on", () => {
  render();
  const picker = section("Modules");
  expect(picker.querySelectorAll(".mp-item").length).toBeGreaterThan(1);
  const home = picker.querySelector('[aria-label="Overzicht in de navigatie"]') as HTMLButtonElement;
  expect(home.disabled).toBe(true);
});

test("the country that drives the tax rules is set here, and says what it covers", () => {
  const onHomeCountryChange = vi.fn();
  render({ onHomeCountryChange });
  const select = section("Land").querySelector("select") as HTMLSelectElement;
  expect(select.value).toBe("NL");
  expect(getHomeCountry()).toBe("NL"); // the same preference App reads
  expect(section("Land").textContent).toContain("alleen voor Nederland");

  act(() => {
    select.value = "BE";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(onHomeCountryChange).toHaveBeenCalledWith("BE");
});

test("the half each entity belongs to is set here, and says what is not classified", () => {
  const onClassifyEntity = vi.fn();
  render({ onClassifyEntity });
  const list = section("Persoonlijk of zakelijk");
  expect(list.textContent).toContain("Privé");
  expect(list.textContent).toContain("BV1 Holding");
  // Neither is classified yet, so both count as persoonlijk — said out loud
  // rather than implied, and the name that reads as a company is flagged.
  expect(list.textContent).toContain("niet ingedeeld, telt als persoonlijk");
  expect(list.textContent).toContain("de naam leest als zakelijk");

  const zakelijk = list.querySelector('[aria-label="BV1 Holding zakelijk"]') as HTMLButtonElement;
  expect(zakelijk.getAttribute("aria-pressed")).toBe("false");
  act(() => {
    zakelijk.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(onClassifyEntity).toHaveBeenCalledWith("BV1 Holding", "business");
});

test("an entity already classified shows its half as the pressed option", () => {
  render({
    entities: entitySummaries([{ key: "bv1", entity: "BV1" } as Account], [{ entity: "BV1", scope: "business" }]),
  });
  const list = section("Persoonlijk of zakelijk");
  expect((list.querySelector('[aria-label="BV1 zakelijk"]') as HTMLButtonElement).getAttribute("aria-pressed")).toBe("true");
  expect((list.querySelector('[aria-label="BV1 persoonlijk"]') as HTMLButtonElement).getAttribute("aria-pressed")).toBe("false");
  expect(list.textContent).not.toContain("niet ingedeeld");
});

test("Vergrendelen moved here from the app bar and still locks", () => {
  const onLock = vi.fn();
  render({ onLock });
  const button = [...section("Vergrendelen").querySelectorAll("button")].find((b) => (b.textContent ?? "").includes("Vergrendel"));
  expect(button).toBeTruthy();
  act(() => {
    button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(onLock).toHaveBeenCalledTimes(1);
});
