// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root as ReactRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { VaultStorage } from "@lavega/adapters";
import { getOwnerName, setOwnerName } from "./settings.js";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* The first-start gate: a fresh vault opens the intake at step 0, anything else
 * opens the app on its own page and never sees step 0's settings again. */
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

test("a fresh vault opens the intake at step 0, with language, country and no scope question", async () => {
  openResult = "created";
  const el = await renderApp();
  expect(window.location.pathname).toBe("/app/intake");
  expect(el.querySelector("#in-locale")).not.toBeNull();
  expect(el.querySelector("#in-country")).not.toBeNull();
  expect(el.querySelector("#ob-scope")).toBeNull();
  expect(localStorage.getItem("lavega.defaultScope")).toBeNull();
  expect(localStorage.getItem("lavega.onboardingSeen")).toBe("1");
});

test("step 0 writes nothing the user did not enter", async () => {
  openResult = "created";
  await renderApp();
  expect(localStorage.getItem("lavega.homeCountry")).toBeNull();
  expect(localStorage.getItem("lavega.homeRegion")).toBeNull();
});

test("an existing vault never sees step 0", async () => {
  openResult = "opened";
  const el = await renderApp();
  expect(window.location.pathname).not.toBe("/app/intake");
  expect(el.querySelector("#in-country")).toBeNull();
});

test("a fresh vault on a device that already saw it does not reopen step 0", async () => {
  openResult = "created";
  localStorage.setItem("lavega.onboardingSeen", "1");
  const el = await renderApp();
  expect(window.location.pathname).not.toBe("/app/intake");
  expect(el.querySelector("#in-country")).toBeNull();
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

/* The restore-onto-a-new-browser case: the gate says "setup" for someone who
 * already has preferences. Step 0 must show them and leave them alone. */
test("a stored country is shown at step 0 and survives leaving it untouched", async () => {
  openResult = "created";
  localStorage.setItem("lavega.homeCountry", "DE");
  localStorage.setItem("lavega.homeRegion", "Bayern");
  const el = await renderApp();
  expect((el.querySelector("#in-country") as HTMLSelectElement).value).toBe("DE");
  const skip = [...el.querySelectorAll("button")].find(
    (b) => b.textContent === "Verder zonder gegevens",
  );
  await act(async () => skip!.click());
  expect(localStorage.getItem("lavega.homeCountry")).toBe("DE");
  expect(localStorage.getItem("lavega.homeRegion")).toBe("Bayern");
});

function typeInto(input: HTMLInputElement, value: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

test("a name typed at step 0 is written; blank fields write nothing", async () => {
  openResult = "created";
  const el = await renderApp();
  expect(getOwnerName()).toEqual({ first: "", last: "" });
  await act(async () => typeInto(el.querySelector("#in-last") as HTMLInputElement, "  "));
  expect(getOwnerName()).toEqual({ first: "", last: "" });
  await act(async () => typeInto(el.querySelector("#in-first") as HTMLInputElement, "Tom"));
  expect(getOwnerName().first).toBe("Tom");
});

test("a stored name is shown and left as it was", async () => {
  openResult = "created";
  setOwnerName({ first: "Tom", last: "Weber" });
  const el = await renderApp();
  expect((el.querySelector("#in-first") as HTMLInputElement).value).toBe("Tom");
  expect((el.querySelector("#in-last") as HTMLInputElement).value).toBe("Weber");
});
