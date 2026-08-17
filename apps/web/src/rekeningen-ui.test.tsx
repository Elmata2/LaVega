// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, test } from "vitest";
import type { Account, Tx } from "@lavega/core";
import { accountSummaries } from "@lavega/core";
import Rekeningen, { groupAccountsByBank, bankInitials, bankTone, UNKNOWN_BANK } from "./views/Rekeningen";

/* B4 — Rekeningen grouped by bank.
 *
 * What these pin down:
 *   - the grouping itself (pure): order, per-bank totals, and the refusal to
 *     sum an unknown saldo as a zero;
 *   - the bank's mark is DRAWN, never fetched — no request leaves the machine;
 *   - a click opens the bank and the accounts sit behind sub-tabs;
 *   - everything the view could do before it grouped, it still does.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function acc(p: Partial<Account> & { key: string }): Account {
  return {
    iban: "", name: p.key, bank: "", entity: "Prive", currency: "EUR", balance: null,
    ...p,
  } as Account;
}

const ACCOUNTS: Account[] = [
  acc({ key: "NL01INGB", iban: "NL01INGB", name: "Betaalrekening", bank: "ING", balance: 1200.5 }),
  acc({ key: "NL02INGB", iban: "NL02INGB", name: "Oranje Spaarrekening", bank: "ING", balance: 25000 }),
  acc({ key: "NL03ABNA", iban: "NL03ABNA", name: "Zakelijk", bank: "ABN AMRO", entity: "BV1", balance: null }),
  acc({ key: "AMEX", name: "Gold Card", bank: "American Express", balance: -430.25 }),
  acc({ key: "0123456789", name: "0123456789", bank: "" }),
];

function tx(id: string, accountKey: string): Tx {
  return { id, accountKey, date: "2026-08-01", amount: -10, currency: "EUR", counterparty: "X", description: "", category: "", manual: false };
}
const TXS: Tx[] = [tx("t1", "NL01INGB"), tx("t2", "NL01INGB"), tx("t3", "AMEX")];

const rows = () => accountSummaries(ACCOUNTS, TXS);

/* ── the pure grouping ─────────────────────────────────────────────────── */

test("accounts are grouped under their bank, named banks first and 'Zonder bank' last", () => {
  const groups = groupAccountsByBank(rows());
  expect(groups.map((g) => g.label)).toEqual(["ABN AMRO", "American Express", "ING", UNKNOWN_BANK]);
  expect(groups[2].rows.map((r) => r.account.name)).toEqual(["Betaalrekening", "Oranje Spaarrekening"]);
  expect(groups[2].txCount).toBe(2);
});

test("a bank's total sums only the balances we hold, in exact cents", () => {
  const ing = groupAccountsByBank(rows()).find((g) => g.label === "ING")!;
  expect(ing.total).toBe(26200.5);
  expect(ing.knownCount).toBe(2);
  expect(ing.unknownCount).toBe(0);
});

test("a bank whose every saldo is unknown gets NO total — not a zero", () => {
  const abn = groupAccountsByBank(rows()).find((g) => g.label === "ABN AMRO")!;
  expect(abn.total).toBeNull();
  expect(abn.knownCount).toBe(0);
});

test("a partly-known bank reports how many of its accounts the total covers", () => {
  const mixed = groupAccountsByBank(
    accountSummaries([
      acc({ key: "A", bank: "ING", balance: 100 }),
      acc({ key: "B", bank: "ING", balance: null }),
    ], []),
  )[0];
  expect(mixed.total).toBe(100);
  expect(mixed.knownCount).toBe(1);
  expect(mixed.unknownCount).toBe(1);
});

test("banks typed with different casing are one group", () => {
  const groups = groupAccountsByBank(
    accountSummaries([acc({ key: "A", bank: "ING" }), acc({ key: "B", bank: "ing" })], []),
  );
  expect(groups).toHaveLength(1);
  expect(groups[0].label).toBe("ING");
});

test("bankOf freezes a half-typed rename in its own group, so the row cannot jump per keystroke", () => {
  const list = accountSummaries([acc({ key: "A", bank: "IN" }), acc({ key: "B", bank: "ING" })], []);
  // Live: two groups, because "IN" is not yet "ING".
  expect(groupAccountsByBank(list)).toHaveLength(2);
  // Frozen at the value the rename started from:
  const frozen = groupAccountsByBank(list, (a) => (a.key === "A" ? "ING" : a.bank));
  expect(frozen).toHaveLength(1);
});

