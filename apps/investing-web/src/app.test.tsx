// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { App, HealthStatus } from "./app";
import { emptyInvestingDashboard, type InvestingDashboardData } from "@lavega/core";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => { vi.restoreAllMocks(); globalThis.localStorage?.clear(); });

const dashboard: InvestingDashboardData = {
  ...emptyInvestingDashboard(),
  portfolio: { ...emptyInvestingDashboard().portfolio, "1M": [{ date: "2026-08-18", positionsValue: 100, cashValue: 20, value: 120, unpriced: [], forwardFilled: [], cashUnknown: [] }], All: [{ date: "2026-08-18", positionsValue: 100, cashValue: 20, value: 120, unpriced: [], forwardFilled: [], cashUnknown: [] }] },
  allocation: {
    instrument: { buckets: [{ key: "ASML", label: "ASML", value: 120, unpriced: false }], unpriced: [] },
    entity: { buckets: [{ key: "Privé", label: "Privé", value: 120, unpriced: false }], unpriced: [] },
  },
  positions: [{
    symbol: "ASML", entity: "personal", description: "ASML", quantity: 1, marketValue: 120, portfolioWeight: 1,
    priceStatus: "priced", currency: "EUR", asOf: "2026-08-18",
    returns: { status: "available", remainingCostBasis: 100, realizedCostBasisRemoved: 0, unrealizedGain: 20, realizedGain: 0, dividendsReceived: 5, totalReturn: 25, totalReturnPercentage: 0.25, sinceFirstBuyPercentage: 0.25, firstBuyDate: "2026-01-02" },
  }],
  position: {
    symbol: "ASML", description: "ASML", currency: "EUR", priceCurrency: "EUR", status: "open", quantity: 1,
    currentValue: 120, dailyChange: 2, dailyChangePercentage: 0.017, currentPrice: 120, averageCost: 100,
    returns: { status: "available", remainingCostBasis: 100, realizedCostBasisRemoved: 0, unrealizedGain: 20, realizedGain: 0, dividendsReceived: 5, totalReturn: 25, totalReturnPercentage: 0.25, sinceFirstBuyPercentage: 0.25, firstBuyDate: "2026-01-02" },
    returnStatus: "available", firstBuyDate: "2026-01-02",
    quantityHistory: [{ date: "2026-01-02", quantity: 1, delta: 1, reason: "buy", sourceOrder: 0 }],
    activity: [{ date: "2026-01-02", kind: "buy", quantity: 1, executionPrice: 100, amount: 100, commission: 0, currency: "EUR", sourceOrder: 0 }],
    points: [{ tenantId: "local", symbol: "ASML", date: "2026-08-18", close: 120, currency: "EUR", markers: [] }],
  },
};

const emptyDashboard = emptyInvestingDashboard();

function responseFor(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input);
  if (url === "/health") return new Response(JSON.stringify({ ok: true, service: "investing-server" }));
  if (url === "/api/market-data/consent") return new Response(JSON.stringify({ accepted: true }));
  if (url === "/api/brokers/sync" && init?.method === "POST") return new Response(JSON.stringify({ problems: [] }));
  if (url.startsWith("/api/investing/dashboard")) return new Response(JSON.stringify(dashboard));
  return new Response(JSON.stringify({}));
}

function emptyResponseFor(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input);
  if (url === "/health") return new Response(JSON.stringify({ ok: true, service: "investing-server" }));
  if (url === "/api/market-data/consent") return new Response(JSON.stringify({ accepted: true }));
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

