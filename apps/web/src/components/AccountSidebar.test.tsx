// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Account } from "@lavega/core";
import { AccountSidebar, type AccountSidebarProps } from "./AccountSidebar";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement;

const acct = (over: Partial<Account> & { key: string }): Account => ({
  iban: "",
  name: over.key,
  bank: "ING",
  entity: "personal",
  currency: "EUR",
  balance: 100,
  ...over,
});

const ACCOUNTS: Account[] = [
  acct({ key: "ing-b", name: "Betaal", bank: "ING", balance: 1200.5, type: "Betaalrekening" }),
  acct({ key: "ing-s", name: "Spaar", bank: "ING", balance: 800, type: "Spaarrekening" }),
  acct({ key: "rabo-c", name: "Visa", bank: "Rabobank", balance: -300, type: "Creditcard" }),
  acct({ key: "none", name: "Los", bank: "", balance: null, type: "Betaalrekening" }),
];

function render(over: Partial<AccountSidebarProps> = {}) {
  const props: AccountSidebarProps = {
    accounts: ACCOUNTS,
    view: "accounts",
    planUnlocked: false,
    activeAccountKey: "",
    onSelectAccount: () => {},
    onOpenPlan: () => {},
    onAddAccount: () => {},
    ...over,
  };
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(<AccountSidebar {...props} />));
}

beforeEach(() => {
  document.cookie = "lavega_locale=nl";
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
  vi.restoreAllMocks();
});

const rows = () => [...host.querySelectorAll<HTMLElement>(".shell2-acc-row")];
const names = () => rows().map((r) => r.querySelector(".shell2-acc-name")!.textContent);
const tab = (label: string) =>
  [...host.querySelectorAll<HTMLButtonElement>(".shell2-acc-tab")].find(
    (b) => b.textContent === label,
  )!;

test("groups by bank, named banks first, Zonder bank last, with totals", () => {
  render();
  const groups = [...host.querySelectorAll("details.shell2-acc-group")];
  expect(groups.map((g) => g.querySelector(".shell2-acc-bank")!.textContent)).toEqual([
    "ING",
    "Rabobank",
    "Zonder bank",
  ]);
  const totals = groups.map((g) => g.querySelector(".shell2-acc-total")!.textContent);
  expect(totals[0]).toContain("2.000,50");
  expect(totals[0]!.startsWith("+")).toBe(true);
  expect(totals[1]).toContain("300,00");
  expect(totals[1]!.startsWith("−")).toBe(true);
  expect(totals[2]).toBe("saldo onbekend");
});

test("rows show name left and a signed balance; unknown balance is not a zero", () => {
  render();
  const betaal = rows().find((r) => r.textContent!.includes("Betaal"))!;
  expect(betaal.querySelector(".shell2-acc-bal")!.textContent).toContain("1.200,50");
  expect(betaal.querySelector(".shell2-acc-bal")!.className).toContain("text-pos");
  const visa = rows().find((r) => r.textContent!.includes("Visa"))!;
  expect(visa.querySelector(".shell2-acc-bal")!.textContent!.startsWith("−")).toBe(true);
  expect(visa.querySelector(".shell2-acc-bal")!.className).toContain("text-neg");
  const los = rows().find((r) => r.textContent!.includes("Los"))!;
  expect(los.querySelector(".shell2-acc-bal")!.textContent).toBe("saldo onbekend");
});

test("tabs split by accountIsLiability", () => {
  render();
  expect(names()).toHaveLength(4);
  act(() => tab("Schulden").click());
  expect(names()).toEqual(["Visa"]);
  expect(tab("Schulden").getAttribute("aria-pressed")).toBe("true");
  expect(tab("Alle").getAttribute("aria-pressed")).toBe("false");
  act(() => tab("Activa").click());
  expect(names().sort()).toEqual(["Betaal", "Los", "Spaar"]);
  expect(host.textContent).not.toContain("Rabobank");
});

test("a tab with nothing says so, instead of an empty list", () => {
  render({ accounts: [ACCOUNTS[0]!] });
  act(() => tab("Schulden").click());
  expect(host.textContent).toContain("Geen schulden.");
});

