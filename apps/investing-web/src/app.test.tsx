// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, MemoryRouter } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { App, HealthStatus } from "./app";
import { forgetDashboards } from "./lib/dashboardResource";
import { PERSONAL_URL } from "./lib/personal";
import { emptyInvestingDashboard, type InvestingDashboardData } from "@lavega/core";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.localStorage?.clear();
  forgetDashboards();
});

const dashboard: InvestingDashboardData = {
  ...emptyInvestingDashboard(),
  portfolio: {
    ...emptyInvestingDashboard().portfolio,
    "1M": [
      {
        date: "2026-08-18",
        positionsValue: 100,
        cashValue: 20,
        value: 120,
        unpriced: [],
        forwardFilled: [],
        cashUnknown: [],
      },
    ],
    All: [
      {
        date: "2026-08-18",
        positionsValue: 100,
        cashValue: 20,
        value: 120,
        unpriced: [],
        forwardFilled: [],
        cashUnknown: [],
      },
    ],
  },
  allocation: {
    instrument: {
      buckets: [{ key: "ASML", label: "ASML", value: 120, unpriced: false }],
      unpriced: [],
    },
    entity: {
      buckets: [{ key: "Privé", label: "Privé", value: 120, unpriced: false }],
      unpriced: [],
    },
  },
  positions: [
    {
      symbol: "ASML",
      entity: "personal",
      description: "ASML",
      quantity: 1,
      marketValue: 120,
      portfolioWeight: 1,
      priceStatus: "priced",
      currency: "EUR",
      asOf: "2026-08-18",
      returns: {
        status: "available",
        remainingCostBasis: 100,
        realizedCostBasisRemoved: 0,
        unrealizedGain: 20,
        realizedGain: 0,
        dividendsReceived: 5,
        totalReturn: 25,
        totalReturnPercentage: 0.25,
        sinceFirstBuyPercentage: 0.25,
        firstBuyDate: "2026-01-02",
      },
    },
  ],
  position: {
    symbol: "ASML",
    description: "ASML",
    currency: "EUR",
    priceCurrency: "EUR",
    status: "open",
    quantity: 1,
    currentValue: 120,
    dailyChange: 2,
    dailyChangePercentage: 0.017,
    currentPrice: 120,
    priceStatus: "priced",
    quoteDate: "2026-02-02",
    averageCost: 100,
    returns: {
      status: "available",
      remainingCostBasis: 100,
      realizedCostBasisRemoved: 0,
      unrealizedGain: 20,
      realizedGain: 0,
      dividendsReceived: 5,
      totalReturn: 25,
      totalReturnPercentage: 0.25,
      sinceFirstBuyPercentage: 0.25,
      firstBuyDate: "2026-01-02",
    },
    returnStatus: "available",
    firstBuyDate: "2026-01-02",
    quantityHistory: [{ date: "2026-01-02", quantity: 1, delta: 1, reason: "buy", sourceOrder: 0 }],
    activity: [
      {
        date: "2026-01-02",
        kind: "buy",
        quantity: 1,
        executionPrice: 100,
        amount: 100,
        commission: 0,
        currency: "EUR",
        sourceOrder: 0,
      },
    ],
    points: [{ symbol: "ASML", date: "2026-08-18", close: 120, currency: "EUR", markers: [] }],
  },
};

const emptyDashboard = emptyInvestingDashboard();
const portfolioAgents = [
  {
    id: "warren_buffett",
    displayName: "Warren Buffett",
    description: "Quality business owner",
    investingStyle: "Durable moats, fair price.",
  },
  {
    id: "charlie_munger",
    displayName: "Charlie Munger",
    description: "Quality filter",
    investingStyle: "Invert first.",
  },
  {
    id: "bill_ackman",
    displayName: "Bill Ackman",
    description: "Activist lens",
    investingStyle: "Concentrated brands and catalysts.",
  },
];
const agentInsight = {
  agentId: "bill_ackman",
  displayName: "Bill Ackman",
  signal: "bullish",
  confidence: 78,
  summary: "ASML is concentrated but priced with clear conviction.",
  reasoning: "Position size and return profile show conviction; catalyst data is absent.",
  insights: ["ASML dominates portfolio risk.", "Missing catalyst data limits confidence."],
  model: "test-model",
  snapshotHash: "hash",
};
const agentConversation = {
  agentId: "bill_ackman",
  displayName: "Bill Ackman",
  text: "ASML is concentrated but priced with clear conviction.",
  model: "openrouter-test",
  snapshotHash: "snapshot",
  judgment: { signal: "bullish", confidence: 80 },
};

/* Every existing test here predates sign-up and runs against a backend
 * with no DATABASE_URL / BETTER_AUTH_SECRET, exactly like local dev — so
 * RequireAuth's get-session check must see the same 503 apps/server sends
 * in that mode, or these tests would redirect to /sign-in instead of
 * rendering the dashboard. */
function withAuthUnconfigured(input: RequestInfo | URL, fallback: () => Response): Response {
  if (String(input) === "/api/auth/get-session")
    return new Response(JSON.stringify({ problems: ["Authentication is not configured"] }), {
      status: 503,
    });
  return fallback();
}

function responseFor(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input);
  return withAuthUnconfigured(input, () => {
    if (url === "/api/investing/health")
      return new Response(JSON.stringify({ ok: true, service: "investing-server" }));
    if (url === "/api/market-data/consent") return new Response(JSON.stringify({ accepted: true }));
    if (url === "/api/agents/portfolio")
      return new Response(JSON.stringify({ agents: portfolioAgents }));
    if (url === "/api/agents/portfolio/run" && init?.method === "POST")
      return new Response(JSON.stringify({ result: agentInsight }));
    if (url === "/api/agents/portfolio/conversation" && init?.method === "POST")
      return new Response(JSON.stringify({ result: agentConversation }));
    if (url === "/api/brokers/sync" && init?.method === "POST")
      return new Response(JSON.stringify({ problems: [] }));
    if (url.startsWith("/api/investing/dashboard")) return new Response(JSON.stringify(dashboard));
    return new Response(JSON.stringify({}));
  });
}

function emptyResponseFor(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input);
  return withAuthUnconfigured(input, () => {
    if (url === "/api/investing/health")
      return new Response(JSON.stringify({ ok: true, service: "investing-server" }));
    if (url === "/api/market-data/consent") return new Response(JSON.stringify({ accepted: true }));
    if (url === "/api/agents/portfolio")
      return new Response(JSON.stringify({ agents: portfolioAgents }));
    if (url === "/api/agents/portfolio/run" && init?.method === "POST")
      return new Response(JSON.stringify({ result: agentInsight }));
    if (url === "/api/agents/portfolio/conversation" && init?.method === "POST")
      return new Response(JSON.stringify({ result: agentConversation }));
    if (url === "/api/brokers/sync" && init?.method === "POST")
      return new Response(JSON.stringify({ problems: [] }));
    if (url.startsWith("/api/investing/dashboard"))
      return new Response(JSON.stringify(emptyDashboard));
    return new Response(JSON.stringify({}));
  });
}

