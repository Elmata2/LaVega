// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Account, Tx } from "@lavega/core";

vi.mock("../api", () => ({
  categorizeTxs: vi.fn(async (items: { id: string }[]) =>
    items.map((i) => ({ id: i.id, category: "Transport" })),
  ),
}));

import Transacties from "./Transacties";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ACCOUNTS: Account[] = [
  {
    key: "NL01INGB",
    iban: "NL01INGB",
    name: "B",
    bank: "ING",
    entity: "Prive",
    currency: "EUR",
    balance: 1,
  },
];
const tx = (id: string, cp: string): Tx => ({
  id,
  accountKey: "NL01INGB",
  date: "2026-07-14",
  amount: -20,
  currency: "EUR",
  counterparty: cp,
  description: "VALENCIA ESP",
  category: "",
  manual: false,
});

type Apply = (d: unknown[]) => Promise<void | { rememberFailed?: boolean }>;
const props = (onApplyCategories: Apply) =>
  ({
    accounts: ACCOUNTS,
    scopedTxs: [tx("t1", "TIENDA J LOPEZ")],
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
    configured: true,
    onApplyCategories,
    onChooseCategory: async () => ({ followers: 0, rulesAdded: 0 }),
    transfers: [],
    suggestions: [],
    onConfirmTransfer: () => {},
    onRejectTransfer: () => {},
  }) as unknown as Parameters<typeof Transacties>[0];

beforeEach(() => {
  document.cookie = "lavega_locale=nl; Path=/";
  localStorage.setItem("lavega.aiCategorize", "1");
});
afterEach(() => {
  document.cookie = "lavega_locale=; Path=/; Max-Age=0";
  document.body.innerHTML = "";
  localStorage.clear();
});

const btn = (el: HTMLElement, text: string) =>
  [...el.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes(text))!;

async function toReview(onApply: Apply) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  act(() => createRoot(container).render(<Transacties {...props(onApply)} />));
  await act(async () => btn(container, "Laat de AI").click());
  expect(btn(container, "Toepassen")).toBeTruthy();
  return container;
}

test("a rejected rule write after the txs were saved leaves review with a visible warning", async () => {
  const apply = vi.fn<Apply>(async () => ({ rememberFailed: true }));
  const el = await toReview(apply);
  await act(async () => btn(el, "Toepassen").click());
  const alert = el.querySelector('[role="alert"]');
  expect(alert?.textContent).toContain("Categorieën gezet, maar de regels zijn niet onthouden");
  // review is closed: no second apply can double-apply the txs
  expect([...el.querySelectorAll("button")].some((b) => b.textContent?.includes("Toepassen"))).toBe(
    false,
  );
  expect(apply).toHaveBeenCalledTimes(1);
});

test("a rejected tx write keeps the review open and shows the problem message", async () => {
  const apply = vi.fn<Apply>(async () => {
    throw new Error("opslaan mislukt");
  });
  const el = await toReview(apply);
  await act(async () => btn(el, "Toepassen").click());
  expect(el.querySelector('[role="alert"]')?.textContent).toContain("opslaan mislukt");
  expect(btn(el, "Toepassen")).toBeTruthy();
});

test("Toepassen is disabled while the apply is pending", async () => {
  let release!: () => void;
  const apply = vi.fn<Apply>(() => new Promise((r) => (release = () => r())));
  const el = await toReview(apply);
  await act(async () => btn(el, "Toepassen").click());
  expect(btn(el, "Toepassen").disabled).toBe(true);
  // and no row picker can start while the apply is saving
  const pickers = [
    ...el.querySelectorAll<HTMLButtonElement>("button[aria-label^='Categorie wijzigen']"),
  ];
  expect(pickers.length).toBeGreaterThan(0);
  expect(pickers.every((b) => b.disabled)).toBe(true);
  await act(async () => release());
});
