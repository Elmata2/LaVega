// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Account, EntityProfile, Tx } from "@lavega/core";

/* DE NAVIGATIE IS EEN <a href> GEWORDEN, geen <button> meer (commit edea871,
 * path-based personal views). Dat is een verbetering - er zijn nu echte URL's,
 * dus middenklik, "link kopiëren" en de terugknop werken - maar de selector hier
 * stond nog op button.nav-item en die vond niets meer. De test zei toen "geen
 * knop Rekeningen", wat klonk als een verdwenen knop terwijl hij er gewoon staat
 * als link.
 */
/* Persoonlijk ⇄ Zakelijk must RESTORE.
 *
 * His report: switching to Zakelijk shows only the accounts, and switching back
 * to Persoonlijk does not bring back what was there before.
 *
 * These tests drive the REAL App against a fake vault, because the defect is not
 * in any one derivation — every derivation round-trips correctly — it is in what
 * the shell does to the SCREEN on the way across:
 *
 *   1. an empty half offers exactly one thing to click, and it navigates you
 *      away to Rekeningen ("only the accounts"). Coming back re-scopes the data
 *      but leaves you standing on that other page.
 *   2. the per-view filters (account, entity, category, search, dates) are not
 *      part of the switch at all, so a filter naming a PERSONAL account rides
 *      along into Zakelijk and silently narrows it to nothing.
 *
 * So the assertion is the round trip itself: what the screen said before must be
 * what it says after. */

const vault = vi.hoisted(() => {
  const state: { accounts: Account[]; txs: Tx[]; profiles: EntityProfile[] } = {
    accounts: [],
    txs: [],
    profiles: [],
  };
  return state;
});

vi.mock("./migrate.js", () => ({
  hasLegacyData: async () => false,
  migrateToVault: async () => {},
}));

vi.mock("@lavega/adapters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lavega/adapters")>();
  return {
    ...actual,
    createEncryptedStorage: () => ({
      status: async () => "unlocked",
      unlock: async () => true,
      lock: () => {},
      setup: async () => {},
      export: () => null,
      restore: async () => false,
      getAccounts: async () => vault.accounts,
      putAccounts: async () => {},
      getTxs: async () => vault.txs,
      putTxs: async () => {},
      getRules: async () => [],
      putRules: async () => {},
      deleteAccount: async () => {},
      deleteTxs: async () => {},
      getScheduledFlows: async () => [],
      putScheduledFlows: async () => {},
      getVatSettings: async () => [],
      putVatSettings: async () => {},
      getInvoices: async () => [],
      putInvoices: async () => {},
      getRewards: async () => [],
      putRewards: async () => {},
      getFacts: async () => [],
      putFacts: async () => {},
      getEntityProfiles: async () => vault.profiles,
      putEntityProfiles: async () => {},
    }),
    createRatesProvider: () => ({
      getRates: async () => ({ rates: [], asOf: "2026-01-01", source: "bundled" as const }),
    }),
  };
});

const App = (await import("./App")).default;

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

function account(key: string, entity: string, balance: number): Account {
  return { key, iban: `NL00TEST${key}`, name: key, bank: "TEST", entity, currency: "EUR", balance };
}

function tx(id: string, accountKey: string, date: string, amount: number, counterparty: string): Tx {
  return { id, accountKey, date, amount, currency: "EUR", counterparty, description: counterparty, category: "", manual: false };
}

const PERSONAL_TXS = [
  tx("p1", "prive", "2026-06-04", -42.5, "Albert Heijn"),
  tx("p2", "prive", "2026-07-04", -61.25, "Albert Heijn"),
  tx("p3", "prive", "2026-07-27", 2400, "Salaris"),
  tx("p4", "prive", "2026-08-04", -88.4, "Simeo"),
];
const BUSINESS_TXS = [
  tx("b1", "bv", "2026-07-11", -900, "Kantoorhuur"),
  tx("b2", "bv", "2026-08-11", 5400, "Klantfactuur"),
];

beforeEach(() => {
  localStorage.clear();
  vault.accounts = [account("prive", "Privé", 1200), account("bv", "BV1 Holding", 8000)];
  vault.txs = [...PERSONAL_TXS, ...BUSINESS_TXS];
  vault.profiles = [{ entity: "BV1 Holding", scope: "business" }];
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })));
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

