// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App, HealthStatus } from "./app";
import { forgetDashboards } from "./lib/dashboardResource";
import { resetInvestingLayoutStoreForTests } from "./lib/layoutResource";
import { PERSONAL_URL } from "./lib/personal";
import { emptyInvestingDashboard, type InvestingDashboardData } from "@lavega/core";
import {
  agentConversation,
  agentInsight,
  dashboard,
  deferredLayoutFetch,
  emptyDashboard,
  emptyResponseFor,
  portfolioAgents,
  portfolioSummary,
  responseFor,
  withAuthUnconfigured,
} from "./test/fetchFixtures.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

beforeEach(() => resetInvestingLayoutStoreForTests());

afterEach(() => {
  vi.restoreAllMocks();
  globalThis.localStorage?.clear();
  forgetDashboards();
});
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
  expect(container.textContent).toContain("investing-server: available");
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

test("positions route shows its own eyebrow and heading, not the overview's", async () => {
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

  expect(container.querySelector("main p.text-primary")?.textContent).toBe("Positions");
  expect(container.querySelector("main h2.font-display")?.textContent).toBe("Positions");
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

test("overview renders widgets in registry order and excludes positions and net worth", async () => {
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
    await Promise.resolve();
    await Promise.resolve();
  });

  const order = Array.from(
    container.querySelectorAll<HTMLElement>("[data-dashboard-section]"),
  ).map((element) => element.dataset.dashboardSection);
  expect(order).toEqual(["status", "performance", "allocation", "kpis", "risk", "sectors", "agent"]);
  expect(container.querySelector('[data-dashboard-section="positions"]')).toBeNull();
  expect(container.querySelector('[data-dashboard-section="net-worth"]')).toBeNull();

  const riskCard = container.querySelector<HTMLElement>('[data-dashboard-section="risk"]')!;
  expect(riskCard.textContent).toContain("Historical account risk");
  expect(riskCard.textContent).toContain("Largest positions");
  expect(riskCard.textContent).not.toContain("Sector allocation");
  root.unmount();
});

test("hiding a widget closes its gap instead of leaving a blank card", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) =>
      Promise.resolve(
        withAuthUnconfigured(input, () =>
          String(input) === "/api/investing/layout"
            ? new Response(JSON.stringify({ modules: {}, widgets: { allocation: false } }))
            : responseFor(input, init),
        ),
      ),
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
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(container.querySelector('[data-dashboard-section="allocation"]')).toBeNull();
  const order = Array.from(
    container.querySelectorAll<HTMLElement>("[data-dashboard-section]"),
  ).map((element) => element.dataset.dashboardSection);
  expect(order).toEqual(["status", "performance", "kpis", "risk", "sectors", "agent"]);
  root.unmount();
});

test("switching off every widget shows one line and an Add widget button, not a blank page", async () => {
  const allOff = {
    modules: {},
    widgets: {
      performance: false,
      allocation: false,
      kpis: false,
      risk: false,
      sectors: false,
      agent: false,
    },
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) =>
      Promise.resolve(
        withAuthUnconfigured(input, () =>
          String(input) === "/api/investing/layout"
            ? new Response(JSON.stringify(allOff))
            : responseFor(input, init),
        ),
      ),
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
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(container.querySelector('[data-dashboard-section="status"]')).not.toBeNull();
  expect(container.querySelector('[data-dashboard-section="performance"]')).toBeNull();
  const addWidget = Array.from(container.querySelectorAll("button")).find((button) =>
    button.textContent?.includes("Add widget"),
  );
  expect(addWidget).toBeTruthy();
  root.unmount();
});

/* /api/investing/summary is the slowest call on the page (over 40s observed in
 * production), so the risk widget and the sectors widget must share one read
 * instead of each mounting their own `usePortfolioSummary`. */
test("risk and sectors widgets share exactly one GET to the summary endpoint", async () => {
  const summaryRequests: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) => {
      if (String(input).startsWith("/api/investing/summary")) summaryRequests.push(String(input));
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
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(summaryRequests).toHaveLength(1);
  expect(container.querySelector('[data-dashboard-section="risk"]')).not.toBeNull();
  expect(container.querySelector('[data-dashboard-section="sectors"]')).not.toBeNull();
  root.unmount();
});

test("hiding risk still renders sectors, from the same one request", async () => {
  const summaryRequests: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) => {
      if (String(input).startsWith("/api/investing/summary")) summaryRequests.push(String(input));
      return Promise.resolve(
        withAuthUnconfigured(input, () =>
          String(input) === "/api/investing/layout"
            ? new Response(JSON.stringify({ modules: {}, widgets: { risk: false } }))
            : responseFor(input, init),
        ),
      );
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
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(container.querySelector('[data-dashboard-section="risk"]')).toBeNull();
  expect(container.querySelector('[data-dashboard-section="sectors"]')).not.toBeNull();
  expect(summaryRequests).toHaveLength(1);
  root.unmount();
});