test("overview shell fetches and displays investing server health", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(responseFor(input, init)),
    ),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(container.textContent).toContain("investing-server: beschikbaar");
  expect(container.textContent).toContain("Portfolio value");
  expect(container.textContent).toContain("ASML");
  expect(fetch).toHaveBeenCalledWith(
    "/api/investing/dashboard",
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(fetch).toHaveBeenCalledWith("/api/investing/health");
  root.unmount();
});

test("positions route renders its empty state", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) => Promise.resolve(emptyResponseFor(input, init))),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/positions"]}>
        <App />
      </MemoryRouter>,
    );
  });

  expect(container.textContent).toContain("No positions loaded");
  expect(container.querySelector('nav[aria-label="Main navigation"]')).not.toBeNull();
  root.unmount();
});

test("overview shows priced positions total when history is still unavailable", async () => {
  const fallbackDashboard: InvestingDashboardData = {
    ...emptyInvestingDashboard(),
    positions: [
      {
        symbol: "HLMAl_EQ",
        entity: "personal",
        description: "Halma",
        quantity: 0.319,
        marketValue: 10150,
        portfolioWeight: 1,
        priceStatus: "priced",
        currency: "GBX",
        asOf: "2026-08-18",
        returns: {
          status: "missing-cost",
          remainingCostBasis: null,
          realizedCostBasisRemoved: 0,
          unrealizedGain: null,
          realizedGain: 0,
          dividendsReceived: 0,
          totalReturn: null,
          totalReturnPercentage: null,
          sinceFirstBuyPercentage: null,
          firstBuyDate: null,
        },
      },
    ],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(
        withAuthUnconfigured(input, () => {
          const url = String(input);
          if (url === "/api/investing/health")
            return new Response(JSON.stringify({ ok: true, service: "investing-server" }));
          if (url === "/api/market-data/consent")
            return new Response(JSON.stringify({ accepted: true }));
          if (url === "/api/agents/portfolio")
            return new Response(JSON.stringify({ agents: portfolioAgents }));
          if (url === "/api/agents/portfolio/run" && init?.method === "POST")
            return new Response(JSON.stringify({ result: agentInsight }));
          if (url === "/api/agents/portfolio/conversation" && init?.method === "POST")
            return new Response(JSON.stringify({ result: agentConversation }));
          if (url === "/api/brokers/sync" && init?.method === "POST")
            return new Response(
              JSON.stringify({ problems: ["ibkr: credentials are not configured"] }),
            );
          if (url.startsWith("/api/investing/dashboard"))
            return new Response(JSON.stringify(fallbackDashboard));
          return new Response(JSON.stringify({}));
        }),
      ),
    ),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(container.textContent).toContain("10,150.00");
  expect(container.textContent).toContain("Priced positions only");
  expect(container.textContent).toContain("0.319 shares");
  expect(container.textContent).not.toContain("credentials are not configured");
  root.unmount();
});

test("positions route renders loading state while read model is pending", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) =>
      String(input).startsWith("/api/investing/dashboard")
        ? new Promise<Response>(() => {})
        : Promise.resolve(
            withAuthUnconfigured(
              input,
              () => new Response(JSON.stringify({ ok: true, service: "investing-server" })),
            ),
          ),
    ),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/positions"]}>
        <App />
      </MemoryRouter>,
    );
  });

  expect(container.textContent).toContain("Loading dashboard");
  root.unmount();
});

test("positions route renders read-model error state", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) =>
      String(input).startsWith("/api/investing/dashboard")
        ? Promise.resolve(new Response("", { status: 503 }))
        : Promise.resolve(
            withAuthUnconfigured(
              input,
              () => new Response(JSON.stringify({ ok: true, service: "investing-server" })),
            ),
          ),
    ),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/positions"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(container.textContent).toContain("Dashboard unavailable");
  root.unmount();
});

test("positions view renders read-model positions as links", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) => Promise.resolve(responseFor(input, init))),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/positions"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(container.textContent).toContain("ASML");
  expect(container.querySelector('a[href="/positions/ASML"]')).not.toBeNull();
  root.unmount();
});

test("positions table sorts numeric columns through URL state and preserves it in drilldown", async () => {
  const sortable: InvestingDashboardData = {
    ...dashboard,
    positions: [
      dashboard.positions[0]!,
      {
        ...dashboard.positions[0]!,
        symbol: "SMALL",
        description: "Small",
        marketValue: 50,
        portfolioWeight: 0.25,
        returns: {
          ...dashboard.positions[0]!.returns,
          totalReturn: -10,
          totalReturnPercentage: -0.1,
        },
      },
    ],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).startsWith("/api/investing/dashboard")
        ? Promise.resolve(new Response(JSON.stringify(sortable)))
        : Promise.resolve(responseFor(input, init)),
    ),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/positions?sort=return&direction=asc"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  const rows = Array.from(container.querySelectorAll('[role="rowgroup"] [role="row"]')).filter(
    (row) => row.tagName === "A",
  );
  expect(rows.map((row) => row.textContent)).toEqual([
    expect.stringContaining("Small"),
    expect.stringContaining("ASML"),
  ]);
  expect(
    container.querySelector('a[href="/positions/SMALL?sort=return&direction=asc"]'),
  ).not.toBeNull();
  const returnHeader = Array.from(container.querySelectorAll("button")).find((button) =>
    button.textContent?.includes("Total return"),
  );
  await act(async () => {
    returnHeader?.click();
  });
  expect(
    container.querySelector('[role="columnheader"][aria-sort="descending"]')?.textContent,
  ).toContain("Total return");
  const instrumentHeader = Array.from(container.querySelectorAll("button")).find((button) =>
    button.textContent?.includes("Instrument"),
  );
  await act(async () => {
    instrumentHeader?.click();
  });
  const alphabeticRows = Array.from(container.querySelectorAll('[role="rowgroup"] [role="row"]'));
  expect(alphabeticRows.map((row) => row.textContent)).toEqual([
    expect.stringContaining("ASML"),
    expect.stringContaining("Small"),
  ]);
  expect(
    container.querySelector('[role="columnheader"][aria-sort="ascending"]')?.textContent,
  ).toContain("Instrument");
  root.unmount();
});

