// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { VaultStorage } from "@lavega/adapters";
import { EMPTY_BILL_DECISIONS, readLavegaExport } from "@lavega/core";
import Backup from "./views/Backup";

/* WS6.1 acceptance, UI flow: the Backup screen's portable export produces an
 * archive that the core reader accepts, and the screen only says "verified"
 * after that readback. The vault double is synthetic (plan §2.6): invented
 * accounts, counterparties and round amounts. */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;
let captured: Blob | null = null;

beforeEach(() => {
  document.cookie = "lavega_locale=nl; Path=/";
  captured = null;
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
  root = null;
  container = null;
  document.cookie = "lavega_locale=; Path=/; Max-Age=0";
  vi.unstubAllGlobals();
  delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
  delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
  vi.restoreAllMocks();
});

function storageDouble(): VaultStorage {
  return {
    getAccounts: async () => [
      {
        key: "B1",
        iban: "NL00TEST0000000001",
        name: "Testrekening",
        bank: "Testbank",
        type: "Betaal",
        entity: "Prive",
        currency: "EUR",
        balance: 1000,
        balanceDate: "2026-11-11",
      },
    ],
    getTxs: async () => [
      {
        id: "tx-1",
        accountKey: "B1",
        date: "2026-11-01",
        amount: -12.5,
        currency: "EUR",
        counterparty: "Leverancier A",
        description: "Test",
        category: "Wonen",
        manual: false,
      },
      {
        id: "tx-2",
        accountKey: "B1",
        date: "2026-11-02",
        amount: 25,
        currency: "EUR",
        counterparty: "Werkgever",
        description: "Test",
        category: "",
        manual: false,
      },
    ],
    getRules: async () => [],
    getTransfers: async () => [],
    getMerchants: async () => [],
    getBills: async () => [],
    getBillOccurrences: async () => [],
    getBillDecisions: async () => EMPTY_BILL_DECISIONS,
    getBudgetPeriods: async () => [],
    getCategoryGroups: async () => [],
    getScheduledFlows: async () => [],
    getInvoices: async () => [],
    getVatSettings: async () => [],
    getValuations: async () => [],
    getImportSessions: async () => [],
    getDocuments: async () => [],
    getFxHistory: async () => ({}),
  } as unknown as VaultStorage;
}

async function render() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 401 })),
  );
  await act(async () => {
    root!.render(<Backup storage={storageDouble()} asOf="2026-11-11" onRestored={() => {}} />);
  });
  return container;
}

test("the portable export writes a ZIP that core reads back, and the screen says so", async () => {
  (URL as unknown as { createObjectURL: (blob: Blob) => string }).createObjectURL = vi.fn(
    (blob: Blob) => {
      captured = blob;
      return "blob:test";
    },
  );
  (URL as unknown as { revokeObjectURL: (url: string) => void }).revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

  await render();
  const button = container!.querySelector<HTMLElement>('[data-testid="portable-export"]');
  expect(button).not.toBeNull();

  await act(async () => {
    button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });

  const result = container!.querySelector('[data-testid="portable-export-result"]');
  expect(result?.textContent).toContain("Geëxporteerd en teruggelezen");
  expect(result?.textContent).toContain("3 rijen"); // one account + two transactions
  expect(captured).not.toBeNull();

  // The bytes the UI would download are the same bytes core can read back.
  const bytes = new Uint8Array(await captured!.arrayBuffer());
  const readback = readLavegaExport(bytes);
  expect(readback.ok).toBe(true);
  expect(readback.manifest.recordCounts.accounts).toBe(1);
  expect(readback.manifest.recordCounts.transactions).toBe(2);
  const transactions = readback.sections.transactions as Array<Record<string, unknown>>;
  expect(transactions[0]).toMatchObject({ id: "tx-1", amountCents: -1250 });
  expect(transactions[1]).toMatchObject({ id: "tx-2", amountCents: 2500 });
});
