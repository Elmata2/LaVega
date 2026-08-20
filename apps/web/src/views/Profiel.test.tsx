// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Account } from "@lavega/core";
import { entitySummaries } from "@lavega/core";
import type { VaultStorage } from "@lavega/adapters";
import Profiel from "./Profiel";
import { enabledModules } from "../components/moduleRegistry";
import { COUNTRY_CODES } from "../countries";
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
    homeRegion: "",
    onHomeRegionChange: () => {},
    ownerName: { first: "", last: "" },
    onOwnerNameChange: () => {},
    onLock: () => {},
    entity: "Persoonlijk",
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

/** React tracks an input's value, so a bare `el.value = x` is invisible to it —
 *  the native setter has to be used or onChange never fires. */
function setNativeValue(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
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
  const select = section("Land en regio").querySelector("select") as HTMLSelectElement;
  expect(select.value).toBe("NL");
  expect(getHomeCountry()).toBe("NL"); // the same preference App reads
  expect(section("Land en regio").textContent).toContain("alleen voor Nederland");

  act(() => {
    select.value = "BE";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(onHomeCountryChange).toHaveBeenCalledWith("BE");
});

test("the country list is EVERY country, in Dutch, sorted", () => {
  render();
  const options = [...section("Land en regio").querySelectorAll("select option")];
  expect(options.length).toBe(COUNTRY_CODES.length);
  expect(options.length).toBeGreaterThan(200); // a list, not a shortlist

  const names = options.map((o) => o.textContent ?? "");
  expect(names).toContain("Nederland");
  expect(names).toContain("Verenigde Staten"); // Dutch, not "United States"
  expect([...names].sort((a, b) => a.localeCompare(b, "nl"))).toEqual(names);
});

test("a region sits under the country, and is only a LIST where we have one", () => {
  // His example: Texas is not New York. The US gets a real list…
  render({ homeCountry: "US" });
  const us = section("Land en regio");
  expect(us.querySelector('input[list="home-regions"]')).not.toBeNull();
  const states = [...us.querySelectorAll("datalist option")].map((o) => o.getAttribute("value"));
  expect(states).toContain("Texas");
  expect(states).toContain("New York");

  // …and a country whose subdivisions LaVega cannot vouch for gets free text
  // plus a sentence saying so, rather than a dropdown of guesses.
  render({ homeCountry: "NL" });
  const nl = section("Land en regio");
  expect(nl.querySelector("datalist")).toBeNull();
  expect(nl.textContent).toContain("geen geverifieerde regiolijst");
});

test("the region is typed by hand, and the app never infers where he is", () => {
  const onHomeRegionChange = vi.fn();
  render({ homeCountry: "US", onHomeRegionChange });
  const input = section("Land en regio").querySelector('input[list="home-regions"]') as HTMLInputElement;
  act(() => setNativeValue(input, "Texas"));
  expect(onHomeRegionChange).toHaveBeenCalledWith("Texas");
  expect(section("Land en regio").textContent).toContain("LaVega leidt nooit af waar je bent");
});

test("the profile opens with his own name, and says the name stays here", () => {
  render({ ownerName: { first: "Alexander", last: "Steunenberg" } });
  const head = section("Profiel");
  expect(head.querySelector(".profile-head-name")?.textContent).toBe("Alexander Steunenberg");
  expect(head.querySelector(".profile-head-avatar")?.textContent).toBe("AS"); // drawn, never fetched
  expect(head.textContent).toContain("nooit meegestuurd naar een model");
});

test("no name is 'no name', not a blank greeting", () => {
  render();
  const head = section("Profiel");
  expect(head.querySelector(".profile-head-name")?.textContent).toBe("Nog geen naam ingevuld");
  expect(head.querySelector(".profile-head-avatar")?.textContent).toBe("");
});

test("typing a name reports both halves back, unmangled", () => {
  const onOwnerNameChange = vi.fn();
  render({ ownerName: { first: "Alexander", last: "" }, onOwnerNameChange });
  const last = section("Profiel").querySelector('input[aria-label="Achternaam"]') as HTMLInputElement;
  act(() => setNativeValue(last, "Steunenberg"));
  expect(onOwnerNameChange).toHaveBeenCalledWith({ first: "Alexander", last: "Steunenberg" });
});

test("Koppelingen explains itself behind an eye, and the fields stay in the open", () => {
  render();
  // The value you came to set is visible without opening anything…
  expect(container!.querySelector('[aria-label="n8n webhook-URL"]')).not.toBeNull();
  expect(container!.textContent).not.toContain("Production URL — niet de Test URL");

  const eye = container!.querySelector('[aria-label="Uitleg bij de webhook-URL"]') as HTMLButtonElement;
  expect(eye).not.toBeNull();
  expect(eye.getAttribute("aria-expanded")).toBe("false");
  act(() => eye.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(container!.textContent).toContain("Production URL");
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

/* The two homescreen widgets he wants to be able to switch: "Positie per
 * onderneming […] I just want it to be a widget we can click on and off, so in
 * the profile I should be able to click it on and off instead of it always
 * being default there. Same applies to Aandacht." */

test("the two overview widgets are switched here, and both start off", () => {
  render();
  const widgets = section("Widgets");
  expect(widgets.querySelectorAll(".mp-item").length).toBe(2);
  expect(widgets.textContent).toContain("Aandacht");
  expect(widgets.textContent).toContain("Positie per bedrijf");

  for (const label of ["Aandacht", "Positie per bedrijf"]) {
    const toggle = widgets.querySelector(`[aria-label="${label} op je overzicht"]`) as HTMLButtonElement;
    expect(toggle, `no switch for ${label}`).not.toBeNull();
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    expect(toggle.disabled).toBe(false); // neither is locked on, unlike Overzicht in the nav
  }
});

test("switching a widget on is remembered, and does not touch the nav preference", () => {
  render();
  const toggle = section("Widgets").querySelector('[aria-label="Aandacht op je overzicht"]') as HTMLButtonElement;
  act(() => toggle.dispatchEvent(new MouseEvent("click", { bubbles: true })));
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  expect(JSON.parse(localStorage.getItem("lavega.overviewWidgets") ?? "null")).toEqual(["aandacht"]);
  expect(localStorage.getItem("lavega.navModules")).toBeNull();
});

/* "Keep the manual linkage rules and their explanation." Nailed down, because
 * this round removes several blocks and this one must survive the cull. */
test("the manual rules keep their explanation of how a match is decided", () => {
  render();
  const regels = section("Regels");
  expect(regels.textContent).toContain("Je eigen regels hieronder gaan vóór die automatische categorieën");
  expect(regels.textContent).toContain("eerste");
  expect(regels.querySelector("input")).not.toBeNull(); // and you can still add one
});