test("positions table shows forward-filled, unpriced, missing-FX, and missing-cost states", async () => {
  const incomplete: InvestingDashboardData = {
    ...dashboard,
    positions: [
      { ...dashboard.positions[0]!, priceStatus: "forward-filled" },
      {
        ...dashboard.positions[0]!,
        symbol: "OLD",
        marketValue: null,
        portfolioWeight: null,
        priceStatus: "unpriced",
        returns: {
          ...dashboard.positions[0]!.returns,
          status: "unpriced",
          totalReturn: null,
          totalReturnPercentage: null,
        },
      },
      {
        ...dashboard.positions[0]!,
        symbol: "FX",
        marketValue: null,
        portfolioWeight: null,
        priceStatus: "missing-fx",
        returns: {
          ...dashboard.positions[0]!.returns,
          status: "missing-fx",
          totalReturn: null,
          totalReturnPercentage: null,
        },
      },
      {
        ...dashboard.positions[0]!,
        symbol: "COST",
        returns: {
          ...dashboard.positions[0]!.returns,
          status: "missing-cost",
          totalReturn: null,
          totalReturnPercentage: null,
        },
      },
    ],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).startsWith("/api/investing/dashboard")
        ? Promise.resolve(new Response(JSON.stringify(incomplete)))
        : Promise.resolve(responseFor(input, init)),
    ),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/positions"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(container.textContent).toContain("Estimated price");
  expect(container.textContent).toContain("Value unknown");
  expect(container.textContent).toContain("FX rate missing");
  expect(container.textContent).toContain("Return unavailable");
  expect(container.textContent).toContain("Import earlier transactions");
  root.unmount();
});

test("overview exposes positions as navigation links", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) => Promise.resolve(responseFor(input, init))),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(container.querySelector('a[href="/positions/ASML"]')).not.toBeNull();
  root.unmount();
});

test("overview preserves responsive reading order and independent chart ranges", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) => Promise.resolve(responseFor(input, init))),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  const order = Array.from(container.querySelectorAll<HTMLElement>("[data-dashboard-section]")).map(
    (element) => element.dataset.dashboardSection,
  );
  expect(order).toEqual([
    "performance",
    "allocation",
    "kpis",
    "agent",
    "status",
    "positions",
    "net-worth",
  ]);
  const performanceRange = container.querySelector<HTMLElement>(
    '[role="group"][aria-label="Choose period"]',
  )!;
  const netWorthRange = container.querySelector<HTMLElement>(
    '[role="group"][aria-label="Choose net worth period"]',
  )!;
  expect(performanceRange.querySelector('button[aria-pressed="true"]')?.textContent).toBe(
    "1 month",
  );
  await act(async () => {
    Array.from(netWorthRange.querySelectorAll("button"))
      .find((button) => button.textContent === "All")
      ?.click();
  });
  expect(netWorthRange.querySelector('button[aria-pressed="true"]')?.textContent).toBe("All");
  expect(performanceRange.querySelector('button[aria-pressed="true"]')?.textContent).toBe(
    "1 month",
  );
  root.unmount();
});

test("overview runs portfolio investor agent and renders its insight", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      return Promise.resolve(responseFor(input, init));
    }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(container.textContent).toContain("Investor lens");
  expect(container.textContent).toContain("Warren Buffett");
  expect(container.textContent).toContain("Bill Ackman");
  const ackmanButton = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent === "Bill Ackman",
  );
  expect(ackmanButton).not.toBeUndefined();

  await act(async () => {
    Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Analyse portfolio")
      ?.click();
    await Promise.resolve();
  });

  const runRequest = requests.find((request) => request.url === "/api/agents/portfolio/run");
  expect(runRequest?.init?.method).toBe("POST");
  expect(runRequest?.init?.body).toBe(JSON.stringify({ agentId: "warren_buffett" }));
  expect(container.textContent).toContain("ASML is concentrated but priced with clear conviction.");
  expect(container.textContent).toContain("Missing catalyst data limits confidence.");
  root.unmount();
});

test("clicking an agent opens its workbench window", async () => {
  const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(responseFor(input, init)),
    ),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  await act(async () => {
    Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Bill Ackman")
      ?.click();
  });

  expect(open).toHaveBeenCalledWith(
    "/agents/bill_ackman",
    "lavega-agent-workbench",
    "popup,width=1180,height=860",
  );
  root.unmount();
});

test("agent route opens focused chat with the account positions", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      return Promise.resolve(responseFor(input, init));
    }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/agents/bill_ackman"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(container.textContent).toContain("Bill Ackman");
  expect(container.textContent).toContain("Your positions");
  expect(container.textContent).toContain("ASML");

  const input = container.querySelector<HTMLInputElement>("#agent-message");
  const form = input?.closest("form");
  expect(input).not.toBeNull();
  await act(async () => {
    if (!input || !form) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, "Waarom is ASML mijn grootste risico?");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });

  const runRequest = requests.find(
    (request) => request.url === "/api/agents/portfolio/conversation",
  );
  expect(runRequest?.init?.body).toBe(
    JSON.stringify({
      agentId: "bill_ackman",
      prompt: "Waarom is ASML mijn grootste risico?",
      history: [],
    }),
  );
  expect(container.textContent).toContain("ASML is concentrated but priced with clear conviction.");
  root.unmount();
});

test("overview makes KPIs and all operational status chips visible", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/brokers/sync/status")
        return new Response(
          JSON.stringify({
            status: "waiting",
            pages: 2,
            ordersRead: 40,
            positionsRead: 1,
            waitUntil: null,
            remaining: 1,
            updatedAt: "2026-08-21T10:00:00Z",
            message: "API pause",
          }),
        );
      if (url === "/api/prices/sync/status")
        return new Response(
          JSON.stringify({
            status: "problem",
            total: 3,
            completed: 2,
            remainingSymbols: ["OLD"],
            currentSymbol: null,
            waitUntil: null,
            updatedAt: "2026-08-21T10:00:00Z",
            message: null,
            problems: ["OLD: failed"],
          }),
        );
      if (url === "/api/brokers/credentials/status")
        return new Response(JSON.stringify({ status: "locked" }));
      return responseFor(input, init);
    }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(container.textContent).toContain("Portfolio value");
  expect(container.textContent).toContain("Daily change");
  expect(container.textContent).toContain("Total return");
  expect(container.textContent).toContain("BrokersWaiting");
  expect(container.textContent).toContain("Price historyProblem");
  expect(container.textContent).toContain("VaultLocked");
  expect(container.textContent).toContain("CacheVersion");
  expect(container.textContent).toContain("ASML");
  root.unmount();
});

