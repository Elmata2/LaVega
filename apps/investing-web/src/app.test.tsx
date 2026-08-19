// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./app";
import { emptyInvestingDashboard, type InvestingDashboardData } from "@lavega/core";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => { vi.restoreAllMocks(); globalThis.localStorage?.clear(); });

const dashboard: InvestingDashboardData = {
  ...emptyInvestingDashboard(),
  portfolio: { ...emptyInvestingDashboard().portfolio, "1M": [{ date: "2026-08-18", portfolioValue: 120, benchmarkValue: 118, unpriced: [] }] },
  allocation: {
    instrument: { buckets: [{ key: "ASML", label: "ASML", value: 120, unpriced: false }], unpriced: [] },
    broker: { buckets: [{ key: "Broker A", label: "Broker A", value: 120, unpriced: false }], unpriced: [] },
  },
  positions: [{ symbol: "ASML", entity: "personal", description: "ASML", quantity: 1, marketValue: 120, currency: "EUR", asOf: "2026-08-18" }],
  position: { symbol: "ASML", description: "ASML", currency: "EUR", points: [{ tenantId: "local", symbol: "ASML", date: "2026-08-18", close: 120, currency: "EUR", markers: [] }] },
};

const emptyDashboard = emptyInvestingDashboard();

function responseFor(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input);
  if (url === "/health") return new Response(JSON.stringify({ ok: true, service: "investing-server" }));
  if (url === "/api/brokers/sync" && init?.method === "POST") return new Response(JSON.stringify({ problems: [] }));
  if (url.startsWith("/api/investing/dashboard")) return new Response(JSON.stringify(dashboard));
  return new Response(JSON.stringify({}));
}

function emptyResponseFor(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input);
  if (url === "/health") return new Response(JSON.stringify({ ok: true, service: "investing-server" }));
  if (url === "/api/brokers/sync" && init?.method === "POST") return new Response(JSON.stringify({ problems: [] }));
  if (url.startsWith("/api/investing/dashboard")) return new Response(JSON.stringify(emptyDashboard));
  return new Response(JSON.stringify({}));
}

test("overview shell fetches and displays investing server health", async () => {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(responseFor(input, init))));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<MemoryRouter><App /></MemoryRouter>);
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(container.textContent).toContain("investing-server: beschikbaar");
  expect(container.textContent).toContain("Portefeuillewaarde");
  expect(container.textContent).toContain("ASML");
  expect(fetch).toHaveBeenCalledWith("/api/investing/dashboard");
  expect(fetch).toHaveBeenCalledWith("/health");
  root.unmount();
});

test("positions route renders its empty state", async () => {
  vi.stubGlobal("fetch", vi.fn((input, init) => Promise.resolve(emptyResponseFor(input, init))));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<MemoryRouter initialEntries={["/positions"]}><App /></MemoryRouter>);
  });

  expect(container.textContent).toContain("Geen posities geladen");
  expect(container.querySelector('nav[aria-label="Hoofdnavigatie"]')).not.toBeNull();
  root.unmount();
});

test("positions route renders loading state while read model is pending", async () => {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => String(input).startsWith("/api/investing/dashboard") ? new Promise<Response>(() => {}) : Promise.resolve(new Response(JSON.stringify({ ok: true, service: "investing-server" })) )));
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);

  await act(async () => { root.render(<MemoryRouter initialEntries={["/positions"]}><App /></MemoryRouter>); });

  expect(container.textContent).toContain("Dashboard laden");
  root.unmount();
});

test("positions route renders read-model error state", async () => {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => String(input).startsWith("/api/investing/dashboard") ? Promise.resolve(new Response("", { status: 503 })) : Promise.resolve(new Response(JSON.stringify({ ok: true, service: "investing-server" })) )));
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);

  await act(async () => { root.render(<MemoryRouter initialEntries={["/positions"]}><App /></MemoryRouter>); await Promise.resolve(); await Promise.resolve(); });

  expect(container.textContent).toContain("Dashboard niet beschikbaar");
  root.unmount();
});

test("positions view renders read-model positions as links", async () => {
  vi.stubGlobal("fetch", vi.fn((input, init) => Promise.resolve(responseFor(input, init))));
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);

  await act(async () => { root.render(<MemoryRouter initialEntries={["/positions"]}><App /></MemoryRouter>); await Promise.resolve(); await Promise.resolve(); });

  expect(container.textContent).toContain("ASML");
  expect(container.querySelector('a[href="/positions/ASML"]')).not.toBeNull();
  root.unmount();
});

test("overview exposes positions as navigation links", async () => {
  vi.stubGlobal("fetch", vi.fn((input, init) => Promise.resolve(responseFor(input, init))));
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);

  await act(async () => { root.render(<MemoryRouter initialEntries={["/"]}><App /></MemoryRouter>); await Promise.resolve(); await Promise.resolve(); });

  expect(container.querySelector('a[href="/positions/ASML"]')).not.toBeNull();
  root.unmount();
});

