// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  AdvisorProfile,
  computePlan,
  emptyPlanPreferences,
  emptyProfileStore,
  ownAccounts,
  planProfileOf,
  type Account,
  type PlanPreferences,
  type PlanResult,
  type Tx,
} from "@lavega/core";
import CashflowCard from "./CashflowCard";
import type { PlanCtx } from "./sections/types";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AS_OF = "2026-10-24";
let root: Root | null = null;
let container: HTMLElement | null = null;
beforeEach(() => {
  document.cookie = "lavega_locale=en";
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  document.cookie = "lavega_locale=; Max-Age=0; Path=/";
});

const ACCOUNT: Account = {
  key: "A1",
  iban: "NL01INGB0000000001",
  name: "A1",
  bank: "ING",
  entity: "Prive",
  currency: "EUR",
  balance: 800,
  balanceDate: "2026-10-20",
};
let n = 0;
const tx = (cp: string, date: string, amount: number, category = ""): Tx => ({
  id: `t${n++}`,
  accountKey: "A1",
  date,
  amount,
  currency: "EUR",
  counterparty: cp,
  description: "",
  category,
  manual: false,
});
const MONTHS = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
const txs: Tx[] = MONTHS.flatMap((m) => [
  tx("Employer", `${m}-25`, 3000, "Inkomen"),
  tx("Shops", `${m}-02`, -3500, "Boodschappen"),
  ...(m === "2026-04" || m === "2026-07" ? [tx("Studio Noord BV", `${m}-15`, 2000)] : []),
]);

function plan(over: {
  work?: string[];
  vat?: boolean;
  prefs?: Partial<PlanPreferences>;
  txs?: Tx[];
  balance?: number | null;
  savings?: number;
}): PlanResult {
  const store = {
    ...emptyProfileStore("2026-10-01"),
    current: new AdvisorProfile({
      removed: [],
      intake: { blocksDone: 1, step0: null },
      work: { value: (over.work ?? ["freelance"]) as never, source: "stated", at: AS_OF },
      ...(over.vat === undefined ? {} : { chargesVat: { value: over.vat, source: "stated", at: AS_OF } }),
      ...(over.savings === undefined ? {} : { savings: { value: { totalCents: over.savings }, source: "stated", at: AS_OF } }),
    }),
  };
  return computePlan({
    profile: planProfileOf(store),
    txs: over.txs ?? txs,
    accounts: [over.balance === undefined ? ACCOUNT : { ...ACCOUNT, balance: over.balance }],
    entityProfiles: [],
    rules: [],
    own: ownAccounts([ACCOUNT]),
    rewards: [],
    catalogue: [],
    rates: [],
    heldCards: [],
    preferences: { ...emptyPlanPreferences(), ...over.prefs },
    events: [],
    mode: "separate",
    fxHistory: {},
    movedCategories: new Set(),
    asOf: AS_OF,
  });
}

function mount(
  result: PlanResult,
  setPreference = vi.fn(async () => {}),
  update = vi.fn(async () => true),
): HTMLElement {
  const ctx = {
    plan: { result, setPreference },
    asOf: AS_OF,
    accounts: [],
    profile: { store: null, update, saveFailed: false },
    onNavigate: vi.fn(),
  } as unknown as PlanCtx;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<CashflowCard cashflow={result.cashflow!} ctx={ctx} />));
  return container;
}
const q = (c: HTMLElement, id: string) => c.querySelector(`[data-testid="${id}"]`);

test("freelance with bank data: figures, a below-zero warning, the buffer line and the calculation", () => {
  const c = mount(plan({ vat: true }));
  const text = c.textContent!;
  expect(q(c, "plan-cashflow-figures")).not.toBeNull();
  expect(text).toContain("Months without client income");
  expect(text).toContain("4 of 6");
  expect(q(c, "plan-cashflow-warning-quiet-below-zero")).not.toBeNull();
  expect(text).toContain("5 months of fixed costs");
  expect(text).toContain("per month for VAT");
  expect(q(c, "plan-cashflow-calc")!.querySelectorAll("li").length).toBeGreaterThanOrEqual(5);
});