test("overview separates positions, cash, and incomplete value states", async () => {
  const incomplete: InvestingDashboardData = {
    ...dashboard,
    portfolio: {
      ...dashboard.portfolio,
      All: [
        {
          date: "2026-08-18",
          positionsValue: 100,
          cashValue: null,
          value: 100,
          unpriced: ["MSFT"],
          forwardFilled: ["ASML"],
          cashUnknown: ["ibkr:USD"],
        },
      ],
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).startsWith("/api/investing/dashboard")
        ? Promise.resolve(new Response(JSON.stringify(incomplete)))
        : Promise.resolve(responseFor(input, init)),
    ),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(container.textContent).toContain("Positions");
  expect(container.textContent).toContain("Cash");
  expect(container.textContent).toContain("Value partly unknown");
  expect(container.textContent).toContain("MSFT");
  expect(container.textContent).toContain("ibkr:USD");
  expect(container.textContent).toContain("Estimated price: ASML");
  root.unmount();
});

test("position navigation moves from overview to detail and back", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) => Promise.resolve(responseFor(input, init))),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  const positionLink = container.querySelector<HTMLAnchorElement>('a[href="/positions/ASML"]');
  await act(async () => {
    positionLink?.click();
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(container.textContent).toContain("Price history");

  const backLink = container.querySelector<HTMLAnchorElement>('a[href="/positions"]');
  await act(async () => {
    backLink?.click();
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(container.textContent).toContain("Positions");
  root.unmount();
});

test("position detail selects symbol from route and links back", async () => {
  const requests: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) => {
      requests.push(String(input));
      return Promise.resolve(responseFor(input, init));
    }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/positions/ASML"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(container.textContent).toContain("Price history");
  expect(container.textContent).toContain("ASML");
  expect(requests).toContain("/api/investing/dashboard?symbol=ASML");
  expect(container.querySelector('a[href="/positions"]')).not.toBeNull();
  root.unmount();
});

test("position detail shows returns, quantity disclosure, and activity", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) => Promise.resolve(responseFor(input, init))),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/positions/ASML?sort=return&direction=asc"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(container.textContent).toContain("Open position");
  expect(container.textContent).toContain("Current value");
  expect(container.textContent).toContain("Total return");
  expect(container.textContent).toContain("Since first purchase:");
  expect(container.textContent).toContain("since 2026-01-02");
  expect(container.textContent).toContain("Activity");
  const quantity = Array.from(container.querySelectorAll("button")).find((button) =>
    button.textContent?.includes("quantity history"),
  );
  expect(quantity?.getAttribute("aria-expanded")).toBe("false");
  await act(async () => {
    quantity?.click();
  });
  expect(quantity?.getAttribute("aria-expanded")).toBe("true");
  expect(container.textContent).toContain("2 January 2026 · Buy");
  expect(container.querySelector('a[href="/positions?sort=return&direction=asc"]')).not.toBeNull();
  root.unmount();
});

test("position detail reports an estimated price and an unavailable value", async () => {
  async function detailText(position: InvestingDashboardData["position"]) {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
        String(input).startsWith("/api/investing/dashboard")
          ? Promise.resolve(new Response(JSON.stringify({ ...dashboard, position })))
          : Promise.resolve(responseFor(input, init)),
      ),
    );
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/positions/ASML"]}>
          <App />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    const text = container.textContent ?? "";
    root.unmount();
    return text;
  }

  expect(
    await detailText({
      ...dashboard.position!,
      priceStatus: "forward-filled",
      quoteDate: "2026-01-28",
    }),
  ).toContain("Estimated price of 2026-01-28");

  const stale = await detailText({
    ...dashboard.position!,
    currentValue: null,
    currentPrice: null,
    dailyChange: null,
    dailyChangePercentage: null,
    priceStatus: "unpriced",
    quoteDate: "2026-01-05",
  });
  expect(stale).toContain("Value unknown");
  expect(stale).toContain("Price history");
});

test("closed position omits current value and keeps realized history", async () => {
  const closed: InvestingDashboardData = {
    ...dashboard,
    position: {
      ...dashboard.position!,
      symbol: "CLOSED",
      description: "Closed Co",
      status: "closed",
      quantity: 0,
      currentValue: null,
      dailyChange: null,
      dailyChangePercentage: null,
      currentPrice: null,
      averageCost: null,
      returns: {
        ...dashboard.position!.returns,
        remainingCostBasis: 0,
        unrealizedGain: 0,
        realizedGain: 30,
        dividendsReceived: 4,
        totalReturn: 34,
      },
      activity: [
        {
          date: "2026-04-02",
          kind: "sell",
          quantity: 1,
          executionPrice: 130,
          amount: 130,
          commission: 1,
          currency: "EUR",
          sourceOrder: 1,
        },
        {
          date: "2026-01-02",
          kind: "buy",
          quantity: 1,
          executionPrice: 100,
          amount: 100,
          commission: 0,
          currency: "EUR",
          sourceOrder: 0,
        },
      ],
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).startsWith("/api/investing/dashboard")
        ? Promise.resolve(new Response(JSON.stringify(closed)))
        : Promise.resolve(responseFor(input, init)),
    ),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/positions/CLOSED"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(container.textContent).toContain("Closed position");
  expect(container.textContent).toContain("0 shares · closed");
  expect(container.textContent).not.toContain("Current value");
  expect(
    Array.from(container.querySelectorAll('div[id^="activity-"]')).map((row) => row.id),
  ).toEqual(["activity-2026-04-02", "activity-2026-01-02"]);
  root.unmount();
});

test("position detail shows import prompt when return history is incomplete", async () => {
  const incomplete: InvestingDashboardData = {
    ...dashboard,
    position: {
      ...dashboard.position!,
      returnStatus: "missing-cost",
      returns: {
        ...dashboard.position!.returns,
        status: "missing-cost",
        remainingCostBasis: null,
        realizedCostBasisRemoved: null,
        unrealizedGain: null,
        realizedGain: null,
        dividendsReceived: null,
        totalReturn: null,
        totalReturnPercentage: null,
        sinceFirstBuyPercentage: null,
      },
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).startsWith("/api/investing/dashboard")
        ? Promise.resolve(new Response(JSON.stringify(incomplete)))
        : Promise.resolve(responseFor(input, init)),
    ),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/positions/ASML"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(container.textContent).toContain(
    "Import earlier transactions or connect your other brokers to calculate return.",
  );
  root.unmount();
});

test("dashboard shows loading state before read model arrives", async () => {
  let release!: (response: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    release = resolve;
  });
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).startsWith("/api/investing/dashboard")
        ? pending
        : Promise.resolve(responseFor(input, init)),
    ),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/positions"]}>
        <App />
      </MemoryRouter>,
    );
  });
  expect(container.textContent).toContain("Loading dashboard");

  release(new Response(JSON.stringify(emptyDashboard)));
  await act(async () => {
    await pending;
  });
  expect(container.textContent).toContain("No positions loaded");
  root.unmount();
});

test("dashboard shows read error when route fails", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      String(input).startsWith("/api/investing/dashboard")
        ? Promise.resolve(new Response("", { status: 503 }))
        : Promise.resolve(responseFor(input, init)),
    ),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/positions"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
  });
  expect(container.textContent).toContain("Dashboard unavailable");
  root.unmount();
});

