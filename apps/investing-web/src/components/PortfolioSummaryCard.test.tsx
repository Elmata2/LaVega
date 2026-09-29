// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import type { PortfolioSummary, SummaryState } from "../lib/summaryResource";
import { PortfolioSummaryCard } from "./PortfolioSummaryCard";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const summary: PortfolioSummary = {
  metrics: {
    dailyVolatility: 0.01,
    annualizedVolatility: 0.1587,
    beta: 1.1,
    alpha: 0.02,
    maxDrawdown: -0.25,
    observationDays: 252,
    excludedIntervals: 0,
    pairedObservationDays: 252,
    startDate: "2025-09-10",
    endDate: "2026-09-10",
  },
  risk: {
    status: "estimate",
    range: "1Y",
    from: "2025-09-10",
    to: "2026-09-10",
    drawdownFrom: null,
    minimumObservations: 60,
    benchmark: null,
    benchmarks: [],
    reasons: [],
    missingHoldings: [],
    missingPrices: [],
    coverage: 1,
    currency: "EUR",
  },
  sectors: [{ sector: "Technology", weight: 0.6 }],
  topPositions: [{ symbol: "AAPL", weight: 0.6 }],
};

const readyState: SummaryState = { status: "ready", data: summary };

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function render() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  return { container, root };
}

function noop() {}

function card(overrides: Partial<React.ComponentProps<typeof PortfolioSummaryCard>> = {}) {
  return (
    <PortfolioSummaryCard
      state={readyState}
      refresh={noop}
      range="1Y"
      onRangeChange={noop}
      benchmark=""
      onBenchmarkChange={noop}
      {...overrides}
    />
  );
}

test("renders metrics and top positions, and excludes sector content", async () => {
  const { container, root } = render();
  act(() => root.render(card()));
  expect(container.textContent).toContain("Annual volatility");
  expect(container.textContent).toContain("AAPL");
  expect(container.textContent).toContain("currency moves excluded");
  expect(container.textContent).toContain("excluding cash");
  expect(container.textContent).not.toContain("+60");
  expect(container.textContent).not.toContain("Sector allocation");
  expect(container.textContent).not.toMatch(/underlying holdings are not included/i);
  expect(container.querySelector('[data-dashboard-section="risk"]')).not.toBeNull();
});

test("shows the drawdown's own start date when it differs from the risk range's start", () => {
  const { container, root } = render();
  act(() =>
    root.render(
      card({
        state: {
          status: "ready",
          data: { ...summary, risk: { ...summary.risk, drawdownFrom: "2026-05-05" } },
        },
      }),
    ),
  );
  expect(container.textContent).toContain("since 5 May 2026");
});

test("hides the drawdown start date when it matches the risk range's start or is absent", () => {
  const { container, root } = render();
  act(() =>
    root.render(
      card({
        state: {
          status: "ready",
          data: { ...summary, risk: { ...summary.risk, drawdownFrom: summary.risk.from } },
        },
      }),
    ),
  );
  expect(container.textContent).not.toContain("since");

  document.body.replaceChildren();
  const second = render();
  act(() => second.root.render(card()));
  expect(second.container.textContent).not.toContain("since");
});

test("shows a position's name above its ticker, and just the ticker when there is no name", () => {
  const { container, root } = render();
  act(() =>
    root.render(
      card({
        state: {
          status: "ready",
          data: {
            ...summary,
            topPositions: [
              { symbol: "AAPL", weight: 0.6, description: "Apple Inc." },
              { symbol: "MYST", weight: 0.4 },
            ],
          },
        },
      }),
    ),
  );
  const list = container.querySelector('[aria-label="Largest positions"]');
  const text = list?.textContent ?? "";
  expect(text).toContain("Apple Inc.");
  expect(text.indexOf("Apple Inc.")).toBeLessThan(text.indexOf("AAPL"));
  expect(text).toContain("MYST");
});