test("position navigation moves from overview to detail and back", async () => {
  vi.stubGlobal("fetch", vi.fn((input, init) => Promise.resolve(responseFor(input, init))));
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);

  await act(async () => { root.render(<MemoryRouter initialEntries={["/"]}><App /></MemoryRouter>); await Promise.resolve(); await Promise.resolve(); });
  const positionLink = container.querySelector<HTMLAnchorElement>('a[href="/positions/ASML"]');
  await act(async () => { positionLink?.click(); await Promise.resolve(); await Promise.resolve(); });
  expect(container.textContent).toContain("Koershistorie");

  const backLink = container.querySelector<HTMLAnchorElement>('a[href="/positions"]');
  await act(async () => { backLink?.click(); await Promise.resolve(); await Promise.resolve(); });
  expect(container.textContent).toContain("Posities");
  root.unmount();
});

test("position detail selects symbol from route and links back", async () => {
  const requests: string[] = [];
  vi.stubGlobal("fetch", vi.fn((input, init) => { requests.push(String(input)); return Promise.resolve(responseFor(input, init)); }));
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);

  await act(async () => { root.render(<MemoryRouter initialEntries={["/positions/ASML"]}><App /></MemoryRouter>); await Promise.resolve(); await Promise.resolve(); });

  expect(container.textContent).toContain("Koershistorie");
  expect(container.textContent).toContain("ASML");
  expect(requests).toContain("/api/investing/dashboard?symbol=ASML");
  expect(container.querySelector('a[href="/positions"]')).not.toBeNull();
  root.unmount();
});

test("dashboard shows loading state before read model arrives", async () => {
  let release!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => { release = resolve; });
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => String(input).startsWith("/api/investing/dashboard") ? pending : Promise.resolve(responseFor(input, init))));
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);

  await act(async () => { root.render(<MemoryRouter initialEntries={["/positions"]}><App /></MemoryRouter>); });
  expect(container.textContent).toContain("Dashboard laden");

  release(new Response(JSON.stringify(emptyDashboard)));
  await act(async () => { await pending; });
  expect(container.textContent).toContain("Geen posities geladen");
  root.unmount();
});

test("dashboard shows read error when route fails", async () => {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => String(input).startsWith("/api/investing/dashboard") ? Promise.resolve(new Response("", { status: 503 })) : Promise.resolve(responseFor(input, init))));
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);

  await act(async () => { root.render(<MemoryRouter initialEntries={["/positions"]}><App /></MemoryRouter>); await Promise.resolve(); });
  expect(container.textContent).toContain("Dashboard niet beschikbaar");
  root.unmount();
});

test("does not show Yahoo disclosure and starts price sync on app open", async () => {
  const requests: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => { requests.push(String(input)); if (String(input).startsWith("/api/investing/dashboard")) return new Response(JSON.stringify(emptyDashboard)); return new Response(JSON.stringify({ problems: [] })); }));
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter><App /></MemoryRouter>); await Promise.resolve(); await Promise.resolve(); });
  expect(container.textContent).not.toContain("Yahoo Finance");
  expect(requests).toContain("/api/prices/sync");
  expect(requests).not.toContain("/api/market-data/consent");
  root.unmount();
});

test("shows broker sync problems and asks before deleting cached prices", async () => {
  const requests: Array<{ url: string; method?: string }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), method: init?.method });
    if (String(input) === "/api/brokers/sync") return new Response(JSON.stringify({ problems: ["ibkr: niet beschikbaar"] }));
    if (String(input).startsWith("/api/investing/dashboard")) return new Response(JSON.stringify(emptyDashboard));
    return new Response(JSON.stringify({ ok: true, service: "investing-server" }));
  }));
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter><App /></MemoryRouter>); await Promise.resolve(); await Promise.resolve(); });
  expect(container.textContent).toContain("Synchronisatieproblemen");
  await act(async () => { Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Prijsgegevens wissen"))?.click(); await Promise.resolve(); });
  expect(container.textContent).toContain("Dit verwijdert alle lokaal opgeslagen prijsgegevens.");
  expect(requests.some((request) => request.method === "DELETE")).toBe(false);
  const deleteButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("alles verwijderen"));
  await act(async () => { deleteButton?.click(); await Promise.resolve(); });
  expect(requests.some((request) => request.method === "DELETE" && request.url === "/api/prices/cache")).toBe(true);
  root.unmount();
});