test("requests and persists Yahoo consent before broker-triggered price sync", async () => {
  const requests: Array<{ url: string; method?: string }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, method: init?.method });
      if (url === "/api/auth/get-session")
        return new Response(JSON.stringify({ problems: ["Authentication is not configured"] }), {
          status: 503,
        });
      if (url.startsWith("/api/investing/dashboard"))
        return new Response(JSON.stringify(emptyDashboard));
      if (url === "/api/market-data/consent" && init?.method === "PUT")
        return new Response(JSON.stringify({ accepted: true }));
      if (url === "/api/market-data/consent")
        return new Response(JSON.stringify({ accepted: false }));
      if (url === "/api/brokers/sync") return new Response(JSON.stringify({ problems: [] }));
      return new Response(JSON.stringify({ problems: [] }));
    }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(container.textContent).toContain("Yahoo Finance consent");
  expect(requests).not.toContainEqual({ url: "/api/brokers/sync", method: "POST" });
  await act(async () => {
    Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Allow Yahoo Finance"))
      ?.click();
    await Promise.resolve();
  });
  expect(requests).toContainEqual({ url: "/api/market-data/consent", method: "PUT" });
  expect(requests).toContainEqual({ url: "/api/brokers/sync", method: "POST" });
  root.unmount();
});

test("overview reports independent price-sync progress", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/prices/sync/status")
        return new Response(
          JSON.stringify({
            status: "running",
            total: 4,
            completed: 2,
            remainingSymbols: ["CLOSED", "^STOXX50E"],
            currentSymbol: "CLOSED",
            waitUntil: null,
            updatedAt: "2026-08-21T10:00:00.000Z",
            message: null,
            problems: [],
          }),
        );
      return responseFor(input, init);
    }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(container.textContent).toContain("Price history");
  expect(container.textContent).toContain("2 of 4 loaded");
  expect(container.textContent).toContain("CLOSED is loading");
  root.unmount();
});

test("shows broker sync problems and asks before deleting cached prices", async () => {
  const requests: Array<{ url: string; method?: string }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/auth/get-session")
        return new Response(JSON.stringify({ problems: ["Authentication is not configured"] }), {
          status: 503,
        });
      requests.push({ url: String(input), method: init?.method });
      if (String(input) === "/api/market-data/consent")
        return new Response(JSON.stringify({ accepted: true }));
      if (String(input) === "/api/brokers/sync")
        return new Response(JSON.stringify({ problems: ["ibkr: niet beschikbaar"] }));
      if (String(input).startsWith("/api/investing/dashboard"))
        return new Response(JSON.stringify(emptyDashboard));
      return new Response(JSON.stringify({ ok: true, service: "investing-server" }));
    }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(container.textContent).toContain("Sync problems");
  await act(async () => {
    Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent?.includes("Clear price data"))
      ?.click();
    await Promise.resolve();
  });
  expect(container.textContent).toContain("This deletes all locally stored price data.");
  expect(requests.some((request) => request.method === "DELETE")).toBe(false);
  const deleteButton = Array.from(container.querySelectorAll("button")).find((button) =>
    button.textContent?.includes("delete everything"),
  );
  await act(async () => {
    deleteButton?.click();
    await Promise.resolve();
  });
  expect(
    requests.some((request) => request.method === "DELETE" && request.url === "/api/prices/cache"),
  ).toBe(true);
  root.unmount();
});

test("connect broker opens setup guide with IBKR instructions", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(responseFor(input, init)),
    ),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
  });
  const connectLink = container.querySelector<HTMLAnchorElement>('a[href="/brokers/connect"]');
  expect(connectLink).not.toBeNull();

  await act(async () => {
    connectLink?.click();
  });
  expect(container.textContent).toContain("Connect broker");
  expect(container.textContent).toContain("Interactive Brokers");
  expect(container.textContent).toContain("Flex Web Service");
  expect(container.textContent).toContain("Trading 212");
  expect(container.textContent).toContain("Flex-token");
  expect(container.textContent).toContain("Cash Report");
  expect(container.textContent).toContain("Statement of Funds");
  expect(container.querySelector('a[href="/"]')).not.toBeNull();
  root.unmount();
});

test("connect broker names an unreadable broker and offers reconnect", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/brokers/credentials/status")
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: "unlocked",
              passphrase: "unused",
              brokers: { ibkr: "readable", trading212: "unreadable" },
            }),
            { status: 200 },
          ),
        );
      return Promise.resolve(responseFor(input, init));
    }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/brokers/connect"]}>
        <App />
      </MemoryRouter>,
    );
  });
  expect(container.textContent).toContain("Trading 212 credentials cannot be read");
  expect(container.textContent).toContain("Save new credentials below to reconnect");
  root.unmount();
});

test("overview keeps portfolio visible and links to reconnect for unreadable broker", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith("/api/investing/dashboard"))
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ...dashboard,
              problems: [
                "Trading 212 credentials cannot be read. Reconnect broker to restore data.",
              ],
            }),
          ),
        );
      return Promise.resolve(responseFor(input, init));
    }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
  });
  expect(container.textContent).toContain("ASML");
  expect(container.textContent).toContain("Trading 212 credentials cannot be read");
  expect(
    Array.from(container.querySelectorAll('a[href="/brokers/connect"]')).some(
      (link) => link.textContent === "Reconnect broker",
    ),
  ).toBe(true);
  root.unmount();
});

test("broker setup starts forced sync and shows returned problems", async () => {
  const requests: Array<{ url: string; method?: string }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/auth/get-session")
        return new Response(JSON.stringify({ problems: ["Authentication is not configured"] }), {
          status: 503,
        });
      requests.push({ url: String(input), method: init?.method });
      if (String(input) === "/api/brokers/sync?force=true")
        return new Response(
          JSON.stringify({ outcomes: [], problems: ["IBKR: credentials are not configured"] }),
        );
      return new Response(JSON.stringify({ ok: true, service: "investing-server" }));
    }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/brokers/connect"]}>
        <App />
      </MemoryRouter>,
    );
  });
  const syncButton = Array.from(container.querySelectorAll("button")).find((button) =>
    button.textContent?.includes("Start sync"),
  );
  expect(syncButton).not.toBeUndefined();
  await act(async () => {
    syncButton?.click();
    await Promise.resolve();
  });
  expect(requests).toContainEqual({ url: "/api/brokers/sync?force=true", method: "POST" });
  expect(container.textContent).not.toContain("credentials are not configured");
  expect(container.textContent).toContain("Sync completed");
  root.unmount();
});