test("shows incomplete-data reasons and asks for a new risk period through onRangeChange", () => {
  const onRangeChange = vi.fn();
  const { container, root } = render();
  act(() =>
    root.render(
      card({
        onRangeChange,
        state: {
          status: "ready",
          data: {
            ...summary,
            metrics: {
              ...summary.metrics,
              annualizedVolatility: null,
              beta: null,
              alpha: null,
              maxDrawdown: null,
              observationDays: 0,
            },
            risk: {
              ...summary.risk,
              status: "unavailable",
              reasons: ["Cash history missing: trading212:USD."],
            },
          },
        },
      }),
    ),
  );
  expect(container.textContent).toContain("Cash history missing: trading212:USD.");
  expect(container.textContent).toContain("Unavailable");
  const select = container.querySelector('select[aria-label="Risk period"]') as HTMLSelectElement;
  act(() => {
    select.value = "6M";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(onRangeChange).toHaveBeenCalledWith("6M");
});

test("choosing a risk benchmark calls onBenchmarkChange", () => {
  const onBenchmarkChange = vi.fn();
  const { container, root } = render();
  act(() =>
    root.render(
      card({
        onBenchmarkChange,
        state: {
          status: "ready",
          data: {
            ...summary,
            risk: {
              ...summary.risk,
              benchmarks: [{ symbol: "URTH", name: "MSCI World", currency: "USD" }],
            },
          },
        },
      }),
    ),
  );
  const select = container.querySelector(
    'select[aria-label="Risk benchmark"]',
  ) as HTMLSelectElement;
  act(() => {
    select.value = "URTH";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(onBenchmarkChange).toHaveBeenCalledWith("URTH");
});

test("clicking Refresh risk calls refresh", () => {
  const refresh = vi.fn();
  const { container, root } = render();
  act(() => root.render(card({ refresh })));
  const button = Array.from(container.querySelectorAll("button")).find(
    (element) => element.textContent === "Refresh risk",
  );
  act(() => button!.click());
  expect(refresh).toHaveBeenCalledTimes(1);
});

test("renders a loading placeholder while the shared summary is in flight", () => {
  const { container, root } = render();
  act(() => root.render(card({ state: { status: "loading" } })));
  expect(
    container.querySelector('[data-dashboard-section="risk"]')?.getAttribute("aria-busy"),
  ).toBe("true");
});

test("renders the shared summary's error", () => {
  const { container, root } = render();
  act(() => root.render(card({ state: { status: "error", message: "503" } })));
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("503");
});

/* "UNAVAILABLE" TERWIJL DE DATA NOG BINNENKOMT LEEST ALS EEN OORDEEL.
 *
 * Zijn scherm: "Historical account risk · Unavailable", met daaronder zes
 * regels als "Prices missing for 113 instruments" en "At least 60 valid daily
 * returns are required" — terwijl de prijsgeschiedenis op dat moment gewoon nog
 * aan het downloaden was. Die 113 was geen tekortkoming maar een stand van een
 * minuut geleden.
 *
 * De risicomodule zelf doet het goed: volatiliteit rekenen over 113 ontbrekende
 * instrumenten zou een verzonnen getal opleveren, dus weigeren is juist. Wat
 * fout was, is dat het scherm "dit kan niet" zei waar "dit kan nog niet" gold —
 * het verschil tussen iets repareren en even wachten. */
const loadingSummary: PortfolioSummary = {
  ...summary,
  metrics: { ...summary.metrics, annualizedVolatility: null, beta: null, observationDays: 0 },
  risk: {
    ...summary.risk,
    status: "unavailable",
    reasons: ["Prices missing for 113 instruments."],
  },
};

test("a sync in flight reads as still loading, not as unavailable", () => {
  const { container, root } = render();
  act(() =>
    root.render(card({ stillLoading: true, state: { status: "ready", data: loadingSummary } })),
  );
  const text = container.textContent ?? "";
  expect(text).toContain("Still loading");
  expect(text).toContain("nothing here needs fixing");
  expect(text).not.toContain("Use Refresh risk after broker or price updates.");
});

/* En met alles binnen blijft "Unavailable" gewoon staan — een blok dat altijd
 * "nog even wachten" zegt is net zo nutteloos als een dat altijd afkeurt. */
test("with nothing syncing it still says unavailable, and what to do", () => {
  const { container, root } = render();
  act(() =>
    root.render(card({ stillLoading: false, state: { status: "ready", data: loadingSummary } })),
  );
  const text = container.textContent ?? "";
  expect(text).toContain("Unavailable");
  expect(text).toContain("Use Refresh risk after broker or price updates.");
  expect(text).not.toContain("Still loading");
});

test("a sync elsewhere does not contradict an already-populated risk estimate", async () => {
  const { container, root } = render();
  act(() => root.render(card({ stillLoading: true, state: { status: "ready", data: summary } })));
  const text = container.textContent ?? "";
  expect(text).not.toContain("still downloading");
  expect(text).not.toContain("nothing here needs fixing");
  expect(text).toContain("Use Refresh risk after broker or price updates.");
  expect(text).toContain("15.9%");
  expect(text).toContain("1.1");
  root.unmount();
});