test("positions table sorts numeric columns through URL state and preserves it in drilldown", async () => {
  const sortable: InvestingDashboardData = {
    ...dashboard,
    positions: [
      dashboard.positions[0]!,
      { ...dashboard.positions[0]!, symbol: "SMALL", description: "Small", marketValue: 50, portfolioWeight: 0.25, returns: { ...dashboard.positions[0]!.returns, totalReturn: -10, totalReturnPercentage: -0.1 } },
    ],
  };
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => String(input).startsWith("/api/investing/dashboard") ? Promise.resolve(new Response(JSON.stringify(sortable))) : Promise.resolve(responseFor(input, init))));
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);

  await act(async () => { root.render(<MemoryRouter initialEntries={["/positions?sort=return&direction=asc"]}><App /></MemoryRouter>); await Promise.resolve(); await Promise.resolve(); });

  const rows = Array.from(container.querySelectorAll('[role="rowgroup"] [role="row"]')).filter((row) => row.tagName === "A");
  expect(rows.map((row) => row.textContent)).toEqual([expect.stringContaining("Small"), expect.stringContaining("ASML")]);
  expect(container.querySelector('a[href="/positions/SMALL?sort=return&direction=asc"]')).not.toBeNull();
  const returnHeader = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Totaal rendement"));
  await act(async () => { returnHeader?.click(); });
  expect(container.querySelector('[role="columnheader"][aria-sort="descending"]')?.textContent).toContain("Totaal rendement");
  const instrumentHeader = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Instrument"));
  await act(async () => { instrumentHeader?.click(); });
  const alphabeticRows = Array.from(container.querySelectorAll('[role="rowgroup"] [role="row"]'));
  expect(alphabeticRows.map((row) => row.textContent)).toEqual([expect.stringContaining("ASML"), expect.stringContaining("Small")]);
  expect(container.querySelector('[role="columnheader"][aria-sort="ascending"]')?.textContent).toContain("Instrument");
  root.unmount();
});

test("positions table shows forward-filled, unpriced, missing-FX, and missing-cost states", async () => {
  const incomplete: InvestingDashboardData = {
    ...dashboard,
    positions: [
      { ...dashboard.positions[0]!, priceStatus: "forward-filled" },
      { ...dashboard.positions[0]!, symbol: "OLD", marketValue: null, portfolioWeight: null, priceStatus: "unpriced", returns: { ...dashboard.positions[0]!.returns, status: "unpriced", totalReturn: null, totalReturnPercentage: null } },
      { ...dashboard.positions[0]!, symbol: "FX", marketValue: null, portfolioWeight: null, priceStatus: "missing-fx", returns: { ...dashboard.positions[0]!.returns, status: "missing-fx", totalReturn: null, totalReturnPercentage: null } },
      { ...dashboard.positions[0]!, symbol: "COST", returns: { ...dashboard.positions[0]!.returns, status: "missing-cost", totalReturn: null, totalReturnPercentage: null } },
    ],
  };
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => String(input).startsWith("/api/investing/dashboard") ? Promise.resolve(new Response(JSON.stringify(incomplete))) : Promise.resolve(responseFor(input, init))));
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter initialEntries={["/positions"]}><App /></MemoryRouter>); await Promise.resolve(); await Promise.resolve(); });
  expect(container.textContent).toContain("Geschatte koers");
  expect(container.textContent).toContain("Waarde onbekend");
  expect(container.textContent).toContain("FX-koers ontbreekt");
  expect(container.textContent).toContain("Rendement niet beschikbaar");
  expect(container.textContent).toContain("Importeer eerdere transacties");
  root.unmount();
});

test("overview exposes positions as navigation links", async () => {
  vi.stubGlobal("fetch", vi.fn((input, init) => Promise.resolve(responseFor(input, init))));
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);

  await act(async () => { root.render(<MemoryRouter initialEntries={["/"]}><App /></MemoryRouter>); await Promise.resolve(); await Promise.resolve(); });

  expect(container.querySelector('a[href="/positions/ASML"]')).not.toBeNull();
  root.unmount();
});

test("overview preserves responsive reading order and independent chart ranges", async () => {
  vi.stubGlobal("fetch", vi.fn((input, init) => Promise.resolve(responseFor(input, init))));
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter initialEntries={["/"]}><App /></MemoryRouter>); await Promise.resolve(); await Promise.resolve(); });

  const order = Array.from(container.querySelectorAll<HTMLElement>("[data-dashboard-section]")).map((element) => element.dataset.dashboardSection);
  expect(order).toEqual(["performance", "kpis", "allocation", "status", "positions", "net-worth"]);
  const performanceRange = container.querySelector<HTMLElement>('[role="group"][aria-label="Periode kiezen"]')!;
  const netWorthRange = container.querySelector<HTMLElement>('[role="group"][aria-label="Periode nettovermogen kiezen"]')!;
  expect(performanceRange.querySelector('button[aria-pressed="true"]')?.textContent).toBe("1 maand");
  await act(async () => { Array.from(netWorthRange.querySelectorAll("button")).find((button) => button.textContent === "Alles")?.click(); });
  expect(netWorthRange.querySelector('button[aria-pressed="true"]')?.textContent).toBe("Alles");
  expect(performanceRange.querySelector('button[aria-pressed="true"]')?.textContent).toBe("1 maand");
  root.unmount();
});

