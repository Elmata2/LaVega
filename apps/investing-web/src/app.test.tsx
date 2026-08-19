// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "./app";
import { emptyInvestingDashboard, type InvestingDashboardData } from "@lavega/core";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => vi.restoreAllMocks());

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
  if (url === "/api/market-data/consent") return new Response(JSON.stringify({ accepted: true, disclosure: "Yahoo-melding" }));
  if (url === "/api/brokers/sync" && init?.method === "POST") return new Response(JSON.stringify({ problems: [] }));
  if (url.startsWith("/api/investing/dashboard")) return new Response(JSON.stringify(dashboard));
  return new Response(JSON.stringify({}));
}

function emptyResponseFor(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input);
  if (url === "/health") return new Response(JSON.stringify({ ok: true, service: "investing-server" }));
  if (url === "/api/market-data/consent") return new Response(JSON.stringify({ accepted: true, disclosure: "Yahoo-melding" }));
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

test("shows Yahoo disclosure and sends no price sync before acceptance", async () => {
  const requests: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => { requests.push(String(input)); if (String(input).startsWith("/api/investing/dashboard")) return new Response(JSON.stringify(emptyDashboard)); return new Response(JSON.stringify(String(input) === "/api/market-data/consent" && init?.method === "POST" ? { accepted: true } : { accepted: false, disclosure: "Yahoo-melding" })); }));
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter><App /></MemoryRouter>); await Promise.resolve(); await Promise.resolve(); });
  expect(container.textContent).toContain("Yahoo-melding");
  expect(Array.from(container.querySelectorAll("button")).some((button) => button.textContent?.includes("ga akkoord"))).toBe(true);
  expect(requests).toContain("/health");
  expect(requests).toContain("/api/market-data/consent");
  expect(requests).not.toContain("/api/prices/sync");
  await act(async () => { Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("ga akkoord"))!.click(); await Promise.resolve(); });
  expect(requests).toContain("/api/market-data/consent");
  expect(requests.filter((request) => request === "/api/market-data/consent")).toHaveLength(2);
  expect(requests).not.toContain("/api/prices/sync");
  root.unmount();
});

test("shows broker sync problems and asks before deleting cached prices", async () => {
  const requests: Array<{ url: string; method?: string }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), method: init?.method });
    if (String(input) === "/api/brokers/sync") return new Response(JSON.stringify({ problems: ["ibkr: niet beschikbaar"] }));
    if (String(input) === "/api/market-data/consent") return new Response(JSON.stringify({ accepted: true, disclosure: "Yahoo-melding" }));
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