/* ── the drawn mark ────────────────────────────────────────────────────── */

test("the mark is initials from the bank's own name — nothing is fetched", () => {
  expect(bankInitials("ABN AMRO")).toBe("AA");
  expect(bankInitials("American Express")).toBe("AE");
  expect(bankInitials("ING")).toBe("ING");
  expect(bankInitials("Rabobank")).toBe("RA");
  expect(bankInitials("")).toBe("—");
});

test("a bank's tone is stable and comes from the token palette, never from money colours", () => {
  expect(bankTone("ING")).toBe(bankTone("ing"));
  expect(["a", "b", "c", "d", "e"]).toContain(bankTone("ING"));
  expect(bankTone("")).toBe("x");
});

test("no markup in the grouped view points at a remote asset", () => {
  const html = renderToStaticMarkup(<Rekeningen {...props()} />);
  expect(html).not.toContain("<img");
  expect(html).not.toContain("http://");
  expect(html).not.toContain("https://");
  expect(html).not.toContain("url(");
});

/* ── the view ──────────────────────────────────────────────────────────── */

const noop = () => {};
function props() {
  return {
    accounts: ACCOUNTS, txs: TXS, busy: false,
    onEntityChange: noop, onAccountCommit: noop, onAccountFieldChange: noop,
    onSaldoCommit: noop, onTypeCommit: noop, onSelectAccount: noop, onDeleteAccount: noop,
    duplicateGroups: [], onMergeDuplicates: noop,
  };
}

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

function render(overrides: Partial<ReturnType<typeof props>> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<Rekeningen {...props()} {...overrides} />));
  return container;
}

const byText = (sel: string, text: string): HTMLElement =>
  [...container!.querySelectorAll<HTMLElement>(sel)].find((n) => (n.textContent ?? "").includes(text))!;