async function mount() {
  root = createRoot(container!);
  await act(async () => {
    root!.render(<App />);
  });
  await act(async () => {
    await Promise.resolve(); // the vault-load effect
  });
}

function button(selector: string, text: string): HTMLButtonElement {
  const found = [...container!.querySelectorAll<HTMLButtonElement>(selector)].find((b) => b.textContent === text);
  if (!found) throw new Error(`geen knop "${text}" (${selector})`);
  return found;
}

/** Same, but on a button whose label is a sentence rather than one word. */
function buttonLike(selector: string, text: string): HTMLButtonElement {
  const found = [...container!.querySelectorAll<HTMLButtonElement>(selector)].find((b) => (b.textContent ?? "").includes(text));
  if (!found) throw new Error(`geen knop met "${text}" (${selector})`);
  return found;
}

const scopeButton = (label: string) => button("button.scope-option", label);

async function click(el: HTMLButtonElement) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

const title = () => container!.querySelector(".topbar-title")?.textContent ?? "";
const screen = () => container!.querySelector("main.content")!.textContent ?? "";

test("Persoonlijk → Zakelijk → Persoonlijk puts the same screen back", async () => {
  await mount();

  const before = screen();
  expect(before).toContain("Albert Heijn");

  await click(scopeButton("Zakelijk"));
  expect(screen()).toContain("Kantoorhuur");
  expect(screen()).not.toContain("Albert Heijn");

  await click(scopeButton("Persoonlijk"));
  expect(screen()).toBe(before);
});

test("you come back to the module you left the half on, not the one the other half sent you to", async () => {
  // His report, reproduced: nothing is classified as zakelijk, so Zakelijk is
  // empty and its ONE actionable line sends him to Rekeningen — "switching to
  // Zakelijk shows only the accounts". Coming back must return him to the
  // Overzicht he was reading, not strand him on that other page.
  vault.accounts = [account("prive", "Privé", 1200)];
  vault.txs = PERSONAL_TXS;
  vault.profiles = [];
  await mount();

  expect(title()).toBe("Overzicht");
  const overzicht = screen();

  await click(scopeButton("Zakelijk"));
  await click(button("button.card-link", "Rekeningen")); // the empty half's only offer
  expect(title()).toBe("Rekeningen");

  await click(scopeButton("Persoonlijk"));
  expect(title()).toBe("Overzicht");
  expect(screen()).toBe(overzicht);
});

test("each half keeps its own module, so switching back and forth is a round trip", async () => {
  await mount();

  await click(button("a.nav-item", "Rekeningen")); // Persoonlijk left on Rekeningen
  const personal = screen();

  await click(scopeButton("Zakelijk"));
  await click(button("a.nav-item", "Forecast")); // Zakelijk left on Forecast
  const business = screen();

  await click(scopeButton("Persoonlijk"));
  expect(title()).toBe("Rekeningen");
  expect(screen()).toBe(personal);

  await click(scopeButton("Zakelijk"));
  expect(title()).toBe("Forecast");
  expect(screen()).toBe(business);
});

test("a filter naming an account of one half never narrows the other half", async () => {
  await mount();

  // Rekeningen → click the personal account's transaction count → Transacties,
  // filtered to that account.
  await click(button("a.nav-item", "Rekeningen"));
  // Rekeningen groups per bank (B4): open the bank, then its account's count.
  await click(buttonLike("button.bank-group-head", "TEST"));
  await click(buttonLike("button.card-link", "4 transacties bekijken"));
  expect(title()).toBe("Transacties");
  expect(screen()).toContain("Albert Heijn");

  // Zakelijk must show the business transactions. It used to show an empty list
  // instead: the account filter rode along, naming an account that is not in
  // this half at all.
  await click(scopeButton("Zakelijk"));
  expect(screen()).toContain("Kantoorhuur");

  // …and the filtered list he left is exactly what he comes back to.
  await click(scopeButton("Persoonlijk"));
  expect(title()).toBe("Transacties");
  expect(screen()).toContain("Albert Heijn");
  expect(screen()).not.toContain("Kantoorhuur");
});
