// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Account, Tx } from "@lavega/core";
import { CATEGORY_OPTIONS } from "@lavega/core";
import Transacties from "./Transacties";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* The per-row category picker: every row can be changed (not only "onbekend"),
 * the choice goes out through onChooseCategory (App persists it through the
 * same path as the AI apply flow), and the feedback states only the numbers
 * the callback returned. */

const ACCOUNTS: Account[] = [
  {
    key: "NL01INGB",
    iban: "NL01INGB",
    name: "Betaalrekening",
    bank: "ING",
    entity: "Prive",
    currency: "EUR",
    balance: 100,
  },
];

const tx = (id: string, cp: string, desc = "Aankoop"): Tx => ({
  id,
  accountKey: "NL01INGB",
  date: "2026-07-14",
  amount: -20,
  currency: "EUR",
  counterparty: cp,
  description: desc,
  category: "",
  manual: false,
});

type Choose = (
  id: string,
  category: string,
) => Promise<{ followers: number; rulesAdded: number; rememberFailed?: boolean }>;

const props = (txs: Tx[], onChooseCategory: Choose) =>
  ({
    accounts: ACCOUNTS,
    scopedTxs: txs,
    rules: [],
    own: { all: [], byKey: new Map<string, string[]>() },
    fxHistory: {},
    mode: "separate",
    entityOptions: ["Prive"],
    entityScope: "",
    fEntity: "",
    onFEntityChange: () => {},
    fAccount: "",
    onFAccountChange: () => {},
    fSearch: "",
    onFSearchChange: () => {},
    fFrom: "",
    onFFromChange: () => {},
    fTo: "",
    onFToChange: () => {},
    fCategory: "",
    onFCategoryChange: () => {},
    configured: false,
    onApplyCategories: async () => {},
    onChooseCategory,
    transfers: [],
    suggestions: [],
    onConfirmTransfer: () => {},
    onRejectTransfer: () => {},
  }) as unknown as Parameters<typeof Transacties>[0];

beforeEach(() => {
  document.cookie = "lavega_locale=nl; Path=/";
});
afterEach(() => {
  document.cookie = "lavega_locale=; Path=/; Max-Age=0";
  document.body.innerHTML = "";
});

const noop: Choose = async () => ({ followers: 0, rulesAdded: 0 });

function mount(node: React.ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  act(() => createRoot(container).render(node));
  return container;
}

test("every row, placed or onbekend, offers a named change control", () => {
  const html = renderToStaticMarkup(
    <Transacties
      {...props([tx("t1", "Albert Heijn"), tx("t2", "TIENDA J LOPEZ", "VALENCIA ESP")], noop)}
    />,
  );
  expect(html).toContain('aria-label="Categorie wijzigen voor Albert Heijn"');
  expect(html).toContain('aria-label="Categorie wijzigen voor TIENDA J LOPEZ"');
});