test("broker credential form stores IBKR credentials and starts sync", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/auth/get-session")
        return new Response(JSON.stringify({ problems: ["Authentication is not configured"] }), {
          status: 503,
        });
      requests.push({ url: String(input), init });
      if (String(input) === "/api/brokers/credentials") return new Response(null, { status: 204 });
      if (String(input) === "/api/brokers/sync?force=true")
        return new Response(JSON.stringify({ outcomes: [{ status: "synced" }], problems: [] }));
      return new Response(JSON.stringify({ ok: true, service: "investing-server" }));
    }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/brokers/connect"]}>
        <App />
      </MemoryRouter>,
    );
  });
  const fields = {
    token: container.querySelector<HTMLInputElement>('[name="token"]')!,
    queryId: container.querySelector<HTMLInputElement>('[name="queryId"]')!,
    passphrase: container.querySelector<HTMLInputElement>('[name="passphrase"]')!,
  };
  const setInput = (field: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  };
  setInput(fields.token, "flex-token");
  setInput(fields.queryId, "123456");
  setInput(fields.passphrase, "vault-passphrase");
  await act(async () => {
    container.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
    await Promise.resolve();
  });

  const credentialRequest = requests.find((request) => request.url === "/api/brokers/credentials");
  expect(credentialRequest?.init?.body).toBe(
    JSON.stringify({
      broker: "ibkr",
      token: "flex-token",
      queryId: "123456",
      passphrase: "vault-passphrase",
    }),
  );
  expect(requests.some((request) => request.url === "/api/brokers/sync?force=true")).toBe(true);
  expect(container.textContent).toContain("Sync completed");
  expect(container.textContent).not.toContain("flex-token");
  root.unmount();
});

test("locked broker vault can be unlocked without entering broker credentials again", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/auth/get-session")
        return new Response(JSON.stringify({ problems: ["Authentication is not configured"] }), {
          status: 503,
        });
      requests.push({ url: String(input), init });
      if (String(input) === "/api/brokers/credentials/status")
        return new Response(JSON.stringify({ status: "locked" }));
      if (String(input) === "/api/brokers/credentials/unlock")
        return new Response(null, { status: 204 });
      if (String(input) === "/api/brokers/sync?force=true")
        return new Response(JSON.stringify({ outcomes: [{ status: "synced" }], problems: [] }));
      return new Response(JSON.stringify({ ok: true, service: "investing-server" }));
    }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/brokers/connect"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  const passphrase = container.querySelector<HTMLInputElement>('[name="unlockPassphrase"]')!;
  expect(passphrase).not.toBeNull();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  await act(async () => {
    setter?.call(passphrase, "vault-passphrase");
    passphrase.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    container.querySelector<HTMLButtonElement>('[data-action="unlock-vault"]')?.click();
    await Promise.resolve();
  });

  const unlockRequest = requests.find(
    (request) => request.url === "/api/brokers/credentials/unlock",
  );
  expect(unlockRequest?.init?.body).toBe(JSON.stringify({ passphrase: "vault-passphrase" }));
  expect(requests.some((request) => request.url === "/api/brokers/sync?force=true")).toBe(true);
  expect(container.textContent).toContain("Vault unlocked");
  expect(container.textContent).not.toContain("vault-passphrase");
  await act(async () => {
    root.unmount();
  });
});

test("broker sync progress shows exact pages, orders, and provider wait", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/auth/get-session")
        return new Response(JSON.stringify({ problems: ["Authentication is not configured"] }), {
          status: 503,
        });
      if (String(input) === "/api/brokers/sync/status")
        return new Response(
          JSON.stringify({
            status: "waiting",
            pages: 6,
            ordersRead: 300,
            positionsRead: 0,
            waitUntil: "2026-08-19T14:00:00.000Z",
            remaining: 0,
            updatedAt: "2026-08-19T13:59:00.000Z",
            message: null,
          }),
        );
      if (String(input) === "/api/brokers/credentials/status")
        return new Response(JSON.stringify({ status: "unlocked" }));
      return new Response(JSON.stringify({ ok: true, service: "investing-server" }));
    }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/brokers/connect"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(container.textContent).toContain("Trading 212 syncing");
  expect(container.textContent).toContain("6 pages");
  expect(container.textContent).toContain("300 orders read");
  expect(container.textContent).toContain("0 positions");
  expect(container.textContent).toContain("Waiting for new API capacity");
  await act(async () => {
    root.unmount();
  });
});

test("broker credential form succeeds when the other broker is not configured", async () => {
  const requests: Array<{ url: string }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input) === "/api/auth/get-session")
        return new Response(JSON.stringify({ problems: ["Authentication is not configured"] }), {
          status: 503,
        });
      requests.push({ url: String(input) });
      if (String(input) === "/api/brokers/credentials") return new Response(null, { status: 204 });
      if (String(input) === "/api/brokers/sync?force=true") {
        return new Response(
          JSON.stringify({
            outcomes: [
              { broker: "ibkr", status: "synced" },
              { broker: "trading212", status: "problem" },
            ],
            problems: ["trading212: credentials are not configured"],
          }),
        );
      }
      return new Response(JSON.stringify({ ok: true, service: "investing-server" }));
    }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/brokers/connect"]}>
        <App />
      </MemoryRouter>,
    );
  });
  const fields = {
    token: container.querySelector<HTMLInputElement>('[name="token"]')!,
    queryId: container.querySelector<HTMLInputElement>('[name="queryId"]')!,
    passphrase: container.querySelector<HTMLInputElement>('[name="passphrase"]')!,
  };
  const setInput = (field: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  };
  setInput(fields.token, "flex-token");
  setInput(fields.queryId, "123456");
  setInput(fields.passphrase, "vault-passphrase");
  await act(async () => {
    container.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
    await Promise.resolve();
  });

  expect(requests.some((request) => request.url === "/api/brokers/sync?force=true")).toBe(true);
  expect(container.textContent).toContain("Sync completed");
  expect(container.textContent).not.toContain("credentials are not configured");
  root.unmount();
});

test("the health line asks the investing server, not whoever owns the origin root", async () => {
  /* In the all-in-one deploy this app is served under /investing/, and neither
   * neighbouring path answers for the investing runtime: the origin's own
   * /health belongs to the personal server, and /investing/health is an SPA
   * view the CDN answers with this very page. Only /api/ reaches the runtime. */
  vi.stubEnv("BASE_URL", "/investing/");
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      calls.push(String(input));
      return Promise.resolve(
        new Response(JSON.stringify({ ok: true, service: "investing-server" })),
      );
    }),
  );
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

  expect(calls).toEqual(["/api/investing/health"]);
  expect(container.textContent).toContain("investing-server: beschikbaar");
  root.unmount();
  vi.unstubAllEnvs();
});

