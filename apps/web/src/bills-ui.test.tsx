// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import type { Account, Bill, BillOccurrence } from "@lavega/core";
import { generateBillOccurrences } from "@lavega/core";
import Bills from "./views/Bills";

/* The Bills screen, driven like the owner drives it: add a series through the
 * form, see it appear on the upcoming list, then pause it. The screen is the
 * first half of WS2 (#286); mark-paid and match suggestions are not here, so
 * the paid section says so instead of pretending. */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AS_OF = "2026-11-11";

let root: Root | null = null;
let container: HTMLElement | null = null;
let saved: Array<{ bills: Bill[]; occurrences: BillOccurrence[] }> = [];

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  saved = [];
});

function render(bills: Bill[], occurrences: BillOccurrence[], accounts: Account[] = []) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <Bills
        bills={bills}
        occurrences={occurrences}
        accounts={accounts}
        asOf={AS_OF}
        onSavePlan={(nextBills, nextOccurrences) => {
          // Mirror App's save path: materialize, then re-render from the result.
          const generated = generateBillOccurrences(nextBills, nextOccurrences, AS_OF).occurrences;
          saved.push({ bills: nextBills, occurrences: generated });
          render(nextBills, generated, accounts);
        }}
      />,
    ),
  );
  return container;
}

const byTestId = (id: string): HTMLElement =>
  container!.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;

function click(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function type(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto =
    el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const account = (balance: number | null): Account => ({
  key: "NL01",
  iban: "NL01",
  name: "Betaalrekening",
  bank: "ING",
  entity: "Prive",
  currency: "EUR",
  balance,
});

test("adding a bill through the form generates its first payments", () => {
  render([], []);

  click(byTestId("bills-add"));
  type(container!.querySelector<HTMLInputElement>('[aria-label="Naam"]')!, "Huur");
  type(container!.querySelector<HTMLInputElement>('[aria-label="Bedrag"]')!, "985,50");
  click(byTestId("bills-save"));

  expect(saved).toHaveLength(1);
  const bill = saved[0].bills[0];
  expect(bill.name).toBe("Huur");
  expect(bill.amountCents).toBe(98_550);
  expect(bill.anchorDate).toBe(AS_OF);
  expect(bill.status).toBe("active");
  expect(bill.rules).toEqual([{ frequency: "monthly", interval: 1, dayOfMonth: 11 }]);

  // The screen shows the new series and its upcoming payments.
  expect(byTestId("bills-series").textContent).toContain("Huur");
  expect(byTestId("bills-series").textContent).toContain("Elke maand op de 11e");
  expect(byTestId("bills-upcoming").textContent).toContain("Huur");
  expect(saved[0].occurrences.map((o) => o.dueOn)).toEqual([
    "2026-11-11",
    "2026-12-11",
    "2027-01-11",
  ]);
});

test("an empty name is refused with a message and saves nothing", () => {
  render([], []);
  click(byTestId("bills-add"));
  click(byTestId("bills-save"));
  expect(saved).toHaveLength(0);
  expect(container!.querySelector('[role="alert"]')?.textContent).toContain("naam");
});

test("pausing a series is one save and keeps its history", () => {
  const bill: Bill = {
    id: "huur",
    name: "Huur",
    type: "bill",
    status: "active",
    direction: "out",
    amountCents: 98_550,
    amountStrategy: "fixed",
    currency: "EUR",
    rules: [{ frequency: "monthly", interval: 1, dayOfMonth: 1 }],
    anchorDate: "2026-11-01",
    weekendAdjust: "none",
    endMode: "never",
    tags: [],
  };
  const occurrences = generateBillOccurrences([bill], [], AS_OF).occurrences;
  render([bill], occurrences);

  click(byTestId("bills-upcoming"));
  const pause = container!.querySelector<HTMLElement>('[aria-label="Pauzeren Huur"]')!;
  click(pause);

  expect(saved).toHaveLength(1);
  expect(saved[0].bills[0].status).toBe("paused");
  expect(saved[0].occurrences).toEqual(occurrences);
  // A paused bill is no longer on the upcoming list.
  expect(container!.querySelector('[data-testid="bills-upcoming"]')).toBeNull();
});

test("the shortfall is unknown without an income series, and null is not zero", () => {
  const bill: Bill = {
    id: "huur",
    name: "Huur",
    type: "bill",
    status: "active",
    direction: "out",
    amountCents: 100_000,
    amountStrategy: "fixed",
    currency: "EUR",
    rules: [{ frequency: "monthly", interval: 1, dayOfMonth: 20 }],
    anchorDate: "2026-11-20",
    weekendAdjust: "none",
    endMode: "never",
    tags: [],
  };
  const occurrences = generateBillOccurrences([bill], [], AS_OF).occurrences;
  render([bill], occurrences, [account(1_200)]);

  const shortfall = byTestId("bills-shortfall").textContent ?? "";
  expect(shortfall).toContain("—");
  expect(shortfall).toContain("Geen inkomensreeks");
});

test("with a salary series the screen answers what is short before payday", () => {
  const rent: Bill = {
    id: "huur",
    name: "Huur",
    type: "bill",
    status: "active",
    direction: "out",
    amountCents: 100_000,
    amountStrategy: "fixed",
    currency: "EUR",
    rules: [{ frequency: "monthly", interval: 1, dayOfMonth: 20 }],
    anchorDate: "2026-11-20",
    weekendAdjust: "none",
    endMode: "never",
    tags: [],
  };
  const salary: Bill = {
    ...rent,
    id: "salaris",
    name: "Salaris",
    type: "income",
    direction: "in",
    amountCents: 300_000,
    rules: [{ frequency: "monthly", interval: 1, dayOfMonth: 25 }],
    anchorDate: "2026-11-25",
  };
  const bills = [rent, salary];
  const occurrences = generateBillOccurrences(bills, [], AS_OF).occurrences;
  render(bills, occurrences, [account(700)]);

  const shortfall = byTestId("bills-shortfall").textContent ?? "";
  // EUR 1.000 rent due, EUR 700 cash: EUR 300 short before the 25th.
  expect(shortfall).toContain("300,00");
  expect(shortfall).toContain("25 nov 2026");
});