test("broker koppelen opens setup guide with IBKR instructions", async () => {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(responseFor(input, init))));
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);

  await act(async () => { root.render(<MemoryRouter initialEntries={["/"]}><App /></MemoryRouter>); });
  const connectLink = container.querySelector<HTMLAnchorElement>('a[href="/brokers/connect"]');
  expect(connectLink).not.toBeNull();

  await act(async () => { connectLink?.click(); });
  expect(container.textContent).toContain("Broker koppelen");
  expect(container.textContent).toContain("Interactive Brokers");
  expect(container.textContent).toContain("Flex Web Service");
  expect(container.textContent).toContain("Trading 212");
  expect(container.textContent).toContain("Flex-token");
  expect(container.querySelector('a[href="/"]')).not.toBeNull();
  root.unmount();
});

test("broker setup starts forced sync and shows returned problems", async () => {
  const requests: Array<{ url: string; method?: string }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), method: init?.method });
    if (String(input) === "/api/brokers/sync?force=true") return new Response(JSON.stringify({ outcomes: [], problems: ["IBKR: credentials are not configured"] }));
    return new Response(JSON.stringify({ ok: true, service: "investing-server" }));
  }));
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);

  await act(async () => { root.render(<MemoryRouter initialEntries={["/brokers/connect"]}><App /></MemoryRouter>); });
  const syncButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Synchronisatie starten"));
  expect(syncButton).not.toBeUndefined();
  await act(async () => { syncButton?.click(); await Promise.resolve(); });
  expect(requests).toContainEqual({ url: "/api/brokers/sync?force=true", method: "POST" });
  expect(container.textContent).toContain("IBKR: credentials are not configured");
  root.unmount();
});

test("broker credential form stores IBKR credentials and starts sync", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), init });
    if (String(input) === "/api/brokers/credentials") return new Response(null, { status: 204 });
    if (String(input) === "/api/brokers/sync?force=true") return new Response(JSON.stringify({ outcomes: [{ status: "synced" }], problems: [] }));
    return new Response(JSON.stringify({ ok: true, service: "investing-server" }));
  }));
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);

  await act(async () => { root.render(<MemoryRouter initialEntries={["/brokers/connect"]}><App /></MemoryRouter>); });
  const fields = {
    token: container.querySelector<HTMLInputElement>('[name="token"]')!,
    queryId: container.querySelector<HTMLInputElement>('[name="queryId"]')!,
    passphrase: container.querySelector<HTMLInputElement>('[name="passphrase"]')!,
  };
  const setInput = (field: HTMLInputElement, value: string) => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set; setter?.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); };
  setInput(fields.token, "flex-token");
  setInput(fields.queryId, "123456");
  setInput(fields.passphrase, "vault-passphrase");
  await act(async () => { container.querySelector<HTMLButtonElement>('button[type="submit"]')?.click(); await Promise.resolve(); });

  const credentialRequest = requests.find((request) => request.url === "/api/brokers/credentials");
  expect(credentialRequest?.init?.body).toBe(JSON.stringify({ broker: "ibkr", token: "flex-token", queryId: "123456", passphrase: "vault-passphrase" }));
  expect(requests.some((request) => request.url === "/api/brokers/sync?force=true")).toBe(true);
  expect(container.textContent).toContain("Synchronisatie voltooid");
  expect(container.textContent).not.toContain("flex-token");
  root.unmount();
});

test("broker credential form succeeds when the other broker is not configured", async () => {
  const requests: Array<{ url: string }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input) });
    if (String(input) === "/api/brokers/credentials") return new Response(null, { status: 204 });
    if (String(input) === "/api/brokers/sync?force=true") {
      return new Response(JSON.stringify({
        outcomes: [
          { broker: "ibkr", status: "synced" },
          { broker: "trading212", status: "problem" },
        ],
        problems: ["trading212: credentials are not configured"],
      }));
    }
    return new Response(JSON.stringify({ ok: true, service: "investing-server" }));
  }));
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);

  await act(async () => { root.render(<MemoryRouter initialEntries={["/brokers/connect"]}><App /></MemoryRouter>); });
  const fields = {
    token: container.querySelector<HTMLInputElement>('[name="token"]')!,
    queryId: container.querySelector<HTMLInputElement>('[name="queryId"]')!,
    passphrase: container.querySelector<HTMLInputElement>('[name="passphrase"]')!,
  };
  const setInput = (field: HTMLInputElement, value: string) => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set; setter?.call(field, value); field.dispatchEvent(new Event("input", { bubbles: true })); };
  setInput(fields.token, "flex-token");
  setInput(fields.queryId, "123456");
  setInput(fields.passphrase, "vault-passphrase");
  await act(async () => { container.querySelector<HTMLButtonElement>('button[type="submit"]')?.click(); await Promise.resolve(); });

  expect(requests.some((request) => request.url === "/api/brokers/sync?force=true")).toBe(true);
  expect(container.textContent).toContain("Synchronisatie voltooid");
  expect(container.textContent).not.toContain("credentials are not configured");
  root.unmount();
});
