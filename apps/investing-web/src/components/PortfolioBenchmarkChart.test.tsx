// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { PortfolioBenchmarkChart } from "./PortfolioBenchmarkChart";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.restoreAllMocks());

const points = [
  { date: "2026-01-01", positionsValue: 100, cashValue: null, value: 100, unpriced: [], forwardFilled: [], cashUnknown: [] },
  { date: "2026-01-02", positionsValue: 110, cashValue: null, value: 110, unpriced: [], forwardFilled: [], cashUnknown: [] },
];
const benchmarks = [
  { symbol: "^AEX", name: "AEX", exchange: "Amsterdam", currency: "EUR", points: [{ date: "2026-01-01", value: 900 }, { date: "2026-01-02", value: 909 }] },
  { symbol: "^GDAXI", name: "DAX", exchange: "Frankfurt", currency: "EUR", points: [{ date: "2026-01-01", value: 20_000 }, { date: "2026-01-02", value: 20_100 }] },
];

test("renders indexed mode, accessible legend, and reflows colors after removal", async () => {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => init?.method === "PUT"
    ? new Response(JSON.stringify({ tenantId: "local", symbols: ["^GDAXI"] }))
    : new Response(JSON.stringify({ tenantId: "local", symbols: ["^AEX", "^GDAXI"] })));
  vi.stubGlobal("fetch", fetchMock);
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => { root.render(<PortfolioBenchmarkChart data={{ "1M": points }} benchmarks={benchmarks} />); await Promise.resolve(); });
  expect(container.textContent).toContain("Geïndexeerd rendement");
  expect(container.querySelector('button[aria-pressed="true"]')).not.toBeNull();
  const daxDotBefore = Array.from(container.querySelectorAll("span")).find((node) => node.textContent?.includes("DAX"))?.querySelector<HTMLElement>("span")?.style.backgroundColor;
  await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="^AEX verwijderen"]')?.click(); await Promise.resolve(); });
  expect(fetchMock).toHaveBeenCalledWith("/api/investing/benchmarks", expect.objectContaining({ method: "PUT" }));
  const daxDotAfter = Array.from(container.querySelectorAll("span")).find((node) => node.textContent?.includes("DAX"))?.querySelector<HTMLElement>("span")?.style.backgroundColor;
  expect(daxDotAfter).not.toBe(daxDotBefore);
  root.unmount();
});