test("a broker sync that outlives the edge timeout reports background progress, not a parser error", async () => {
  /* Cloudflare cuts an origin request off at ~100s with an HTML 524 page. A
     Trading 212 first sync pages far past that, so the browser gets HTML where
     the form expected JSON and the raw parser error surfaced as the failure. */
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/auth/get-session")
        return new Response(JSON.stringify({ problems: ["Authentication is not configured"] }), {
          status: 503,
        });
      if (String(input) === "/api/brokers/credentials") return new Response(null, { status: 204 });
      if (String(input) === "/api/brokers/sync?force=true")
        return new Response("<!DOCTYPE html><html><title>524: A timeout occurred</title></html>", {
          status: 524,
          headers: { "content-type": "text/html" },
        });
      return new Response(JSON.stringify({ ok: true, service: "investing-server" }));
    }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/brokers/connect"]}>
        <App />
      </MemoryRouter>,
    );
  });
  const setInput = (field: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const brokerSelect = container.querySelector<HTMLSelectElement>('select[aria-label="Broker"]')!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    setter?.call(brokerSelect, "trading212");
    brokerSelect.dispatchEvent(new Event("change", { bubbles: true }));
  });
  setInput(container.querySelector<HTMLInputElement>('[name="token"]')!, "t212-key");
  setInput(container.querySelector<HTMLInputElement>('[name="secret"]')!, "t212-secret");
  setInput(container.querySelector<HTMLInputElement>('[name="passphrase"]')!, "vault-passphrase");
  await act(async () => {
    container.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
    await Promise.resolve();
  });

  expect(container.textContent).toContain("Sync continues in the background");
  expect(container.textContent).not.toMatch(/JSON|Unexpected token|did not match/i);
  root.unmount();
});

test("a server-key vault asks for no passphrase and does not claim the key is the user's", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/auth/get-session")
        return new Response(JSON.stringify({ problems: ["Authentication is not configured"] }), {
          status: 503,
        });
      requests.push({ url: String(input), init });
      if (String(input) === "/api/brokers/credentials/status")
        return new Response(JSON.stringify({ status: "empty", passphrase: "unused" }));
      if (String(input) === "/api/brokers/credentials") return new Response(null, { status: 204 });
      if (String(input) === "/api/brokers/sync?force=true")
        return new Response(JSON.stringify({ outcomes: [{ status: "synced" }], problems: [] }));
      return new Response(JSON.stringify({ ok: true, service: "investing-server" }));
    }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/brokers/connect"]}>
        <App />
      </MemoryRouter>,
    );
  });

  expect(container.querySelector('[name="passphrase"]')).toBeNull();
  expect(container.textContent).not.toContain("local vault");
  expect(container.textContent).not.toContain("LaVega kan het niet herstellen");

  const setInput = (field: HTMLInputElement, value: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  };
  setInput(container.querySelector<HTMLInputElement>('[name="token"]')!, "flex-token");
  setInput(container.querySelector<HTMLInputElement>('[name="queryId"]')!, "123456");
  await act(async () => {
    container.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
    await Promise.resolve();
  });

  const credentialRequest = requests.find((request) => request.url === "/api/brokers/credentials");
  expect(credentialRequest?.init?.body).toBe(
    JSON.stringify({ broker: "ibkr", token: "flex-token", queryId: "123456" }),
  );
  root.unmount();
});

test("overview analyses the persona the reader selected", async () => {
  vi.spyOn(window, "open").mockReturnValue({} as Window);
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), init });
      return Promise.resolve(responseFor(input, init));
    }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  await act(async () => {
    Array.from(container.querySelectorAll<HTMLButtonElement>('[role="radio"]'))
      .find((button) => button.textContent === "Bill Ackman")
      ?.click();
  });

  const agentCard = container.querySelector<HTMLElement>('[data-dashboard-section="agent"]')!;
  expect(agentCard.textContent).toContain("Concentrated brands and catalysts.");
  expect(agentCard.textContent).toContain("Open conversation with Bill Ackman");

  await act(async () => {
    Array.from(agentCard.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Analyse portfolio")
      ?.click();
    await Promise.resolve();
  });

  const runRequest = requests.find((request) => request.url === "/api/agents/portfolio/run");
  expect(runRequest?.init?.body).toBe(JSON.stringify({ agentId: "bill_ackman" }));
  root.unmount();
});

test("agent choice exposes radio semantics and moves with arrow keys", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve(responseFor(input, init)),
    ),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  const group = container.querySelector<HTMLElement>(
    '[role="radiogroup"][aria-label="Choose agent"]',
  )!;
  const radios = Array.from(group.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
  expect(radios).toHaveLength(3);
  expect(radios.map((radio) => radio.getAttribute("aria-checked"))).toEqual([
    "true",
    "false",
    "false",
  ]);
  expect(radios.map((radio) => radio.tabIndex)).toEqual([0, -1, -1]);

  await act(async () => {
    radios[0].dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }),
    );
  });

  const moved = Array.from(group.querySelectorAll<HTMLButtonElement>('[role="radio"]'));
  expect(moved.map((radio) => radio.getAttribute("aria-checked"))).toEqual([
    "false",
    "true",
    "false",
  ]);
  expect(document.activeElement).toBe(moved[1]);
  root.unmount();
});

test("agent catalog failure offers a retry instead of permanent loading", async () => {
  let catalogAttempts = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/agents/portfolio") {
        catalogAttempts += 1;
        if (catalogAttempts === 1) return Promise.resolve(new Response("nope", { status: 500 }));
      }
      return Promise.resolve(responseFor(input, init));
    }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  const agentCard = container.querySelector<HTMLElement>('[data-dashboard-section="agent"]')!;
  expect(agentCard.textContent).toContain("Failed to load agents.");
  expect(agentCard.textContent).not.toContain("Loading agents…");

  await act(async () => {
    Array.from(agentCard.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Try again")
      ?.click();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(
    container.querySelector<HTMLElement>('[data-dashboard-section="agent"]')!.textContent,
  ).toContain("Warren Buffett");
  root.unmount();
});

test("empty agent catalog resolves instead of loading forever", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/agents/portfolio")
        return Promise.resolve(new Response(JSON.stringify({ agents: [] })));
      return Promise.resolve(responseFor(input, init));
    }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  const agentCard = container.querySelector<HTMLElement>('[data-dashboard-section="agent"]')!;
  expect(agentCard.textContent).toContain("No portfolio agents available.");
  expect(agentCard.textContent).not.toContain("Loading agents…");
  expect(agentCard.textContent).not.toContain("Analyse portfolio");
  root.unmount();
});