test("hiding both risk and sectors makes zero summary requests", async () => {
  const summaryRequests: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) => {
      if (String(input).startsWith("/api/investing/summary")) summaryRequests.push(String(input));
      return Promise.resolve(
        withAuthUnconfigured(input, () =>
          String(input) === "/api/investing/layout"
            ? new Response(JSON.stringify({ modules: {}, widgets: { risk: false, sectors: false } }))
            : responseFor(input, init),
        ),
      );
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
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(container.querySelector('[data-dashboard-section="risk"]')).toBeNull();
  expect(container.querySelector('[data-dashboard-section="sectors"]')).toBeNull();
  expect(summaryRequests).toHaveLength(0);
  root.unmount();
});

test("changing the risk range refetches once and both cards update", async () => {
  const summaryRequests: string[] = [];
  const summaryFor = (range: string) => ({
    ...portfolioSummary,
    sectors: [{ sector: range === "6M" ? "Energy" : "Technology", weight: 1 }],
    risk: { ...portfolioSummary.risk, range, to: range === "6M" ? "2026-03-10" : "2026-09-10" },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) => {
      const url = String(input);
      if (url.startsWith("/api/investing/summary")) {
        summaryRequests.push(url);
        const range = new URLSearchParams(url.split("?")[1] ?? "").get("range") ?? "1Y";
        return Promise.resolve(new Response(JSON.stringify(summaryFor(range))));
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
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(summaryRequests).toHaveLength(1);
  const sectorsCard = container.querySelector<HTMLElement>('[data-dashboard-section="sectors"]')!;
  const riskCard = container.querySelector<HTMLElement>('[data-dashboard-section="risk"]')!;
  expect(sectorsCard.textContent).toContain("Technology");

  const select = container.querySelector('select[aria-label="Risk period"]') as HTMLSelectElement;
  await act(async () => {
    select.value = "6M";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(summaryRequests).toHaveLength(2);
  expect(summaryRequests[1]).toContain("range=6M");
  expect(sectorsCard.textContent).toContain("Energy");
  expect(riskCard.textContent).toContain("2026-03-10");
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

test("overview shows when sync status cannot be read", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/brokers/sync/status") return new Response("", { status: 503 });
      if (url === "/api/prices/sync/status")
        return new Response(
          JSON.stringify({
            status: "idle",
            total: 0,
            completed: 0,
            remainingSymbols: [],
            currentSymbol: null,
            waitUntil: null,
            updatedAt: null,
            message: null,
            problems: [],
          }),
        );
      if (url === "/api/brokers/credentials/status")
        return new Response(JSON.stringify({ status: "unlocked" }));
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
  // The sync session is module state, so an earlier test's active run can make this Reconnecting.
  expect(container.textContent).toMatch(/Connection(Offline|Reconnecting)/);
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

  expect(container.textContent).toContain("Cash");
  expect(container.textContent).toContain("Value partly unknown");
  expect(container.textContent).toContain("MSFT");
  expect(container.textContent).toContain("ibkr:USD");
  expect(container.textContent).toContain("Estimated price: ASML");
  root.unmount();
});

test("position navigation moves from the positions list to detail and back", async () => {
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
  expect(container.textContent).toContain("investing-server: available");
  root.unmount();
  vi.unstubAllEnvs();
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

test("the shell has no max-width frame", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) => Promise.resolve(emptyResponseFor(input, init))),
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
  });
  expect(container.querySelector(".max-w-6xl")).toBeNull();
  root.unmount();
});

test("a disabled module's route redirects to Overview instead of rendering", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) =>
      Promise.resolve(
        withAuthUnconfigured(input, () =>
          String(input) === "/api/investing/layout"
            ? new Response(JSON.stringify({ modules: { agents: false }, widgets: {} }))
            : emptyResponseFor(input, init),
        ),
      ),
    ),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/agents"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(container.querySelector('nav[aria-label="Main navigation"] a[href="/agents"]')).toBeNull();
  expect(container.textContent).not.toContain("Agents unavailable");
  root.unmount();
});

test("a deep link to a disabled module's detail route also redirects home", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) =>
      Promise.resolve(
        withAuthUnconfigured(input, () =>
          String(input) === "/api/investing/layout"
            ? new Response(JSON.stringify({ modules: { positions: false }, widgets: {} }))
            : emptyResponseFor(input, init),
        ),
      ),
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
  expect(container.textContent).not.toContain("Position detail");
  root.unmount();
});

test("a user who switched off every module except Overview still gets a working shell", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) =>
      Promise.resolve(
        withAuthUnconfigured(input, () =>
          String(input) === "/api/investing/layout"
            ? new Response(
                JSON.stringify({
                  modules: { positions: false, "net-worth": false, agents: false },
                  widgets: {},
                }),
              )
            : responseFor(input, init),
        ),
      ),
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
  const tabs = Array.from(
    container.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Main navigation"] a'),
  );
  expect(tabs).toHaveLength(1);
  expect(tabs[0]?.textContent).toBe("Overview");
  expect(container.textContent).toContain("Portfolio value");
  root.unmount();
});

