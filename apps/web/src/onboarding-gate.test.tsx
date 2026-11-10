// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { VaultStorage } from "@lavega/adapters";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* The first-start gate: a fresh vault opens the intake wizard full-screen,
 * anything else opens the app on its own page and never sees the wizard. */
let openResult: "created" | "opened" = "created";
function fakeStorage(): VaultStorage {
  return {
    open: async () => openResult,
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
    getProfile: async () => ({ kind: "absent" }),
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
vi.mock("./migrate.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./migrate.js")>();
  return { ...actual, hasLegacyData: async () => false };
});
vi.mock("./vaultKey.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./vaultKey.js")>();
  return { ...actual, loadVaultKey: async () => ({}) as CryptoKey };
});

let container: HTMLElement | null = null;
let root: ReactRoot | null = null;

beforeEach(() => {
  localStorage.clear();
  document.cookie = "lavega_locale=nl; Path=/";
  window.history.replaceState({}, "", "/app");
  globalThis.fetch = vi.fn(
    async () => new Response(JSON.stringify({ configured: false }), { status: 200 }),
  ) as unknown as typeof fetch;
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.resetModules();
});

async function renderApp() {
  const App = (await import("./App.js")).default;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(<App />);
  });
  await act(async () => {});
  await act(async () => {});
  return container;
}

test("a fresh vault opens the wizard on question 1, full-screen, with no scope question", async () => {
  openResult = "created";
  const el = await renderApp();
  expect(window.location.pathname).toBe("/app/intake");
  expect(el.querySelector(".wz-root")).not.toBeNull();
  expect(el.querySelector("nav, .shell")).toBeNull();
  expect(el.querySelector("#ob-scope")).toBeNull();
  expect(localStorage.getItem("lavega.defaultScope")).toBeNull();
  expect(localStorage.getItem("lavega.onboardingSeen")).toBe("1");
});

test("the wizard writes no country or region the user did not enter", async () => {
  openResult = "created";
  await renderApp();
  expect(localStorage.getItem("lavega.homeCountry")).toBeNull();
  expect(localStorage.getItem("lavega.homeRegion")).toBeNull();
});

test("an existing vault never sees the wizard", async () => {
  openResult = "opened";
  const el = await renderApp();
  expect(window.location.pathname).not.toBe("/app/intake");
  expect(el.querySelector(".wz-root")).toBeNull();
});

test("a fresh vault on a device that already saw it does not reopen the wizard", async () => {
  openResult = "created";
  localStorage.setItem("lavega.onboardingSeen", "1");
  const el = await renderApp();
  expect(window.location.pathname).not.toBe("/app/intake");
  expect(el.querySelector(".wz-root")).toBeNull();
});

test("archived routes land on Overzicht", async () => {
  openResult = "opened";
  for (const p of ["facturen", "belasting", "valuta"]) {
    window.history.replaceState({}, "", `/app/${p}`);
    await renderApp();
    expect(window.location.pathname).toBe("/app");
    act(() => root!.unmount());
    container?.remove();
    root = null;
    vi.resetModules();
  }
});
