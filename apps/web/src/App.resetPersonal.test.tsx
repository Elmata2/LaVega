// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { VaultStorage } from "@lavega/adapters";
import { resetNetWorthShareStateForTests } from "./netWorthShare.js";
import type { VaultOwner } from "./vaultKey.js";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* The share card is hidden in Profiel for now (SHOW_NET_WORTH_SHARE in archive.ts).
 * These tests drive the share state through its toggle, so they show it. */
vi.mock("./archive", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./archive")>()),
  SHOW_NET_WORTH_SHARE: true,
}));

/* An unlocked vault: every read resolves at once, so the app reaches gate
 * "ready" without ever touching IndexedDB. Only the methods App.tsx actually
 * calls on mount/render are here — the rest of the real VaultStorage
 * interface is irrelevant to this test. `mockAccounts` is mutable per test
 * (empty by default) so a test that needs a real total to share can seed one
 * account before rendering. */
let mockAccounts: unknown[] = [];
let destroyedListener: ((phase: string) => void) | null = null;
const destroyVault = vi.fn(async (..._args: unknown[]) => {});
function fakeStorage(): VaultStorage {
  return {
    open: async () => "opened",
    onVaultDestroyed: (listener: (phase: string) => void) => {
      destroyedListener = listener;
      return () => {};
    },
    destroyVault: (...args: unknown[]) => destroyVault(...args),
    getAccounts: async () => mockAccounts,
    getTxs: async () => [],
    getRules: async () => [],
    getTransfers: async () => [],
    putTransfers: async () => {},
    getScheduledFlows: async () => [],
    getVatSettings: async () => [],
    getInvoices: async () => [],
    getRewards: async () => [],
    getFacts: async () => [],
    getEntityProfiles: async () => [],
    getFxHistory: async () => ({}),
    getPendingInvoices: async () => [],
    getPendingNotices: async () => [],
    getBills: async () => [],
    getBillOccurrences: async () => [],
    getBillDecisions: async () => ({
      matches: [],
      marks: [],
      rejections: [],
      priceChanges: [],
    }),
    putBillPlan: async () => {},
    getValuations: async () => [],
    putValuations: async () => {},
    getDocuments: async () => [],
    putDocuments: async () => {},
    getImportSessions: async () => [],
    putImportSessions: async () => {},
    putDocumentBytes: async () => {},
    getDocumentBytes: async () => null,
    hasDocumentBytes: async () => false,
    deleteDocumentBytes: async () => {},
    listDocumentBytes: async () => [],
    deleteAllDocumentBytes: async () => {},
    exportBundle: async () => null,
    eraseDocuments: async () => 0,
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

// The vault key comes from the server (or this browser's IndexedDB); neither
// exists here, and the fake storage ignores the key anyway.
vi.mock("./vaultKey.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./vaultKey.js")>();
  return { ...actual, loadVaultKey: async () => ({}) as CryptoKey };
});

let App: typeof import("./App.js").default;

let container: HTMLElement | null = null;
let root: ReactRoot | null = null;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  App = (await import("./App.js")).default;
  resetNetWorthShareStateForTests();
  localStorage.clear();
  destroyVault.mockClear();
  mockAccounts = [];
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/api/vault/backup"))
      return new Response(JSON.stringify({ blob: null, updatedAt: null }), { status: 200 });
    if (url === "/api/account/personal-data")
      return new Response(JSON.stringify({ erased: [] }), { status: 200 });
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
  vi.useRealTimers();
  window.history.pushState({}, "", "/");
});

async function renderApp(owner: VaultOwner) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<App owner={owner} />);
  });
  // The "load persisted data" and agent-status effects each resolve a
  // promise before their state lands; a couple of flushes clear both.
  await act(async () => {});
  await act(async () => {});
  return container;
}

const ACCOUNT: VaultOwner = { kind: "account", id: "user-a" };
const RESET_URL = "/api/account/personal-data";

const resetCalls = () =>
  fetchMock.mock.calls.filter((call: unknown[]) => call[0] === RESET_URL) as unknown as [
    string,
    RequestInit,
  ][];
const buttonWith = (label: string) =>
  [...container!.querySelectorAll("button")].find((b) => b.textContent?.includes(label));

async function resetFrom(path: string, owner: VaultOwner) {
  window.history.pushState({}, "", path);
  await renderApp(owner);
  await act(async () => {
    buttonWith("Persoonlijke gegevens wissen")!.click();
  });
  await act(async () => {
    buttonWith("Ja, wis mijn persoonlijke gegevens")!.click();
  });
}

test("Profiel (the normal entry) as an account owner: the reset calls the server with expectedOwner before the local vault is touched", async () => {
  const order: string[] = [];
  destroyVault.mockImplementation(async () => {
    order.push("local");
  });
  const inner = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
    if (String(input) === RESET_URL) order.push("server");
    return inner(input);
  });

  await resetFrom("/app/profiel", ACCOUNT);

  const [call] = resetCalls();
  expect(call![1].method).toBe("DELETE");
  expect(JSON.parse(String(call![1].body))).toEqual({
    confirm: "RESET-PERSONAL",
    expectedOwner: "user-a",
  });
  expect(order).toEqual(["server", "local"]);
});

test("the deep-link Back-up view as an account owner does the same", async () => {
  await resetFrom("/app/backup", ACCOUNT);
  expect(resetCalls()).toHaveLength(1);
  expect(JSON.parse(String(resetCalls()[0]![1].body)).expectedOwner).toBe("user-a");
  expect(destroyVault).toHaveBeenCalledTimes(1);
});

test("a device owner on Profiel makes no server call and clears this browser only", async () => {
  await resetFrom("/app/profiel", { kind: "device" });
  expect(resetCalls()).toHaveLength(0);
  expect(destroyVault).toHaveBeenCalledTimes(1);
});

test("a failing server leaves the Profiel reset from touching the local vault", async () => {
  const inner = fetchMock.getMockImplementation()!;
  fetchMock.mockImplementation(async (input: RequestInfo | URL) =>
    String(input) === RESET_URL ? new Response(null, { status: 500 }) : inner(input),
  );
  await resetFrom("/app/profiel", ACCOUNT);
  expect(destroyVault).not.toHaveBeenCalled();
});

test("another tab clearing this vault: neutral wait state first, reload only on 'destroyed', a message with a button if it stalls", async () => {
  window.history.pushState({}, "", "/app/profiel");
  await renderApp(ACCOUNT);
  const assign = vi.fn();
  const original = window.location;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...original, assign, pathname: original.pathname, search: original.search },
  });
  try {
    await act(async () => destroyedListener!("locked"));
    expect(container!.querySelector('[data-testid="reset-elsewhere"]')).not.toBeNull();
    expect(container!.textContent).toContain("in een ander LaVega-tabblad gewist");
    expect(assign).not.toHaveBeenCalled();

    await act(async () => destroyedListener!("stalled"));
    expect(container!.textContent).toContain("niet bevestigd");
    expect(container!.textContent).toContain("kan nog aanwezig zijn");
    expect(container!.textContent).not.toMatch(/is gewist|zijn gewist/);
    await act(async () => {
      buttonWith("Herlaad de pagina")!.click();
    });
    expect(assign).toHaveBeenCalledWith("/app");
    assign.mockClear();

    await act(async () => destroyedListener!("destroyed"));
    expect(assign).toHaveBeenCalledWith("/app");
  } finally {
    Object.defineProperty(window, "location", { configurable: true, value: original });
  }
});
