// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import type {
  Account,
  Bill,
  BillDecisions,
  BillMatchDecision,
  BillOccurrence,
  Tx,
} from "@lavega/core";
import { EMPTY_BILL_DECISIONS, generateBillOccurrences } from "@lavega/core";
import Bills from "./views/Bills";

/* The Bills screen, driven like the owner drives it: add a series through the
 * form, see it appear on the upcoming list, pause it, then the #287 half —
 * confirm a suggested payment, reject one, and mark one paid without a
 * transaction. */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AS_OF = "2026-11-11";

let root: Root | null = null;
let container: HTMLElement | null = null;
let saved: Array<{
  bills: Bill[];
  occurrences: BillOccurrence[];
  decisions: BillDecisions;
}> = [];

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  saved = [];
});

function render(
  bills: Bill[],
  occurrences: BillOccurrence[],
  accounts: Account[] = [],
  txs: Tx[] = [],
  decisions: BillDecisions = EMPTY_BILL_DECISIONS,
) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <Bills
        bills={bills}
        occurrences={occurrences}
        accounts={accounts}
        txs={txs}
        decisions={decisions}
        asOf={AS_OF}
        onSavePlan={(nextBills, nextOccurrences, nextDecisions) => {
          // Mirror App's save path: materialize, then re-render from the result.
          const generated = generateBillOccurrences(nextBills, nextOccurrences, AS_OF).occurrences;
          saved.push({
            bills: nextBills,
            occurrences: generated,
            decisions: nextDecisions ?? decisions,
          });
          render(nextBills, generated, accounts, txs, nextDecisions ?? decisions);
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

const rent = (overrides: Partial<Bill> = {}): Bill => ({
  id: "huur",
  name: "Huur",
  type: "bill",
  status: "active",
  direction: "out",
  amountCents: 98_550,
  amountStrategy: "fixed",
  currency: "EUR",
  rules: [{ frequency: "monthly", interval: 1, dayOfMonth: 20 }],
  anchorDate: "2026-11-20",
  weekendAdjust: "none",
  endMode: "never",
  tags: [],
  ...overrides,
});

const rentTx = (overrides: Partial<Tx> = {}): Tx => ({
  id: "tx-1",
  accountKey: "NL01",
  date: "2026-11-20",
  amount: -985.5,
  currency: "EUR",
  counterparty: "Woonstad Verhuur",
  description: "Huur",
  category: "",
  manual: false,
  ...overrides,
});

const matchDecision = (overrides: Partial<BillMatchDecision> = {}): BillMatchDecision => ({
  id: "m1",
  occurrenceId: "huur|2026-11-20",
  billId: "huur",
  txId: "tx-1",
  amountCents: 98_550,
  currency: "EUR",
  source: "auto",
  confidence: 0.95,
  decidedAt: AS_OF,
  ...overrides,
});

test("a suggested payment is shown on its occurrence and confirms in one save", () => {
  const bill = rent();
  const occurrences = generateBillOccurrences([bill], [], AS_OF).occurrences;
  render([bill], occurrences, [account(5_000)], [rentTx()]);

  const suggestion = container!.querySelector('[data-testid="bills-match-huur|2026-11-20"]');
  expect(suggestion?.textContent).toContain("Mogelijke betaling");
  expect(suggestion?.textContent).toContain("Woonstad Verhuur");

  click(byTestId("bills-confirm-huur|2026-11-20"));

  expect(saved).toHaveLength(1);
  expect(saved[0].decisions.matches).toHaveLength(1);
  expect(saved[0].decisions.matches[0].txId).toBe("tx-1");
  expect(saved[0].decisions.matches[0].source).toBe("user");
  const paid = saved[0].occurrences.find((o) => o.id === "huur|2026-11-20");
  expect(paid?.status).toBe("paid");
  expect(paid?.closedSource).toBe("user");
  // The closed occurrence is in Paid with its source; other rows stay open.
  expect(container!.querySelector('[data-testid="bills-confirm-huur|2026-11-20"]')).toBeNull();
  expect(container!.textContent).toContain("Betaald door Woonstad Verhuur");
});

test("rejecting a suggestion stores the memory and stops proposing it", () => {
  const bill = rent();
  const occurrences = generateBillOccurrences([bill], [], AS_OF).occurrences;
  render([bill], occurrences, [account(5_000)], [rentTx()]);

  click(byTestId("bills-reject-huur|2026-11-20"));

  expect(saved).toHaveLength(1);
  expect(saved[0].decisions.rejections).toEqual([
    { billId: "huur", txId: "tx-1", occurrenceId: "huur|2026-11-20", rejectedAt: AS_OF },
  ]);
  expect(container!.querySelector('[data-testid="bills-match-huur|2026-11-20"]')).toBeNull();
  const row = saved[0].occurrences.find((o) => o.id === "huur|2026-11-20");
  expect(row?.status).toBe("scheduled");
});

test("marking an occurrence paid closes it without a transaction", () => {
  const bill = rent();
  const occurrences = generateBillOccurrences([bill], [], AS_OF).occurrences;
  render([bill], occurrences, [account(5_000)], []);

  const markPaid = container!.querySelector<HTMLElement>(
    '[data-testid="bills-mark-paid-huur|2026-11-20"]',
  )!;
  click(markPaid);

  expect(saved).toHaveLength(1);
  expect(saved[0].decisions.marks).toEqual([
    {
      occurrenceId: "huur|2026-11-20",
      billId: "huur",
      paidOn: AS_OF,
      amountCents: 98_550,
      currency: "EUR",
      markedAt: AS_OF,
    },
  ]);
  const paid = saved[0].occurrences.find((o) => o.id === "huur|2026-11-20");
  expect(paid?.status).toBe("paid");
  expect(paid?.closedSource).toBe("user");
  expect(container!.textContent).toContain("Door jou als betaald gemarkeerd");
});

test("mark-paid survives the paycheck restructure: no transaction, and the due figure drops", () => {
  const bill = rent();
  const salary: Bill = {
    ...rent(),
    id: "salaris",
    name: "Salaris",
    type: "income",
    direction: "in",
    amountCents: 300_000,
    rules: [{ frequency: "monthly", interval: 1, dayOfMonth: 25 }],
    anchorDate: "2026-10-25",
  };
  const bills = [bill, salary];
  const occurrences = generateBillOccurrences(bills, [], AS_OF).occurrences;
  render(bills, occurrences, [account(700)]);
  // EUR 985,50 due before the 25th, EUR 700 cash: EUR 285,50 short.
  expect(byTestId("bills-due").textContent).toContain("985,50");
  expect(byTestId("bills-shortfall").textContent).toContain("285,50");

  click(byTestId("bills-mark-paid-huur|2026-11-20"));

  expect(saved).toHaveLength(1);
  // No transaction was needed: the mark itself is the payment decision.
  expect(saved[0].decisions.marks).toHaveLength(1);
  expect(saved[0].decisions.matches).toHaveLength(0);
  expect(byTestId("bills-due").textContent).toContain("0,00");
  expect(byTestId("bills-shortfall").textContent).not.toContain("285,50");
});

test("the paycheck slice shows due, reserved and the bridge window", () => {
  const salary: Bill = {
    ...rent(),
    id: "salaris",
    name: "Salaris",
    type: "income",
    direction: "in",
    amountCents: 300_000,
    rules: [{ frequency: "monthly", interval: 1, dayOfMonth: 25 }],
    anchorDate: "2026-10-25",
  };
  const tax: Bill = {
    ...rent(),
    id: "belasting",
    name: "Belasting",
    amountCents: 400_000,
    rules: [{ frequency: "monthly", interval: 3, dayOfMonth: 15 }],
    anchorDate: "2027-01-15",
  };
  const bills = [salary, tax];
  const occurrences = generateBillOccurrences(bills, [], AS_OF).occurrences;
  render(bills, occurrences, [account(1_200)]);

  const slice = byTestId("bills-paycheck").textContent ?? "";
  expect(slice).toContain("Salaris");
  expect(slice).toContain("Inkomen");
  expect(slice).toContain("Gereserveerd");
  // The leading window holds no income: it is the bridge paid from cash.
  expect(byTestId("bills-period-2026-11-11").textContent).toContain("Brugperiode");
  expect(byTestId("bills-period-2026-11-11").textContent).toContain("Saldo");
  // A bridge spends income it does not have, so its negative remainder is
  // arithmetic, not a gap: muted, never the green "you have money left" tone.
  expect(byTestId("bills-period-2026-11-11").querySelector(".text-pos")).toBeNull();
  // The tax bill outgrows its own paycheck, so an earlier paycheck reserves it.
  expect(byTestId("bills-period-2026-11-25").textContent).toContain("1.000,00");
  expect(byTestId("bills-period-2026-11-25").textContent).toContain("later");
});

test("a partial payment shows what is still open", () => {
  const bill = rent();
  const occurrences = generateBillOccurrences([bill], [], AS_OF).occurrences.map((o) =>
    o.id === "huur|2026-11-20" ? { ...o } : o,
  );
  render([bill], occurrences, [account(5_000)], [], {
    ...EMPTY_BILL_DECISIONS,
    matches: [matchDecision({ amountCents: 40_000, source: "user" })],
  });
  const partial = byTestId("bills-partial-huur|2026-11-20").textContent ?? "";
  expect(partial).toContain("Deels betaald");
  expect(partial).toContain("585,50");
});

test("an auto-matched occurrence is labelled in Paid", () => {
  const bill = rent();
  const occurrences = generateBillOccurrences([bill], [], AS_OF).occurrences.map((o) =>
    o.id === "huur|2026-11-20"
      ? {
          ...o,
          status: "paid" as const,
          paidOn: "2026-11-20",
          paidAmountCents: 98_550,
          closedAt: AS_OF,
          closedSource: "auto" as const,
        }
      : o,
  );
  render([bill], occurrences, [account(5_000)], [rentTx()], {
    ...EMPTY_BILL_DECISIONS,
    matches: [matchDecision()],
  });
  expect(container!.textContent).toContain("Automatisch gekoppeld");
});

test("the series shows a recorded price change", () => {
  const bill = rent();
  const occurrences = generateBillOccurrences([bill], [], AS_OF).occurrences;
  render([bill], occurrences, [], [], {
    ...EMPTY_BILL_DECISIONS,
    priceChanges: [
      {
        billId: "huur",
        effectiveOn: "2026-11-20",
        oldAmountCents: 95_000,
        newAmountCents: 98_550,
        currency: "EUR",
        detectedAt: AS_OF,
        source: "auto",
      },
    ],
  });
  expect(container!.textContent).toContain("Prijs gewijzigd");
});

test("an incoming bill row carries + and the remaining figure a real minus when short", () => {
  const salary: Bill = {
    ...rent(),
    id: "salaris",
    name: "Salaris",
    type: "income",
    direction: "in",
    amountCents: 300_000,
    rules: [{ frequency: "monthly", interval: 1, dayOfMonth: 25 }],
    anchorDate: "2026-10-25",
  };
  const bills = [rent(), salary];
  const occurrences = generateBillOccurrences(bills, [], AS_OF).occurrences;
  render(bills, occurrences, [account(700)]);
  const signed = [...container!.querySelectorAll(".text-pos")].map((e) => e.textContent ?? "");
  expect(signed.some((t) => /^€\s\+3\.000,00$/.test(t))).toBe(true);
});