test("switching a module off on /profile removes its top-bar tab without a reload", async () => {
  let layoutGets = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/investing/layout" && init?.method !== "PUT") layoutGets += 1;
      return Promise.resolve(responseFor(input, init));
    }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/profile"]}>
        <App />
      </MemoryRouter>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const agentsTab = () =>
    container.querySelector('nav[aria-label="Main navigation"] a[href="/agents"]');
  expect(agentsTab()).not.toBeNull();

  await act(async () => {
    container.querySelector<HTMLButtonElement>('button[aria-label="Agents in the top bar"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(agentsTab()).toBeNull();
  expect(layoutGets).toBe(1);
  act(() => root.unmount());
});

test("Overview renders no widgets and starts no summary read until the layout says which widgets are on", async () => {
  const layout = deferredLayoutFetch();
  const summaryReads: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/investing/layout") return layout.fetch();
      if (url.startsWith("/api/investing/summary")) summaryReads.push(url);
      return Promise.resolve(responseFor(input, init));
    }),
  );
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/"]}>
        <App />
      </MemoryRouter>,
    );
    await settle();
  });
  expect(container.querySelector('[data-dashboard-section="status"]')).not.toBeNull();
  expect(container.querySelector('[data-dashboard-section]:not([data-dashboard-section="status"])')).toBeNull();
  expect(summaryReads).toEqual([]);

  await act(async () => {
    layout.resolve({ modules: {}, widgets: { sectors: false, risk: false } });
    await settle();
  });
  expect(container.querySelector('[data-dashboard-section="performance"]')).not.toBeNull();
  expect(summaryReads).toEqual([]);
  act(() => root.unmount());
});

test("/brokers/connect redirects to the profile page's brokers section", async () => {
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
    await Promise.resolve();
  });
  expect(container.textContent).toContain("Brokers");
  expect(container.querySelector("#brokers")).not.toBeNull();
  root.unmount();
});

test("layout GET failing does not blank the shell — it renders with defaults", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) =>
      Promise.resolve(
        withAuthUnconfigured(input, () =>
          String(input) === "/api/investing/layout"
            ? new Response("", { status: 500 })
            : responseFor(input, init),
        ),
      ),
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
  const tabs = Array.from(
    container.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Main navigation"] a'),
  );
  expect(tabs.map((a) => a.textContent)).toEqual(["Overview", "Positions", "Net worth", "Agents"]);
  expect(container.textContent).toContain("Portfolio value");
  root.unmount();
});

test("the top bar shows only Overview while the layout loads, then every module once it resolves", async () => {
  const layout = deferredLayoutFetch();
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) =>
      String(input) === "/api/investing/layout"
        ? layout.fetch()
        : Promise.resolve(emptyResponseFor(input, init)),
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
  const loadingTabs = Array.from(
    container.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Main navigation"] a'),
  );
  expect(loadingTabs.map((a) => a.textContent)).toEqual(["Overview"]);

  await act(async () => {
    layout.resolve({ modules: {}, widgets: {} });
    await Promise.resolve();
    await Promise.resolve();
  });
  const readyTabs = Array.from(
    container.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Main navigation"] a'),
  );
  expect(readyTabs.map((a) => a.textContent)).toEqual([
    "Overview",
    "Positions",
    "Net worth",
    "Agents",
  ]);
  root.unmount();
});

test("a deep link to a disabled module never renders its content or tab, before or after the layout resolves", async () => {
  const layout = deferredLayoutFetch();
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) =>
      String(input) === "/api/investing/layout"
        ? layout.fetch()
        : Promise.resolve(emptyResponseFor(input, init)),
    ),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/agents"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(container.querySelector('a[href="/agents/bill_ackman"]')).toBeNull();
  expect(container.textContent).not.toContain("Agents unavailable");
  expect(container.querySelector('nav[aria-label="Main navigation"] a[href="/agents"]')).toBeNull();

  await act(async () => {
    layout.resolve({ modules: { agents: false }, widgets: {} });
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(container.querySelector('a[href="/agents/bill_ackman"]')).toBeNull();
  expect(container.querySelector('nav[aria-label="Main navigation"] a[href="/agents"]')).toBeNull();
  expect(container.querySelector("h2")?.textContent).toBe("Overview");
  root.unmount();
});

test("a failed layout load still renders a deep-linked module route, with defaults instead of a blank redirect", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) =>
      Promise.resolve(
        withAuthUnconfigured(input, () =>
          String(input) === "/api/investing/layout"
            ? new Response("", { status: 500 })
            : responseFor(input, init),
        ),
      ),
    ),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/agents"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(container.querySelector('a[href="/agents/bill_ackman"]')).not.toBeNull();
  root.unmount();
});

test("/net-worth renders the net-worth chart", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) => Promise.resolve(responseFor(input, init))),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/net-worth"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(container.querySelector('[role="group"][aria-label="Choose net worth period"]')).not.toBeNull();
  root.unmount();
});

test("/agents lists every portfolio agent and links to its conversation", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input, init) => Promise.resolve(responseFor(input, init))),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={["/agents"]}>
        <App />
      </MemoryRouter>,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(container.textContent).toContain("Bill Ackman");
  expect(container.querySelector('a[href="/agents/bill_ackman"]')).not.toBeNull();
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
