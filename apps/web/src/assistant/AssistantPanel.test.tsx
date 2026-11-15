// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import type { VaultStorage } from "@lavega/adapters";
import { emptyAssistantState, type Account, type AssistantState, type Tx } from "@lavega/core";
import { AssistantPanel } from "./AssistantPanel.js";

/* WS5.8 thin slice (#301): the approval flow, driven like the owner drives it.
 * A read turn answers from the fake vault; a write turn opens a card; a decision
 * is persisted; a remount shows the decision and the memory — the reload proof.
 * `fetch` is stubbed to throw: the assistant path must not need the network. */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
  document.cookie = "lavega_locale=; max-age=0; path=/";
});

const accounts: Account[] = [
  {
    key: "A",
    iban: "NL01",
    name: "Betaal",
    bank: "X",
    entity: "personal",
    currency: "EUR",
    balance: 123_456,
  },
];

const txs: Tx[] = [
  {
    id: "t1",
    accountKey: "A",
    date: "2026-11-03",
    amount: -40,
    currency: "EUR",
    counterparty: "Shop",
    description: "Shop",
    category: "boodschappen",
    manual: false,
  },
];

function fakeStorage(initial: AssistantState = emptyAssistantState()) {
  let state = initial;
  const saves: AssistantState[] = [];
  return {
    storage: {
      getAccounts: async () => accounts,
      getTxs: async () => txs,
      getRules: async () => [],
      getAssistant: async () => state,
      putAssistant: async (next: AssistantState) => {
        state = next;
        saves.push(next);
      },
    } as unknown as VaultStorage,
    saves,
    state: () => state,
  };
}

async function mount(storage: VaultStorage) {
  document.cookie = "lavega_locale=nl; path=/";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<AssistantPanel storage={storage} asOf="2026-11-11" />);
    await Promise.resolve();
    await Promise.resolve();
  });
  return container;
}

function setValue(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function ask(container: HTMLElement, text: string) {
  const input = container.querySelector<HTMLInputElement>("#assistant-input")!;
  setValue(input, text);
  const form = container.querySelector("form")!;
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
}

const log = (container: HTMLElement) =>
  container.querySelector('[data-testid="assistant-log"]')?.textContent ?? "";

test("a spending question is answered from the vault with no network call", async () => {
  const fetchSpy = vi.fn(() => {
    throw new Error("the assistant must not call the network");
  });
  vi.stubGlobal("fetch", fetchSpy);
  const fake = fakeStorage();
  const view = await mount(fake.storage);

  await ask(view, "Wat heb ik deze maand uitgegeven?");

  expect(log(view)).toContain("Uitgaven in november 2026");
  expect(log(view)).toContain("40,00");
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(fake.saves).toHaveLength(0);
});

test("a remember request opens an approval card and writes nothing until the decision", async () => {
  const fake = fakeStorage();
  const view = await mount(fake.storage);

  await ask(view, "Onthoud dat ik korte antwoorden wil");

  const card = view.querySelector('[data-testid="assistant-approval"]')!;
  expect(card.textContent).toContain("Mag ik dit onthouden?");
  expect(card.textContent).toContain("korte antwoorden");
  // Nothing is persisted while the card is open.
  expect(fake.saves).toHaveLength(0);
  expect(view.querySelector('[data-testid="assistant-decisions"]')).toBeNull();
});

test("approving persists the event and the memory in one save, and the card closes", async () => {
  const fake = fakeStorage();
  const view = await mount(fake.storage);
  await ask(view, "Onthoud dat ik korte antwoorden wil");

  const approve = Array.from(view.querySelectorAll("button")).find(
    (button) => button.textContent === "Onthoud",
  )!;
  await act(async () => {
    approve.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(fake.saves).toHaveLength(1);
  const state = fake.state();
  expect(state.approvals).toHaveLength(1);
  expect(state.approvals[0]).toMatchObject({
    tool: "remember_preference",
    payload: { subject: "lengte", valueId: "kort" },
    decision: "approved",
  });
  expect(state.memories).toHaveLength(1);
  expect(state.memories[0]).toMatchObject({ subject: "lengte", valueId: "kort" });
  expect(view.querySelector('[data-testid="assistant-approval"]')).toBeNull();
  expect(log(view)).toContain("Ik onthoud nu");
});

test("a rejected request records the decision and stores no memory", async () => {
  const fake = fakeStorage();
  const view = await mount(fake.storage);
  await ask(view, "Onthoud dat ik korte antwoorden wil");

  const reject = Array.from(view.querySelectorAll("button")).find(
    (button) => button.textContent === "Nee",
  )!;
  await act(async () => {
    reject.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(fake.state().approvals[0]).toMatchObject({ decision: "rejected" });
  expect(fake.state().memories).toHaveLength(0);
});

test("the decision and the memory are still there after a reload", async () => {
  const fake = fakeStorage();
  const first = await mount(fake.storage);
  await ask(first, "Onthoud dat ik korte antwoorden wil");
  const approve = Array.from(first.querySelectorAll("button")).find(
    (button) => button.textContent === "Onthoud",
  )!;
  await act(async () => {
    approve.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });

  // Reload: unmount the panel and mount a fresh one over the same vault.
  act(() => root!.unmount());
  container?.remove();
  const second = await mount(fake.storage);

  const decisions = second.querySelector('[data-testid="assistant-decisions"]')!.textContent ?? "";
  expect(decisions).toContain("korte antwoorden");
  expect(decisions).toContain("Onthouden");
  const memories = second.querySelector('[data-testid="assistant-memories"]')!.textContent ?? "";
  expect(memories).toContain("Voortaan korte antwoorden.");
});

test("an approved short-answer preference changes the next spending answer", async () => {
  const fake = fakeStorage({
    approvals: [
      {
        id: "a1",
        tool: "remember_preference",
        payload: { subject: "lengte", valueId: "kort" },
        decision: "approved",
        decidedAt: "2026-11-11T10:00:00.000Z",
        createdAt: "2026-11-11T09:59:00.000Z",
      },
    ],
    memories: [
      {
        id: "assistant-memory-lengte",
        subject: "lengte",
        valueId: "kort",
        createdAt: "2026-11-11T10:00:00.000Z",
      },
    ],
  });
  const view = await mount(fake.storage);

  await ask(view, "Wat heb ik deze maand uitgegeven?");

  // The figure is still there; the category breakdown is what "kort" drops.
  expect(log(view)).toContain("40,00");
  expect(log(view)).not.toContain("Grootste posten");
});

test("an unmapped question says what this version can do instead of guessing", async () => {
  const fake = fakeStorage();
  const view = await mount(fake.storage);
  await ask(view, "Wat is de zin van het leven?");
  expect(log(view)).toContain("Dat kan ik in deze versie niet beantwoorden");
});