test("the picker is a native select with the canonical categories; a choice reports through onChooseCategory", async () => {
  const choose = vi.fn<Choose>(async () => ({ followers: 2, rulesAdded: 1 }));
  const el = mount(<Transacties {...props([tx("t1", "TIENDA J LOPEZ")], choose)} />);
  const btn = el.querySelector<HTMLButtonElement>(
    'button[aria-label="Categorie wijzigen voor TIENDA J LOPEZ"]',
  )!;
  expect(btn).toBeTruthy();
  act(() => btn.click());

  const select = el.querySelector<HTMLSelectElement>(
    'select[aria-label="Categorie wijzigen voor TIENDA J LOPEZ"]',
  )!;
  expect(select).toBeTruthy();
  // placeholder + every canonical category, nothing else
  expect(select.options.length).toBe(CATEGORY_OPTIONS.length + 1);

  await act(async () => {
    select.value = "Eten & drinken";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(choose).toHaveBeenCalledTimes(1);
  expect(choose).toHaveBeenCalledWith("t1", "Eten & drinken");
  expect(el.querySelector('[role="status"]')?.textContent).toContain(
    "Categorie gezet. 2 andere transacties van TIENDA J LOPEZ volgen mee.",
  );
  // the select closes after a choice
  expect(el.querySelector("select[aria-label^='Categorie wijzigen voor']")).toBeNull();
});

test("when nothing else follows and no rule was added, no number or promise is claimed", async () => {
  const choose = vi.fn<Choose>(async () => ({ followers: 0, rulesAdded: 0 }));
  const el = mount(<Transacties {...props([tx("t1", "NL17INGB0539576085")], choose)} />);
  act(() =>
    el.querySelector<HTMLButtonElement>("button[aria-label^='Categorie wijzigen']")!.click(),
  );
  const select = el.querySelector<HTMLSelectElement>("select[aria-label^='Categorie wijzigen']")!;
  await act(async () => {
    select.value = "Overboekingen";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const text = el.querySelector('[role="status"]')?.textContent ?? "";
  expect(text).toBe("Categorie gezet.");
});

test("Escape closes the picker without choosing", () => {
  const choose = vi.fn<Choose>(noop);
  const el = mount(<Transacties {...props([tx("t1", "Albert Heijn")], choose)} />);
  act(() =>
    el.querySelector<HTMLButtonElement>("button[aria-label^='Categorie wijzigen']")!.click(),
  );
  const select = el.querySelector<HTMLSelectElement>("select[aria-label^='Categorie wijzigen']")!;
  act(() => {
    select.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(el.querySelector("select[aria-label^='Categorie wijzigen']")).toBeNull();
  expect(choose).not.toHaveBeenCalled();
});

test("a failed save is reported, not swallowed", async () => {
  const choose = vi.fn<Choose>(async () => {
    throw new Error("opslaan mislukt");
  });
  const el = mount(<Transacties {...props([tx("t1", "Albert Heijn")], choose)} />);
  act(() =>
    el.querySelector<HTMLButtonElement>("button[aria-label^='Categorie wijzigen']")!.click(),
  );
  const select = el.querySelector<HTMLSelectElement>("select[aria-label^='Categorie wijzigen']")!;
  await act(async () => {
    select.value = "Transport";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(el.querySelector('[role="alert"]')?.textContent).toContain("opslaan mislukt");
});

test("a rejected rule write says the category was set but not remembered", async () => {
  const choose = vi.fn<Choose>(async () => ({ followers: 0, rulesAdded: 0, rememberFailed: true }));
  const el = mount(<Transacties {...props([tx("t1", "Albert Heijn")], choose)} />);
  act(() =>
    el.querySelector<HTMLButtonElement>("button[aria-label^='Categorie wijzigen']")!.click(),
  );
  const select = el.querySelector<HTMLSelectElement>("select[aria-label^='Categorie wijzigen']")!;
  await act(async () => {
    select.value = "Transport";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const text = el.querySelector('[role="status"]')?.textContent ?? "";
  expect(text).toContain("niet onthouden");
  expect(text).not.toContain("volgen mee");
});

test("while a save is pending no picker can be opened", async () => {
  let release!: () => void;
  const choose = vi.fn<Choose>(
    () =>
      new Promise((resolve) => {
        release = () => resolve({ followers: 0, rulesAdded: 0 });
      }),
  );
  const el = mount(
    <Transacties {...props([tx("t1", "Albert Heijn"), tx("t2", "Zorgeloos Qwx")], choose)} />,
  );
  act(() =>
    el.querySelector<HTMLButtonElement>("button[aria-label^='Categorie wijzigen']")!.click(),
  );
  const select = el.querySelector<HTMLSelectElement>("select[aria-label^='Categorie wijzigen']")!;
  await act(async () => {
    select.value = "Transport";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const buttons = [
    ...el.querySelectorAll<HTMLButtonElement>("button[aria-label^='Categorie wijzigen']"),
  ];
  expect(buttons.length).toBe(2);
  expect(buttons.every((b) => b.disabled)).toBe(true);
  await act(async () => release());
  expect(
    [...el.querySelectorAll<HTMLButtonElement>("button[aria-label^='Categorie wijzigen']")].every(
      (b) => !b.disabled,
    ),
  ).toBe(true);
  expect(choose).toHaveBeenCalledTimes(1);
});

function openPicker(el: HTMLElement): HTMLSelectElement {
  act(() =>
    el.querySelector<HTMLButtonElement>("button[aria-label^='Categorie wijzigen']")!.click(),
  );
  return el.querySelector<HTMLSelectElement>("select[aria-label^='Categorie wijzigen']")!;
}
const change = (sel: HTMLSelectElement, v: string) =>
  act(async () => {
    sel.value = v;
    sel.dispatchEvent(new Event("change", { bubbles: true }));
  });
const key = (sel: HTMLSelectElement, k: string) =>
  act(async () => {
    sel.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
  });

test("keyboard navigation only drafts; Enter commits exactly once", async () => {
  const choose = vi.fn<Choose>(noop);
  const el = mount(<Transacties {...props([tx("t1", "Albert Heijn")], choose)} />);
  const sel = openPicker(el);
  await key(sel, "ArrowDown");
  await change(sel, "Eten & drinken");
  await key(sel, "ArrowDown");
  await change(sel, "Transport");
  expect(choose).not.toHaveBeenCalled();
  await key(sel, "Enter");
  expect(choose).toHaveBeenCalledTimes(1);
  expect(choose).toHaveBeenCalledWith("t1", "Transport");
});

test("Enter on an open popup (Enter, then change) commits once", async () => {
  const choose = vi.fn<Choose>(noop);
  const el = mount(<Transacties {...props([tx("t1", "Albert Heijn")], choose)} />);
  const sel = openPicker(el);
  await key(sel, "ArrowDown");
  await key(sel, "Enter");
  await change(sel, "Transport");
  expect(choose).toHaveBeenCalledTimes(1);
});

const blur = (sel: HTMLSelectElement) =>
  act(async () => {
    sel.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });

test("Space-open then a pointer pick with no pointerdown on the select: saved once (change, then blur)", async () => {
  const choose = vi.fn<Choose>(noop);
  const el = mount(<Transacties {...props([tx("t1", "Albert Heijn")], choose)} />);
  const sel = openPicker(el);
  await key(sel, "ArrowDown"); // opens the popup; marks keyboard navigation
  await change(sel, "Transport"); // the OS popup click reaches only `change`
  expect(choose).not.toHaveBeenCalled(); // a draft, not yet saved
  await blur(sel);
  expect(choose).toHaveBeenCalledTimes(1);
  expect(choose).toHaveBeenCalledWith("t1", "Transport");
});

test("arrows then Tab away: the draft is saved once", async () => {
  const choose = vi.fn<Choose>(noop);
  const el = mount(<Transacties {...props([tx("t1", "Albert Heijn")], choose)} />);
  const sel = openPicker(el);
  await key(sel, "ArrowDown");
  await change(sel, "Transport");
  await key(sel, "Tab"); // Tab is not a navigation key and commits nothing by itself
  expect(choose).not.toHaveBeenCalled();
  await blur(sel);
  expect(choose).toHaveBeenCalledTimes(1);
  expect(choose).toHaveBeenCalledWith("t1", "Transport");
});

test("arrows then Escape: nothing saved, the old category is shown", async () => {
  const choose = vi.fn<Choose>(noop);
  const el = mount(<Transacties {...props([tx("t1", "Albert Heijn")], choose)} />);
  const sel = openPicker(el);
  await key(sel, "ArrowDown");
  await change(sel, "Transport");
  await key(sel, "Escape");
  expect(el.querySelector("select[aria-label^='Categorie wijzigen']")).toBeNull();
  expect(el.querySelector("tbody")?.textContent).toContain("Boodschappen");
  expect(choose).not.toHaveBeenCalled();
});

test("arrows, Enter, then the resulting blur: saved exactly once", async () => {
  const choose = vi.fn<Choose>(noop);
  const el = mount(<Transacties {...props([tx("t1", "Albert Heijn")], choose)} />);
  const sel = openPicker(el);
  await key(sel, "ArrowDown");
  await change(sel, "Transport");
  await key(sel, "Enter");
  await blur(sel);
  expect(choose).toHaveBeenCalledTimes(1);
});

test("touch-only change (no key at all) saves immediately, once", async () => {
  const choose = vi.fn<Choose>(noop);
  const el = mount(<Transacties {...props([tx("t1", "Albert Heijn")], choose)} />);
  const sel = openPicker(el);
  await change(sel, "Transport");
  expect(choose).toHaveBeenCalledTimes(1);
  await blur(sel);
  expect(choose).toHaveBeenCalledTimes(1);
});

test("Space and Tab are not navigation keys: a change after them still commits at once", async () => {
  const choose = vi.fn<Choose>(noop);
  const el = mount(<Transacties {...props([tx("t1", "Albert Heijn")], choose)} />);
  const sel = openPicker(el);
  await key(sel, " ");
  await change(sel, "Transport");
  expect(choose).toHaveBeenCalledTimes(1);
});

test("a change to the value already shown saves nothing", async () => {
  const choose = vi.fn<Choose>(noop);
  const el = mount(<Transacties {...props([tx("t1", "Albert Heijn")], choose)} />);
  const sel = openPicker(el);
  await change(sel, "Boodschappen"); // Albert Heijn is already Boodschappen
  expect(choose).not.toHaveBeenCalled();
  const sel2 = openPicker(el);
  await key(sel2, "ArrowDown");
  await change(sel2, "Boodschappen");
  await blur(sel2);
  expect(choose).not.toHaveBeenCalled();
});