test("overview makes KPIs and all operational status chips visible", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/brokers/sync/status") return new Response(JSON.stringify({ status: "waiting", pages: 2, ordersRead: 40, positionsRead: 1, waitUntil: null, remaining: 1, updatedAt: "2026-08-21T10:00:00Z", message: "API-pauze" }));
    if (url === "/api/prices/sync/status") return new Response(JSON.stringify({ status: "problem", total: 3, completed: 2, remainingSymbols: ["OLD"], currentSymbol: null, waitUntil: null, updatedAt: "2026-08-21T10:00:00Z", message: null, problems: ["OLD: mislukt"] }));
    if (url === "/api/brokers/credentials/status") return new Response(JSON.stringify({ status: "locked" }));
    return responseFor(input, init);
  }));
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter><App /></MemoryRouter>); await Promise.resolve(); await Promise.resolve(); });
  expect(container.textContent).toContain("Portefeuillewaarde");
  expect(container.textContent).toContain("Dagmutatie");
  expect(container.textContent).toContain("Totaal rendement");
  expect(container.textContent).toContain("BrokersWachten");
  expect(container.textContent).toContain("PrijsgeschiedenisProbleem");
  expect(container.textContent).toContain("KluisVergrendeld");
  expect(container.textContent).toContain("CacheVersie");
  expect(container.textContent).toContain("ASML");
  root.unmount();
});

test("overview separates positions, cash, and incomplete value states", async () => {
  const incomplete: InvestingDashboardData = {
    ...dashboard,
    portfolio: {
      ...dashboard.portfolio,
      All: [{ date: "2026-08-18", positionsValue: 100, cashValue: null, value: 100, unpriced: ["MSFT"], forwardFilled: ["ASML"], cashUnknown: ["ibkr:USD"] }],
    },
  };
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => String(input).startsWith("/api/investing/dashboard")
    ? Promise.resolve(new Response(JSON.stringify(incomplete)))
    : Promise.resolve(responseFor(input, init))));
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);

  await act(async () => { root.render(<MemoryRouter initialEntries={["/"]}><App /></MemoryRouter>); await Promise.resolve(); await Promise.resolve(); });

  expect(container.textContent).toContain("Posities");
  expect(container.textContent).toContain("Cash");
  expect(container.textContent).toContain("Waarde deels onbekend");
  expect(container.textContent).toContain("MSFT");
  expect(container.textContent).toContain("ibkr:USD");
  expect(container.textContent).toContain("Geschatte koers: ASML");
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

test("position detail shows returns, quantity disclosure, and activity", async () => {
  vi.stubGlobal("fetch", vi.fn((input, init) => Promise.resolve(responseFor(input, init))));
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter initialEntries={["/positions/ASML?sort=return&direction=asc"]}><App /></MemoryRouter>); await Promise.resolve(); await Promise.resolve(); });

  expect(container.textContent).toContain("Open positie");
  expect(container.textContent).toContain("Huidige waarde");
  expect(container.textContent).toContain("Totaal rendement");
  expect(container.textContent).toContain("Sinds eerste aankoop:");
  expect(container.textContent).toContain("vanaf 2026-01-02");
  expect(container.textContent).toContain("Activiteit");
  const quantity = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Aantalhistorie"));
  expect(quantity?.getAttribute("aria-expanded")).toBe("false");
  await act(async () => { quantity?.click(); });
  expect(quantity?.getAttribute("aria-expanded")).toBe("true");
  expect(container.textContent).toContain("2 januari 2026 · Koop");
  expect(container.querySelector('a[href="/positions?sort=return&direction=asc"]')).not.toBeNull();
  root.unmount();
});

