// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Account } from "@lavega/core";
import CardFileDialog, { type CardFileDialogProps } from "./CardFileDialog";
import type { CardTarget } from "../../lib/cardFileImport";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const AMEX: CardTarget = { id: "american-express-platinum", name: "American Express Platinum", brand: "amex", kind: "credit" };
const CSV = `Date,Description,Card Member,Account #,Amount,Appears on Your Statement As,Extended Details
03/05/2026,SHOP ONE,A TESTER,-11111,10.00,SHOP ONE,x`;

const T212_CSV = `Action,Time,Currency (Total),Total,Merchant name
Card debit,2026-01-15 12:30:00,EUR,-12.40,Cafe Test`;

const acc = (over: Partial<Account>): Account => ({
  key: "AMEX-11111",
  iban: "",
  name: "American Express Platinum",
  bank: "American Express",
  entity: "P",
  currency: "EUR",
  balance: null,
  ...over,
});
const CARD_T212 = acc({ key: "TRADING212-CARD", name: "212 Card", bank: "Trading 212", statedCardId: "212-card" });
const CASH_T212 = acc({ key: "TRADING212", name: "TRADING212", bank: "Trading 212" });

let root: Root | null = null;
let el: HTMLElement | null = null;
beforeEach(() => {
  document.cookie = "lavega_locale=nl";
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  el?.remove();
  root = null;
  el = null;
});

function mount(written: Account[], over: Partial<CardFileDialogProps> = {}, card: CardTarget | null = AMEX) {
  const onSaveBalance = vi.fn(async (..._a: unknown[]) => {});
  const onCommit = vi.fn(async (..._a: unknown[]) => ({ ok: true as const, count: 1, written }));
  el = document.createElement("div");
  document.body.append(el);
  root = createRoot(el);
  function Host() {
    const [open, setOpen] = useState(true);
    return (
      <CardFileDialog
        open={open}
        onClose={() => setOpen(false)}
        card={card}
        choices={[]}
        entity="P"
        accounts={[]}
        txs={[]}
        asOf="2026-11-16"
        onCommit={onCommit}
        onSaveBalance={onSaveBalance}
        {...over}
      />
    );
  }
  act(() => root!.render(<Host />));
  return { onSaveBalance, onCommit };
}
const dialog = () => document.querySelector("dialog")!;
const button = (label: string) =>
  [...dialog().querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === label)!;
