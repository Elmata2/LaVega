// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { PortfolioSummaryCard, type PortfolioSummary } from "./PortfolioSummaryCard";

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
    minimumObservations: 60,
    benchmark: null,
    benchmarks: [],
    reasons: [],
    missingHoldings: [],
    missingPrices: [],
    coverage: 1,
    currency: "EUR",
  },
  sectors: [
    { sector: "Technology", weight: 0.6 },
    { sector: "Unknown", weight: 0.4 },
  ],
  topPositions: [{ symbol: "AAPL", weight: 0.6 }],
};

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

test("renders metrics, top positions, and sector bars", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(summary), { status: 200 })),
  );
  const { container, root } = render();
  act(() => {
    root.render(<PortfolioSummaryCard />);
  });
  await act(async () => {});
  expect(container.textContent).toContain("Annual volatility");
  expect(container.textContent).toContain("AAPL");
  expect(container.textContent).toContain("Technology");
  expect(container.textContent).toContain("currency moves excluded");
  expect(container.textContent).toContain("excluding cash");
  expect(container.textContent).not.toContain("+60");
  expect(container.querySelectorAll('[aria-label="Sector allocation"] li')).toHaveLength(2);
});

test("shows incomplete-data reasons and requests a new risk period", async () => {
  const fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
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
        }),
        { status: 200 },
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  const { container, root } = render();
  act(() => root.render(<PortfolioSummaryCard />));
  await act(async () => {});
  expect(container.textContent).toContain("Cash history missing: trading212:USD.");
  expect(container.textContent).toContain("Unavailable");
  const select = container.querySelector('select[aria-label="Risk period"]') as HTMLSelectElement;
  await act(async () => {
    select.value = "6M";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(fetcher).toHaveBeenLastCalledWith("/api/investing/summary?range=6M");
});

test("renders error state when the API fails", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("boom", { status: 503 })),
  );
  const { container, root } = render();
  act(() => {
    root.render(<PortfolioSummaryCard />);
  });
  await act(async () => {});
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("503");
});

test("keeps controls during parent renders and refreshes only on request", async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify(summary), { status: 200 }));
  vi.stubGlobal("fetch", fetcher);
  const { container, root } = render();
  await act(async () => root.render(<PortfolioSummaryCard revision="BENCH" currency="EUR" />));
  await act(async () => root.render(<PortfolioSummaryCard revision="BENCH" currency="EUR" />));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(container.querySelector('select[aria-label="Risk period"]')).not.toBeNull();
  const refresh = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "Refresh risk",
  );
  await act(async () => refresh!.click());
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(container.querySelector('select[aria-label="Risk period"]')).not.toBeNull();
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

async function renderCard(stillLoading: boolean) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(loadingSummary), { status: 200 })),
  );
  const { container, root } = render();
  await act(async () => {
    root.render(<PortfolioSummaryCard stillLoading={stillLoading} />);
    await Promise.resolve();
    await Promise.resolve();
  });
  return { container, root };
}

test("a sync in flight reads as still loading, not as unavailable", async () => {
  const { container, root } = await renderCard(true);
  const text = container.textContent ?? "";
  expect(text).toContain("Still loading");
  expect(text).toContain("nothing here needs fixing");
  expect(text).not.toContain("Use Refresh risk after broker or price updates.");
  root.unmount();
});

/* En met alles binnen blijft "Unavailable" gewoon staan — een blok dat altijd
 * "nog even wachten" zegt is net zo nutteloos als een dat altijd afkeurt. */
test("with nothing syncing it still says unavailable, and what to do", async () => {
  const { container, root } = await renderCard(false);
  const text = container.textContent ?? "";
  expect(text).toContain("Unavailable");
  expect(text).toContain("Use Refresh risk after broker or price updates.");
  expect(text).not.toContain("Still loading");
  root.unmount();
});