test("agent route keeps a reply with the persona that asked for it", async () => {
  let releaseRun: ((value: Response) => void) | null = null;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/agents/portfolio/conversation" && init?.method === "POST")
        return new Promise<Response>((resolve) => {
          releaseRun = resolve;
        });
      return Promise.resolve(responseFor(input, init));
    }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  window.history.pushState({}, "", "/agents/bill_ackman");
  await act(async () => {
    root.render(
      <BrowserRouter>
        <App />
      </BrowserRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });

  const input = container.querySelector<HTMLInputElement>("#agent-message")!;
  const form = input.closest("form")!;
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, "Waarom is ASML mijn grootste risico?");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
  expect(container.textContent).toContain("Bill Ackman is reading positions…");

  await act(async () => {
    window.history.pushState({}, "", "/agents/warren_buffett");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await Promise.resolve();
  });
  expect(container.textContent).toContain("Warren Buffett");
  expect(container.textContent).not.toContain("is reading positions…");

  await act(async () => {
    releaseRun?.(new Response(JSON.stringify({ result: agentConversation })));
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(container.textContent).not.toContain(
    "ASML is concentrated but priced with clear conviction.",
  );
  expect(container.querySelector<HTMLInputElement>("#agent-message")?.disabled).toBe(false);

  await act(async () => {
    window.history.pushState({}, "", "/agents/bill_ackman");
    window.dispatchEvent(new PopStateEvent("popstate"));
    await Promise.resolve();
  });
  expect(container.textContent).toContain("ASML is concentrated but priced with clear conviction.");
  root.unmount();
  window.history.pushState({}, "", "/");
});

/* DE OVERSTEEK IS TWEERICHTINGSVERKEER. Zijn verzoek van 22 september: de
 * persoonlijke kant heeft een knop hierheen, hierheen had er geen terug. Je
 * kwam dus vanuit de kluis en moest via de browserknop of een getypte URL weer
 * weg — en op een eigen deploy is dat geen route maar een doodlopende weg.
 *
 * Een echte link en geen router-navigatie: de persoonlijke app is een aparte
 * deploy, dus dit moet een cross-document <a> zijn. Een <NavLink> hierheen zou
 * binnen deze SPA blijven zoeken en niets vinden. */
test("the header offers a way back to the personal app", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) => Promise.resolve(emptyResponseFor(input, init))),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
  });
  /* Tegen de resolver en niet tegen een vast pad: onder vitest staat `DEV` aan,
     dus `PERSONAL_URL` is daar de dev-poort en in productie `/app`. Een test die
     "/app" hardcodeert zou hier om de verkeerde reden falen. */
  expect(PERSONAL_URL).toBeTruthy();
  const back = container.querySelector(`a[href="${PERSONAL_URL}"]`) as HTMLAnchorElement | null;
  expect(back).not.toBeNull();
  expect(back!.textContent).toContain("Personal");
  root.unmount();
});

/* WELKE PERMISSIES DE SLEUTEL NODIG HEEFT, op de kaart die de opzet uitlegt.
 *
 * Er stond "choose read-only scope if Trading 212 shows that option", en dat is
 * niet te volgen: hun app toont elf losse vinkjes en geen read-only-knop. Drie
 * aanvinken die redelijk klinken raakt er precies één die wij gebruiken — en
 * een ontbrekende permissie faalt niet bij het opslaan maar pas bij de eerste
 * sync, als HTTP 403. De vijf hieronder zijn één per endpoint dat de adapter
 * echt aanroept. */
test("the Trading 212 card names the exact permissions the key needs", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) => Promise.resolve(emptyResponseFor(input, init))),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/brokers/connect"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
  });

  const text = container.textContent ?? "";
  for (const scope of [
    "Account data",
    "History – Dividends",
    "History – Orders",
    "History – Transactions",
    "Portfolio",
  ]) {
    expect(text, scope).toContain(scope);
  }
  // De read-only houding, op het scherm en niet alleen in een ontwerpdocument.
  expect(text).toContain("Orders – Execute");
  expect(text).toContain("Pies – Write");
  // En waar een vergeten vinkje zich later meldt.
  expect(text).toContain("403");
  // Het accounttype, want op een ander type werkt geen enkele sleutel.
  expect(text).toContain("Stocks ISA");

  root.unmount();
});

/* HET GEHEIM BESTAAT WEL, en dat is hier één ronde lang verkeerd gelezen.
 *
 * Trading 212's documentatie: "You must provide your API Key as the username
 * and your API Secret as the password, formatted as an HTTP Basic
 * Authentication header." Het veld stond terecht op verplicht; het is toen
 * optioneel gemaakt op een aanname, en een leeg geheim levert `base64("key:")`
 * op — dat kan nooit authenticeren. Deze test houdt beide helften verplicht. */
test("Trading 212 requires both halves of the key pair", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) => Promise.resolve(emptyResponseFor(input, init))),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/brokers/connect"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
  });
  const picker = container.querySelector('select[aria-label="Broker"]') as HTMLSelectElement;
  await act(async () => {
    picker.value = "trading212";
    picker.dispatchEvent(new Event("change", { bubbles: true }));
  });

  const secret = container.querySelector('input[name="secret"]') as HTMLInputElement | null;
  expect(secret).not.toBeNull();
  expect(secret!.required).toBe(true);
  const token = container.querySelector('input[name="token"]') as HTMLInputElement;
  expect(token.required).toBe(true);

  // En de kaart erboven zegt dat het er twee zijn, want daar liep dit op stuk.
  expect(container.textContent).toContain("both the API key and the API secret");
  expect(container.textContent).toContain("shown once");

  root.unmount();
});

/* EEN HALVE GESCHIEDENIS WORDT NIET ALS HEEL GETOOND.
 *
 * Zijn melding: het liep in de time-out en toonde ondertussen data halverwege.
 * Het pagineren en hervatten werkte al; wat ontbrak is dat het dashboard dat
 * niet wist en gewoon doorrekende op wat er toevallig lag. Rendement komt uit
 * `trades`, dus dat getal was niet onvolledig maar fout — mét decimalen. */
test("the overview withholds the figures while a first history is still loading", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/api/brokers/sync/status"))
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: "waiting",
              pages: 3,
              ordersRead: 412,
              positionsRead: 18,
              waitUntil: null,
              remaining: null,
              updatedAt: null,
              message: null,
              history: {
                trading212: {
                  lastSyncedAt: null,
                  ordersComplete: false,
                  transactionsComplete: false,
                  dividendsComplete: false,
                },
              },
            }),
            { headers: { "content-type": "application/json" } },
          ),
        );
      return Promise.resolve(responseFor(input, init));
    }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  const text = container.textContent ?? "";
  expect(text).toContain("Still loading your history");
  expect(text).toContain("Trading 212");
  // En nadrukkelijk NIET de cijfers die op die halve geschiedenis zouden rusten.
  expect(text).not.toContain("Portfolio value");
  expect(text).not.toContain("ASML");
  // Wel wat er tot nu toe binnen is, zodat zichtbaar blijft dat het loopt.
  expect(text).toContain("412");
  root.unmount();
});
