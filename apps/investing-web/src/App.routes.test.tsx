// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { App } from "./app";
import { forgetDashboards } from "./lib/dashboardResource";
import { forgetLayout } from "./lib/layoutResource";
import { emptyResponseFor, dashboard } from "./test/fetchFixtures";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

beforeEach(() => forgetLayout());
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  forgetDashboards();
  forgetLayout();
  document.body.innerHTML = "";
});

function Location() {
  const location = useLocation();
  return <output data-testid="path">{location.pathname}</output>;
}

test.each([
  ["/positions", "/positions/ASML"],
  ["/agents", "/agents/research"],
])("disabled %s module redirects detail route %s to Overview", async (modulePath, detailPath) => {
  const moduleId = modulePath.slice(1);
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/investing/layout")
        return Promise.resolve(
          new Response(JSON.stringify({ modules: { [moduleId]: false }, widgets: {} })),
        );
      return Promise.resolve(emptyResponseFor(input, init));
    }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[detailPath]}>
        <Location />
        <App />
      </MemoryRouter>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  expect(container.querySelector('[data-testid="path"]')?.textContent).toBe("/");
  expect(
    container.querySelector(`nav[aria-label="Main navigation"] a[href="${modulePath}"]`),
  ).toBeNull();
  act(() => root.unmount());
});

function positionsDashboard(positions: typeof dashboard.positions) {
  return { ...dashboard, positions };
}

test("a DeGiro holding shows its product name without the ISIN, and a ticker stays unchanged", async () => {
  const degiro = {
    ...dashboard.positions[0]!,
    symbol: "XS00PF000003",
    entity: "DeGiro",
    description: "VOORBEELD GLOBAL EQUITY ETF",
    quantity: 3,
  };
  const ticker = {
    ...dashboard.positions[0]!,
    symbol: "AAPL",
    entity: "Trading 212",
    description: "Apple Inc.",
    quantity: 1,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith("/api/investing/dashboard"))
        return Promise.resolve(new Response(JSON.stringify(positionsDashboard([degiro, ticker]))));
      return Promise.resolve(emptyResponseFor(input, init));
    }),
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
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  const table = container.querySelector('[aria-label="Positions"]');
  const text = table?.textContent ?? "";
  expect(text).toContain("VOORBEELD GLOBAL EQUITY ETF");
  expect(text).not.toContain("XS00PF000003");
  expect(text).toContain("DeGiro · 3 shares");
  expect(text).toContain("Apple Inc.");
  expect(text).toContain("AAPL · Trading 212 · 1 shares");
  act(() => root.unmount());
});

test("Overview shows the DeGiro import age and links the stale problem to the import tab", async () => {
  const day = new Date(Date.now() - 31 * 86_400_000).toISOString().slice(0, 10);
  const stale = {
    ...dashboard,
    degiro: {
      importedAt: `${day}T09:00:00.000Z`,
      coversFrom: day,
      coversTo: day,
      positionsAsOf: day,
    },
    problems: ["DeGiro-gegevens zijn 31 dagen oud. Importeer een nieuw rekeningoverzicht."],
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith("/api/investing/dashboard"))
        return Promise.resolve(new Response(JSON.stringify(stale)));
      return Promise.resolve(emptyResponseFor(input, init));
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
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  const note = container.querySelector("[data-degiro-age]");
  expect(note?.textContent).toMatch(/\d+ days old/);
  expect(Number(note?.getAttribute("data-degiro-age"))).toBeGreaterThanOrEqual(31);
  expect(note?.textContent).toContain("quantities are not live");
  const link = [...container.querySelectorAll("a")].find(
    (candidate) => candidate.getAttribute("href") === "/profile#degiro-import",
  );
  expect(link?.textContent).toBe("Importeer een nieuw rekeningoverzicht");
  act(() => root.unmount());
});

test("positions table exposes real links inside rows and /profile has an accessible heading", async () => {
  const apple = {
    ...dashboard.positions[0]!,
    symbol: "AAPL",
    entity: "Trading 212",
    description: "Apple Inc.",
    quantity: 1,
  };
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).startsWith("/api/investing/dashboard"))
        return Promise.resolve(new Response(JSON.stringify(positionsDashboard([apple]))));
      return Promise.resolve(emptyResponseFor(input, init));
    }),
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
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  const row = container.querySelector('[role="row"] a[href="/positions/AAPL"]');
  expect(row).not.toBeNull();
  expect(row?.getAttribute("role")).toBeNull();
  expect(row?.textContent).toContain("Apple Inc.");
  expect(row?.textContent).toContain("AAPL");
  act(() => root.unmount());

  const profileRoot = createRoot(container);
  await act(async () => {
    profileRoot.render(
      <MemoryRouter initialEntries={["/profile"]}>
        <App />
      </MemoryRouter>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const headings = [...container.querySelectorAll("h2")].map((h) => h.textContent);
  expect(headings).toContain("Profile");
  act(() => profileRoot.unmount());
});