test("income tax stays a question until the person types a percentage, and saving stores it", async () => {
  const setPreference = vi.fn(async () => {});
  const c = mount(plan({ vat: false }), setPreference);
  expect(q(c, "plan-cashflow-advice")!.textContent).toContain("fill in below the percentage");
  const input = c.querySelector<HTMLInputElement>('[data-testid="plan-input-income-tax-pct"]')!;
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(input, "25");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => c.querySelector<HTMLButtonElement>('[data-testid="plan-save-income-tax-pct"]')!.click());
  expect(setPreference).toHaveBeenCalledWith({ incomeTaxSetAsidePct: { pct: 25, at: AS_OF } });
});

test("a stored percentage gives an amount and the VAT line is absent when VAT is not charged", () => {
  const c = mount(plan({ vat: false, prefs: { incomeTaxSetAsidePct: { pct: 25, at: AS_OF } } }));
  const advice = q(c, "plan-cashflow-advice")!.textContent!;
  expect(advice).toMatch(/Set aside .* per month for income tax \(25%/);
  expect(advice).not.toContain("for VAT");
});

test("under three full months: only the reason and the import link", () => {
  const c = mount(plan({ txs: txs.filter((t) => t.date >= "2026-08-01") }));
  expect(q(c, "plan-cashflow-not-enough")).not.toBeNull();
  expect(q(c, "plan-cashflow-figures")).toBeNull();
});

test("the Dutch card renders too", () => {
  document.cookie = "lavega_locale=nl";
  const c = mount(plan({ vat: true }));
  expect(c.textContent).toContain("Kasstroom bij wisselend inkomen");
  expect(c.textContent).toContain("Zo is het berekend");
});

test("an existing freelancer without a VAT answer gets Yes/No on the card, and the answer is saved", async () => {
  const update = vi.fn(async (_change: (p: AdvisorProfile) => AdvisorProfile) => true);
  const c = mount(plan({}), vi.fn(async () => {}), update as never);
  expect(q(c, "plan-cashflow-advice")!.textContent).toContain("Choose Yes or No below");
  await act(async () => c.querySelector<HTMLButtonElement>('[data-testid="plan-cashflow-vat-yes"]')!.click());
  expect(update).toHaveBeenCalledTimes(1);
  const change = update.mock.calls[0]![0];
  expect(change(new AdvisorProfile({ removed: [], intake: { blocksDone: 1, step0: null } })).chargesVat).toEqual({
    value: true,
    source: "stated",
    at: AS_OF,
  });
});

test("the choice is gone once VAT is answered; income tax says it still includes VAT until then", () => {
  const pending = mount(plan({ prefs: { incomeTaxSetAsidePct: { pct: 25, at: AS_OF } } }));
  expect(q(pending, "plan-cashflow-vat-choice")).not.toBeNull();
  expect(q(pending, "plan-cashflow-advice")!.textContent).toContain("including any VAT");
  act(() => root!.unmount());
  pending.remove();
  const done = mount(plan({ vat: false, prefs: { incomeTaxSetAsidePct: { pct: 25, at: AS_OF } } }));
  expect(q(done, "plan-cashflow-vat-choice")).toBeNull();
  expect(q(done, "plan-cashflow-advice")!.textContent).toContain("without VAT");
});

test("no warning only claims the stretch that was tested; VAT says 'on or before' and the period amount", () => {
  const c = mount(plan({ vat: true, balance: 90000 }));
  const text = c.textContent!;
  expect(text).toMatch(/even if you get no client income for 2 months, you stay above zero for the coming 6 months/);
  expect(text).toContain("on or before");
  expect(text).toContain("on the receipts in that period that is");
});

test("with no account balance the calculation names the typed savings, and the counted payments are listed", () => {
  const c = mount(plan({ vat: true, balance: null, savings: 1200000 }));
  expect(q(c, "plan-cashflow-start-stated")).not.toBeNull();
  expect(q(c, "plan-cashflow-calc")!.textContent).toContain("the savings you typed in");
  expect(q(c, "plan-cashflow-calc")!.textContent).not.toContain("in your accounts");
  expect(q(c, "plan-cashflow-payments")!.textContent).toContain("Studio Noord BV");
});

test("freelancer with no recognised client payment: says so, no VAT or tax amounts", () => {
  const none = txs.filter((t) => t.counterparty !== "Studio Noord BV");
  const c = mount(plan({ vat: true, txs: none, prefs: { incomeTaxSetAsidePct: { pct: 25, at: AS_OF } } }));
  const advice = q(c, "plan-cashflow-advice")!.textContent!;
  expect(advice).toContain("We do not recognise any client payments in your accounts yet.");
  expect(advice).not.toContain("Set aside");
});