test("closed position omits current value and keeps realized history", async () => {
  const closed: InvestingDashboardData = { ...dashboard, position: { ...dashboard.position!, symbol: "CLOSED", description: "Closed Co", status: "closed", quantity: 0, currentValue: null, dailyChange: null, dailyChangePercentage: null, currentPrice: null, averageCost: null, returns: { ...dashboard.position!.returns, remainingCostBasis: 0, unrealizedGain: 0, realizedGain: 30, dividendsReceived: 4, totalReturn: 34 }, activity: [{ date: "2026-04-02", kind: "sell", quantity: 1, executionPrice: 130, amount: 130, commission: 1, currency: "EUR", sourceOrder: 1 }, { date: "2026-01-02", kind: "buy", quantity: 1, executionPrice: 100, amount: 100, commission: 0, currency: "EUR", sourceOrder: 0 }] } };
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => String(input).startsWith("/api/investing/dashboard") ? Promise.resolve(new Response(JSON.stringify(closed))) : Promise.resolve(responseFor(input, init))));
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter initialEntries={["/positions/CLOSED"]}><App /></MemoryRouter>); await Promise.resolve(); await Promise.resolve(); });

  expect(container.textContent).toContain("Gesloten positie");
  expect(container.textContent).toContain("0 stuks · gesloten");
  expect(container.textContent).not.toContain("Huidige waarde");
  expect(Array.from(container.querySelectorAll('div[id^="activity-"]')).map((row) => row.id)).toEqual(["activity-2026-04-02", "activity-2026-01-02"]);
  root.unmount();
});

test("position detail shows import prompt when return history is incomplete", async () => {
  const incomplete: InvestingDashboardData = { ...dashboard, position: { ...dashboard.position!, returnStatus: "missing-cost", returns: { ...dashboard.position!.returns, status: "missing-cost", remainingCostBasis: null, realizedCostBasisRemoved: null, unrealizedGain: null, realizedGain: null, dividendsReceived: null, totalReturn: null, totalReturnPercentage: null, sinceFirstBuyPercentage: null } } };
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => String(input).startsWith("/api/investing/dashboard") ? Promise.resolve(new Response(JSON.stringify(incomplete))) : Promise.resolve(responseFor(input, init))));
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter initialEntries={["/positions/ASML"]}><App /></MemoryRouter>); await Promise.resolve(); await Promise.resolve(); });
  expect(container.textContent).toContain("Importeer eerdere transacties of koppel je andere brokers om rendement te berekenen.");
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

test("requests and persists Yahoo consent before broker-triggered price sync", async () => {
  const requests: Array<{ url: string; method?: string }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); requests.push({ url, method: init?.method });
    if (url.startsWith("/api/investing/dashboard")) return new Response(JSON.stringify(emptyDashboard));
    if (url === "/api/market-data/consent" && init?.method === "PUT") return new Response(JSON.stringify({ accepted: true }));
    if (url === "/api/market-data/consent") return new Response(JSON.stringify({ accepted: false }));
    if (url === "/api/brokers/sync") return new Response(JSON.stringify({ problems: [] }));
    return new Response(JSON.stringify({ problems: [] }));
  }));
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  await act(async () => { root.render(<MemoryRouter><App /></MemoryRouter>); await Promise.resolve(); await Promise.resolve(); });
  expect(container.textContent).toContain("Yahoo Finance-toestemming");
  expect(requests).not.toContainEqual({ url: "/api/brokers/sync", method: "POST" });
  await act(async () => { Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Yahoo Finance toestaan"))?.click(); await Promise.resolve(); });
  expect(requests).toContainEqual({ url: "/api/market-data/consent", method: "PUT" });
  expect(requests).toContainEqual({ url: "/api/brokers/sync", method: "POST" });
  root.unmount();
});

test("overview reports independent price-sync progress", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/prices/sync/status") return new Response(JSON.stringify({ status: "running", total: 4, completed: 2, remainingSymbols: ["CLOSED", "^STOXX50E"], currentSymbol: "CLOSED", waitUntil: null, updatedAt: "2026-08-21T10:00:00.000Z", message: null, problems: [] }));
    return responseFor(input, init);
  }));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<MemoryRouter><App /></MemoryRouter>);
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(container.textContent).toContain("Prijsgeschiedenis");
  expect(container.textContent).toContain("2 van 4 geladen");
  expect(container.textContent).toContain("CLOSED wordt geladen");
  root.unmount();
});

