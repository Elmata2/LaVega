// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { VaultStorage } from "@lavega/adapters";
import { resetNetWorthShareStateForTests } from "./netWorthShare.js";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* An unlocked, empty vault: every read resolves at once to nothing, so the
 * app reaches gate "ready" without ever touching IndexedDB. Only the methods
 * App.tsx actually calls on mount/render are here — the rest of the real
 * VaultStorage interface is irrelevant to this test. */
function fakeStorage(): VaultStorage {
  return {
    status: async () => "unlocked",
    getAccounts: async () => [],
    getTxs: async () => [],
    getRules: async () => [],
    getScheduledFlows: async () => [],
    getVatSettings: async () => [],
    getInvoices: async () => [],
    getRewards: async () => [],
    getFacts: async () => [],
    getEntityProfiles: async () => [],
    getFxHistory: async () => ({}),
    getPendingInvoices: async () => [],
    getPendingNotices: async () => [],
  } as unknown as VaultStorage;
}

vi.mock("@lavega/adapters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@lavega/adapters")>();
  return {
    ...actual,
    createEncryptedStorage: () => fakeStorage(),
    createRatesProvider: () => ({ getRates: async () => ({}) }),
  };
});

// hasLegacyData reaches raw IndexedDB directly (not through VaultStorage),
// which jsdom does not implement; "no legacy data" is the answer an empty
// browser gives anyway.
vi.mock("./migrate.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./migrate.js")>();
  return { ...actual, hasLegacyData: async () => false };
});

let App: typeof import("./App.js").default;

let container: HTMLElement | null = null;
let root: ReactRoot | null = null;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  App = (await import("./App.js")).default;
  resetNetWorthShareStateForTests();
  localStorage.clear();
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/personal/net-worth-total")) return new Response(null, { status: 200 });
    if (url.includes("/api/agent/status"))
      return new Response(JSON.stringify({ configured: false }), { status: 200 });
    return new Response(null, { status: 404 });
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.resetModules();
});

async function renderApp() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<App />);
  });
  // The "load persisted data" and agent-status effects each resolve a
  // promise before their state lands; a couple of flushes clear both.
  await act(async () => {});
  await act(async () => {});
  return container;
}

function shareTotalCalls() {
  return fetchMock.mock.calls.filter((call: unknown[]) => {
    const input = call[0] as RequestInfo | URL;
    return (typeof input === "string" ? input : input.toString()).includes(
      "/api/personal/net-worth-total",
    );
  });
}

function openProfiel(el: HTMLElement) {
  const profileLink = el.querySelector<HTMLAnchorElement>("a.appbar-profile");
  expect(profileLink).not.toBeNull();
  act(() => {
    profileLink!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

test("the switch is off at start, and no accounts means nothing to share even if it were on — no request is ever sent to the share route", async () => {
  const el = await renderApp();
  openProfiel(el);
  const toggle = el.querySelector<HTMLInputElement>(
    '[aria-label="Deel mijn Totale positie met LaVega Investing"]',
  );
  expect(toggle).not.toBeNull();
  expect(toggle!.checked).toBe(false);
  expect(shareTotalCalls()).toHaveLength(0);
});

test("switching the share off sends exactly one DELETE, never a PUT after it", async () => {
  localStorage.setItem("lavega.shareNetWorth", "1");
  const el = await renderApp();
  openProfiel(el);
  const toggle = el.querySelector<HTMLInputElement>(
    '[aria-label="Deel mijn Totale positie met LaVega Investing"]',
  )!;
  expect(toggle.checked).toBe(true);

  await act(async () => {
    toggle.click();
  });
  await act(async () => {});

  const calls = shareTotalCalls();
  expect(calls).toHaveLength(1);
  expect((calls[0]![1] as RequestInit | undefined)?.method).toBe("DELETE");
  expect(toggle.checked).toBe(false);
});