function click(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** Type into a controlled input the way React notices it. */
function type(el: HTMLInputElement | HTMLSelectElement, value: string) {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

/** React implements onBlur on the bubbling focusout event. */
function blur(el: HTMLElement) {
  act(() => {
    el.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

test("the banks are listed collapsed, each saying what it holds", () => {
  render();
  const heads = [...container!.querySelectorAll(".bank-group-head")];
  expect(heads).toHaveLength(4);
  expect(heads.every((h) => h.getAttribute("aria-expanded") === "false")).toBe(true);
  expect(container!.querySelectorAll(".bank-panel")).toHaveLength(0);
  const ing = byText(".bank-group-head", "ING");
  expect(ing.textContent).toContain("2 rekeningen");
  expect(ing.textContent).toContain("Rekeningen tonen"); // the click is spelled out
  // €26.200,50 — the two ING balances, nothing invented.
  expect(ing.textContent).toContain("26.200,50");
});

test("a bank with no saldo at all says so instead of showing € 0,00", () => {
  render();
  const abn = byText(".bank-group-head", "ABN AMRO");
  expect(abn.textContent).toContain("saldo onbekend");
  expect(abn.textContent).not.toContain("0,00");
});

test("clicking a bank opens it and its accounts appear as sub-tabs", () => {
  render();
  click(byText(".bank-group-head", "ING"));
  const tabs = [...container!.querySelectorAll<HTMLElement>('[role="tab"]')];
  expect(tabs.map((t) => t.textContent)).toEqual([
    expect.stringContaining("Betaalrekening"),
    expect.stringContaining("Oranje Spaarrekening"),
  ]);
  expect(tabs[0].getAttribute("aria-selected")).toBe("true");
  // The first account's panel is the one on screen.
  expect(container!.querySelector(".bank-panel")!.textContent).toContain("2 transacties bekijken");
});

test("a second sub-tab swaps the panel to that account", () => {
  render();
  click(byText(".bank-group-head", "ING"));
  click(byText('[role="tab"]', "Oranje Spaarrekening"));
  const panel = container!.querySelector(".bank-panel")!;
  expect(panel.querySelector<HTMLInputElement>('[aria-label="Saldo Oranje Spaarrekening"]')!.value).toBe("25000");
  expect(panel.textContent).toContain("Nog geen transacties geïmporteerd");
});

test("a bank with one account shows the account straight away, without a tab strip", () => {
  render();
  click(byText(".bank-group-head", "American Express"));
  expect(container!.querySelectorAll('[role="tab"]')).toHaveLength(0);
  // A card's debt is typed and read as a positive.
  expect(container!.querySelector<HTMLInputElement>('[aria-label="Openstaand bedrag Gold Card"]')!.value).toBe("430.25");
});

test("the panel still carries every edit the table had", () => {
  const seen: string[] = [];
  render({
    onTypeCommit: (key, type) => seen.push(`type:${key}:${type}`),
    onEntityChange: (key, e) => seen.push(`entity:${key}:${e}`),
    onSaldoCommit: (key, v) => seen.push(`saldo:${key}:${v}`),
    onSelectAccount: (key) => seen.push(`open:${key}`),
    onDeleteAccount: (key) => seen.push(`delete:${key}`),
  });
  click(byText(".bank-group-head", "ING"));
  const panel = container!.querySelector(".bank-panel")!;

  type(panel.querySelector<HTMLSelectElement>("select")!, "Spaarrekening");
  type(panel.querySelector<HTMLInputElement>('[aria-label="Entiteit Betaalrekening"]')!, "BV2");
  // Saldo commits on blur, unchanged.
  blur(panel.querySelector<HTMLInputElement>('[aria-label="Saldo Betaalrekening"]')!);
  click(byText(".bank-panel .card-link", "transacties bekijken"));
  // Delete asks first — one click never deletes.
  click(byText(".bank-panel .card-link-danger", "Verwijder"));
  expect(container!.textContent).toContain("Betaalrekening en 2 transacties verwijderen?");
  expect(seen).not.toContain("delete:NL01INGB");
  click(byText(".bank-panel .card-link-danger", "Ja"));

  expect(seen).toEqual([
    "type:NL01INGB:Spaarrekening",
    "entity:NL01INGB:BV2",
    "saldo:NL01INGB:1200.5",
    "open:NL01INGB",
    "delete:NL01INGB",
  ]);
});

/* The one thing grouping could break that a table cannot: the row you are
 * editing is the row that decides which group it belongs to. Typing "I", "IN",
 * "ING" must not move the panel out from under the cursor. */
function Shell() {
  const [list, setList] = useState<Account[]>(ACCOUNTS);
  return (
    <Rekeningen
      {...props()}
      accounts={list}
      onAccountFieldChange={(key, patch) =>
        setList((prev) => prev.map((a) => (a.key === key ? { ...a, ...patch } : a)))
      }
    />
  );
}

test("typing a bank name does not move the row to another group mid-word", () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<Shell />));

  click(byText(".bank-group-head", UNKNOWN_BANK));
  click(byText(".bank-panel .card-link", "Bank invullen"));
  const bank = container.querySelector<HTMLInputElement>('[aria-label="Bank van 0123456789"]')!;

  for (const partial of ["I", "IN", "ING"]) {
    type(bank, partial);
    // Same element, still in the same open group — never re-mounted, never moved.
    expect(container.querySelector('[aria-label="Bank van 0123456789"]')).toBe(bank);
    expect(bank.value).toBe(partial);
    expect(byText(".bank-group-head", UNKNOWN_BANK)).toBeTruthy();
  }
  expect(container.querySelectorAll(".bank-group")).toHaveLength(4);

  // "Klaar" ends the rename, and only then does the account join ING.
  click(byText(".bank-panel .card-link", "Klaar"));
  expect(container.querySelectorAll(".bank-group")).toHaveLength(3);
  expect(byText(".bank-group-head", "ING").textContent).toContain("3 rekeningen");
});

test("'Alle rekeningen' falls back to the flat table, with every account in it", () => {
  render();
  act(() => byText(".bank-modes .pill", "Alle rekeningen").click());
  expect(container!.querySelectorAll("table tbody tr")).toHaveLength(5);
  expect(container!.querySelectorAll(".bank-group")).toHaveLength(0);
});

test("the duplicate banner still sits above the groups", () => {
  render({
    duplicateGroups: [{
      canonicalId: "dup1",
      survivor: ACCOUNTS[0],
      accounts: [ACCOUNTS[0], ACCOUNTS[1]],
    }] as ReturnType<typeof props>["duplicateGroups"],
  });
  expect(container!.querySelector(".dup-banner")!.textContent).toContain("lijken dezelfde rekening");
  expect(container!.querySelectorAll(".bank-group").length).toBeGreaterThan(0);
});

test("with no accounts the view says to import first, and offers no view switch", () => {
  render({ accounts: [], txs: [] });
  expect(container!.textContent).toContain("Nog geen rekeningen");
  expect(container!.querySelectorAll(".bank-modes")).toHaveLength(0);
});