test("plan row only when unlocked; links to the plan, active on the plan view", () => {
  render();
  expect(host.querySelector(".shell2-acc-plan")).toBeNull();
  act(() => root!.unmount());
  host.remove();
  const onOpenPlan = vi.fn();
  render({ planUnlocked: true, view: "plan", onOpenPlan });
  const plan = host.querySelector<HTMLAnchorElement>("a.shell2-acc-plan")!;
  expect(plan.textContent).toContain("Jouw plan");
  expect(plan.getAttribute("href")).toBe("/app/plan");
  expect(plan.getAttribute("aria-current")).toBe("page");
  act(() => plan.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
  expect(onOpenPlan).toHaveBeenCalledTimes(1);
});

test("plan row is not current on other views", () => {
  render({ planUnlocked: true, view: "overview" });
  expect(host.querySelector("a.shell2-acc-plan")!.hasAttribute("aria-current")).toBe(false);
});

test("clicking a row calls the shared handler with the account key", () => {
  const onSelectAccount = vi.fn();
  render({ onSelectAccount });
  act(() => rows().find((r) => r.textContent!.includes("Spaar"))!.click());
  expect(onSelectAccount).toHaveBeenCalledWith("ing-s");
});

test("the active row is the current transaction filter, marked beyond colour", () => {
  render({ activeAccountKey: "rabo-c", view: "transactions" });
  const active = host.querySelectorAll(".shell2-acc-row[aria-current]");
  expect(active).toHaveLength(1);
  expect(active[0]!.textContent).toContain("Visa");
});

test("add row calls onAddAccount", () => {
  const onAddAccount = vi.fn();
  render({ onAddAccount });
  const add = host.querySelector<HTMLButtonElement>(".shell2-acc-add")!;
  expect(add.textContent).toBe("+ Rekening toevoegen");
  act(() => add.click());
  expect(onAddAccount).toHaveBeenCalledTimes(1);
});

test("empty state: short text and the same CTA, no tabs of groups", () => {
  const onAddAccount = vi.fn();
  render({ accounts: [], onAddAccount });
  expect(host.querySelector(".shell2-acc-empty")!.textContent).toContain("Nog geen rekeningen.");
  expect(host.querySelectorAll("details")).toHaveLength(0);
  const add = host.querySelectorAll<HTMLButtonElement>(".shell2-acc-add");
  expect(add).toHaveLength(1);
  act(() => add[0]!.click());
  expect(onAddAccount).toHaveBeenCalledTimes(1);
});

test("english copy", () => {
  document.cookie = "lavega_locale=en";
  render();
  expect(host.querySelector(".shell2-acc-add")!.textContent).toBe("+ Add account");
  expect(tab("Debts")).toBeDefined();
});

test("a group with some unknown balances marks its total as partial", () => {
  render({
    accounts: [
      acct({ key: "a", name: "A", bank: "ING", balance: 100 }),
      acct({ key: "b", name: "B", bank: "ING", balance: null }),
    ],
  });
  const total = host.querySelector(".shell2-acc-total")!;
  expect(total.textContent).toContain("100,00");
  expect(total.querySelector(".shell2-acc-partial")!.textContent).toContain("1 van 2 bekend");
});

test("a fully known group has no partial marker", () => {
  render({
    accounts: [
      acct({ key: "a", balance: 100, balanceDate: "2026-11-01" }),
      acct({ key: "b", balance: 5, balanceDate: "2026-11-01" }),
    ],
  });
  expect(host.querySelector(".shell2-acc-partial")).toBeNull();
});

test("onNavigate runs after the plan link, an account row and the add row; not for tabs", () => {
  const onNavigate = vi.fn();
  render({ planUnlocked: true, onNavigate });
  act(() => tab("Activa").click());
  expect(onNavigate).not.toHaveBeenCalled();
  act(() => host.querySelector<HTMLElement>(".shell2-acc-plan")!.click());
  act(() => rows()[0]!.click());
  act(() => host.querySelector<HTMLElement>(".shell2-acc-add")!.click());
  expect(onNavigate).toHaveBeenCalledTimes(3);
});

test("onNavigate is not called for a modifier-click on the plan link", () => {
  const onNavigate = vi.fn();
  render({ planUnlocked: true, onNavigate });
  const swallow = (e: Event) => e.preventDefault();
  document.addEventListener("click", swallow);
  act(() => {
    host
      .querySelector<HTMLElement>(".shell2-acc-plan")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }));
  });
  document.removeEventListener("click", swallow);
  expect(onNavigate).not.toHaveBeenCalled();
});

test("a USD row shows its own currency, never a euro sign, and the head is partial", () => {
  render({
    accounts: [
      acct({ key: "e", name: "Eur", bank: "ING", balance: 100 }),
      acct({ key: "u", name: "Dollar", bank: "ING", balance: 500, currency: "USD" }),
    ],
  });
  const usd = rows().find((r) => r.textContent!.includes("Dollar"))!;
  const bal = usd.querySelector(".shell2-acc-bal")!.textContent!;
  expect(bal).toContain("500,00");
  expect(bal).toContain("US$");
  expect(bal).not.toContain("€");
  const total = host.querySelector(".shell2-acc-total")!.textContent!;
  expect(total).toContain("100,00");
  expect(total).not.toContain("600");
  expect(total).toContain("1 van 2");
});

test("a group of only USD accounts reads saldo onbekend", () => {
  render({ accounts: [acct({ key: "u", name: "Dollar", balance: 500, currency: "USD" })] });
  expect(host.querySelector(".shell2-acc-total")!.textContent).toBe("saldo onbekend");
});

test("head carries the dag onbekend marker when a summed balance has no date", () => {
  render({
    accounts: [
      acct({ key: "d", name: "Dated", bank: "ING", balance: 100, balanceDate: "2026-11-01" }),
      acct({ key: "n", name: "Undated", bank: "ING", balance: 50 }),
    ],
  });
  expect(host.querySelector(".shell2-acc-total")!.textContent).toContain("dag onbekend");
});

test("head has no dag onbekend marker when every summed balance is dated", () => {
  render({
    accounts: [acct({ key: "d", bank: "ING", balance: 100, balanceDate: "2026-11-01" })],
  });
  expect(host.querySelector(".shell2-acc-total")!.textContent).not.toContain("dag onbekend");
});
