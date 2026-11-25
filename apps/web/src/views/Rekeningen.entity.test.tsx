// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import type { Account } from "@lavega/core";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.doUnmock("../archive");
  vi.resetModules();
});

const ING: Account = {
  key: "NL01INGB",
  iban: "NL01INGB",
  name: "Betaalrekening",
  bank: "ING",
  entity: "Persoonlijk",
  currency: "EUR",
  balance: 10,
};

const noop = () => {};

async function mount(flag: boolean) {
  vi.resetModules();
  vi.doMock("../archive", async (orig) => ({
    ...(await orig<typeof import("../archive")>()),
    SHOW_ENTITY_CLASSIFIER: flag,
  }));
  const { default: Rekeningen } = await import("./Rekeningen");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <Rekeningen
        accounts={[ING]}
        txs={[]}
        busy={false}
        onEntityChange={noop}
        onAccountCommit={noop}
        onAccountFieldChange={noop}
        onSaldoCommit={noop}
        onTypeCommit={noop}
        onSelectAccount={noop}
        onDeleteAccount={noop}
        duplicateGroups={[]}
        onMergeDuplicates={noop}
        valuations={[]}
        asOf="2026-11-25"
        onOpeningCommit={noop}
        onValuationCommit={noop}
        onValuationRemove={noop}
      />,
    ),
  );
  return container;
}

const openPanel = (c: HTMLElement) =>
  act(() => c.querySelector<HTMLElement>("[data-testid=bank-group-head]")!.click());
const openTable = (c: HTMLElement) =>
  act(() =>
    [...c.querySelectorAll<HTMLElement>("[data-testid=bank-modes] button")]
      .find((b) => b.textContent?.includes("Alle rekeningen"))!
      .click(),
  );

test("the Entiteit input is hidden in an opened account while the classifier is archived", async () => {
  const c = await mount(false);
  openPanel(c);
  expect(c.querySelector("[data-testid=bank-panel]")).not.toBeNull();
  expect(c.textContent).not.toMatch(/Entiteit/);
  expect(c.querySelector('[aria-label^="Entiteit"]')).toBeNull();
});

test("the Entiteit column is hidden in the flat table while the classifier is archived", async () => {
  const c = await mount(false);
  openTable(c);
  expect(c.querySelector("table")).not.toBeNull();
  expect(c.textContent).not.toMatch(/Entiteit/);
});

test("the Entiteit input and column show when the classifier is on", async () => {
  const c = await mount(true);
  openPanel(c);
  expect(c.querySelector('[aria-label="Entiteit Betaalrekening"]')).not.toBeNull();
  openTable(c);
  expect(c.querySelector("th")?.parentElement?.textContent).toContain("Entiteit");
});