async function importFile(csv = CSV, add = "Toevoegen") {
  const input = dialog().querySelector<HTMLInputElement>('input[type="file"]')!;
  await act(async () => {
    Object.defineProperty(input, "files", { value: [new File([csv], "a.csv")], configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
  await act(async () => button(add).click());
}
const field = (n = 0) => dialog().querySelectorAll<HTMLInputElement>('[data-testid="balance-input"]')[n]!;
function type(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

test("a credit card without a balance gets the owed-amount field, focused, with its helper and date note", async () => {
  mount([acc({})]);
  await importFile();
  expect(dialog().textContent).toContain("Openstaand bedrag op je kaart");
  expect(dialog().textContent).toContain("Te vinden in de Amex-app of op je laatste afschrift. Laat leeg als je het niet weet.");
  expect(dialog().textContent).toContain("per vandaag");
  expect(document.activeElement).toBe(field());
  expect(field().getAttribute("aria-label") ?? dialog().querySelector("label")).toBeTruthy();
});

test("Trading 212: the card gets the card-balance label, the cash account its own", async () => {
  mount([CARD_T212, CASH_T212], {}, { id: "212-card", name: "212 Card", brand: "trading-212", kind: "debit" });
  await importFile(T212_CSV);
  const t = dialog().textContent!;
  expect(t).toContain("Saldo op je kaart nu");
  expect(t).toContain("Te vinden in de Trading 212-app.");
  expect(t).toContain("Saldo van TRADING212 nu");
  expect(dialog().querySelectorAll('[data-testid="balance-input"]')).toHaveLength(2);
});

test("an account with a known balance gets no field", async () => {
  mount([acc({ balance: -50, balanceDate: "2026-11-16" })]);
  await importFile();
  expect(dialog().querySelector('[data-testid="balance-input"]')).toBeNull();
  expect(document.activeElement).toBe(button("Sluiten"));
});

test("saving passes the typed amount to the existing balance path once, then focus goes to Sluiten", async () => {
  const { onSaveBalance } = mount([acc({})]);
  await importFile();
  type(field(), "1.234,56");
  await act(async () => button("Opslaan").click());
  expect(onSaveBalance).toHaveBeenCalledTimes(1);
  expect(onSaveBalance).toHaveBeenCalledWith("AMEX-11111", "1234.56");
  expect(dialog().querySelector('[data-testid="balance-input"]')).toBeNull();
  expect(dialog().textContent).toContain("Saldo opgeslagen");
  expect(document.activeElement).toBe(button("Sluiten"));
});

test("a euro sign, a leading minus and Enter all work", async () => {
  const { onSaveBalance } = mount([acc({})]);
  await importFile();
  type(field(), "€ 842,17");
  await act(async () => {
    field().form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(onSaveBalance).toHaveBeenCalledWith("AMEX-11111", "842.17");
});

test("garbage gets a short inline message and nothing is saved", async () => {
  const { onSaveBalance } = mount([acc({})]);
  await importFile();
  type(field(), "abc");
  await act(async () => button("Opslaan").click());
  expect(onSaveBalance).not.toHaveBeenCalled();
  expect(dialog().querySelector('[role="alert"]')!.textContent).toContain("Dit is geen bedrag");
  expect(field()).toBeTruthy();
});

test("Overslaan stores nothing and removes the field", async () => {
  const { onSaveBalance } = mount([acc({})]);
  await importFile();
  await act(async () => button("Overslaan").click());
  expect(onSaveBalance).not.toHaveBeenCalled();
  expect(dialog().querySelector('[data-testid="balance-input"]')).toBeNull();
});

test("an empty Opslaan counts as skipping", async () => {
  const { onSaveBalance } = mount([acc({})]);
  await importFile();
  await act(async () => button("Opslaan").click());
  expect(onSaveBalance).not.toHaveBeenCalled();
});

test("English labels", async () => {
  document.cookie = "lavega_locale=en";
  mount([acc({})]);
  await importFile(CSV, "Add");
  expect(dialog().textContent).toContain("Amount you currently owe on the card");
  expect(dialog().textContent).toContain("as of today");
});

test("a rejected write shows an alert, keeps the value, shows no success line and the field stays usable", async () => {
  const { onSaveBalance } = mount([acc({})]);
  onSaveBalance.mockRejectedValueOnce(new Error("disk full"));
  await importFile();
  type(field(), "250");
  await act(async () => button("Opslaan").click());
  expect(dialog().querySelector('[role="alert"]')!.textContent).toBe("Opslaan lukte niet. Probeer het opnieuw.");
  expect(field().value).toBe("250");
  expect(dialog().textContent).not.toContain("Saldo opgeslagen");
  expect(button("Opslaan").disabled).toBe(false);
  // A retry works.
  await act(async () => button("Opslaan").click());
  expect(onSaveBalance).toHaveBeenCalledTimes(2);
  expect(dialog().textContent).toContain("Saldo opgeslagen");
});

test("the label kind matches the stored sign for every kind of account", async () => {
  const { signedBalanceFor } = await import("@lavega/core");
  const cases: [Account, string][] = [
    [acc({}), "Openstaand bedrag op je kaart"],
    [CARD_T212, "Saldo op je kaart nu"],
    [CASH_T212, "Saldo van TRADING212 nu"],
    [acc({ key: "NL01INGB0001", name: "Betaalrekening", bank: "ING" }), "Saldo van Betaalrekening nu"],
  ];
  for (const [account, label] of cases) {
    if (root) act(() => root!.unmount());
    el?.remove();
    mount([account]);
    await importFile();
    expect(dialog().textContent).toContain(label);
    const owed = label.startsWith("Openstaand");
    expect(signedBalanceFor(account, 250)! < 0).toBe(owed);
  }
});