test("shows broker sync problems and asks before deleting cached prices", async () => {
  const requests: Array<{ url: string; method?: string }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), method: init?.method });
    if (String(input) === "/api/market-data/consent") return new Response(JSON.stringify({ accepted: true }));
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
  expect(container.textContent).toContain("Cash Report");
  expect(container.textContent).toContain("Statement of Funds");
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

test("locked broker vault can be unlocked without entering broker credentials again", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(input), init });
    if (String(input) === "/api/brokers/credentials/status") return new Response(JSON.stringify({ status: "locked" }));
    if (String(input) === "/api/brokers/credentials/unlock") return new Response(null, { status: 204 });
    if (String(input) === "/api/brokers/sync?force=true") return new Response(JSON.stringify({ outcomes: [{ status: "synced" }], problems: [] }));
    return new Response(JSON.stringify({ ok: true, service: "investing-server" }));
  }));
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);

  await act(async () => { root.render(<MemoryRouter initialEntries={["/brokers/connect"]}><App /></MemoryRouter>); await Promise.resolve(); await Promise.resolve(); });
  const passphrase = container.querySelector<HTMLInputElement>('[name="unlockPassphrase"]')!;
  expect(passphrase).not.toBeNull();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(passphrase, "vault-passphrase");
    passphrase.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { container.querySelector<HTMLButtonElement>('[data-action="unlock-vault"]')?.click(); await Promise.resolve(); });

  const unlockRequest = requests.find((request) => request.url === "/api/brokers/credentials/unlock");
  expect(unlockRequest?.init?.body).toBe(JSON.stringify({ passphrase: "vault-passphrase" }));
  expect(requests.some((request) => request.url === "/api/brokers/sync?force=true")).toBe(true);
  expect(container.textContent).toContain("Kluis ontgrendeld");
  expect(container.textContent).not.toContain("vault-passphrase");
  await act(async () => { root.unmount(); });
});

test("broker sync progress shows exact pages, orders, and provider wait", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    if (String(input) === "/api/brokers/sync/status") return new Response(JSON.stringify({ status: "waiting", pages: 6, ordersRead: 300, positionsRead: 0, waitUntil: "2026-08-19T14:00:00.000Z", remaining: 0, updatedAt: "2026-08-19T13:59:00.000Z", message: null }));
    if (String(input) === "/api/brokers/credentials/status") return new Response(JSON.stringify({ status: "unlocked" }));
    return new Response(JSON.stringify({ ok: true, service: "investing-server" }));
  }));
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);

  await act(async () => { root.render(<MemoryRouter initialEntries={["/brokers/connect"]}><App /></MemoryRouter>); await Promise.resolve(); await Promise.resolve(); });

  expect(container.textContent).toContain("Trading 212 synchroniseert");
  expect(container.textContent).toContain("6 pagina’s");
  expect(container.textContent).toContain("300 orders gelezen");
  expect(container.textContent).toContain("0 posities");
  expect(container.textContent).toContain("Wacht op nieuwe API-capaciteit");
  await act(async () => { root.unmount(); });
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

test("the health line asks the investing server, not whoever owns the origin root", async () => {
  /* In the all-in-one deploy this app is served under /investing/, and the
   * origin's own /health belongs to the personal server: it answers {ok:true}
   * with no `service` field, so a hardcoded "/health" renders as ": beschikbaar"
   * with an empty name and says nothing about whether the investing runtime is
   * actually up. The request has to carry the base the app was built with. */
  vi.stubEnv("BASE_URL", "/investing/");
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    calls.push(String(input));
    return Promise.resolve(new Response(JSON.stringify({ ok: true, service: "investing-server" })));
  }));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<HealthStatus />);
  });
  // The health body arrives two microtasks later (fetch, then .json()), so let
  // the state land inside act rather than after the assertion.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(calls).toEqual(["/investing/health"]);
  expect(container.textContent).toContain("investing-server: beschikbaar");
  root.unmount();
  vi.unstubAllEnvs();
});
