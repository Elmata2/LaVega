// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { emptyInvestingDashboard, type InvestingDashboardData } from "@lavega/core";
import { afterEach, expect, test } from "vitest";
import { PortfolioKpiRow } from "./PortfolioKpiRow";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

afterEach(() => {
  document.body.replaceChildren();
});

type Point = InvestingDashboardData["portfolio"]["All"][number];
const point = (date: string, value: number | null, extra: Partial<Point> = {}): Point => ({
  date,
  positionsValue: value,
  cashValue: 0,
  value,
  unpriced: [],
  forwardFilled: [],
  cashUnknown: [],
  ...extra,
});

function dashboard(points: Point[]): InvestingDashboardData {
  const base = emptyInvestingDashboard();
  return { ...base, presentationCurrency: "EUR", portfolio: { ...base.portfolio, All: points } };
}

function render(data: InvestingDashboardData) {
  const container = document.createElement("div");
  document.body.append(container);
  act(() => createRoot(container).render(<PortfolioKpiRow data={data} />));
  return container;
}

test("populated: value, signed colored change and return", () => {
  const container = render(dashboard([point("2026-11-09", 10_000), point("2026-11-10", 9_800)]));
  const text = container.textContent ?? "";
  expect(text).toContain("€9,800.00");
  expect(text).toContain("-€200.00");
  expect(text).toContain("-2%");
  expect(text).toContain("TWR since 9 Nov 2026, after deposits and withdrawals");
  const change = Array.from(container.querySelectorAll("dd")).find((dd) =>
    dd.textContent?.includes("-€200.00"),
  )!;
  expect(change.className).toContain("text-negative");
  expect(container.querySelector("dl")?.className).not.toContain("shadow");
});

test("unknown figures say Unknown with the reason, never zero", () => {
  const container = render(dashboard([]));
  const text = container.textContent ?? "";
  expect(text).toContain("Unknown");
  expect(text).toContain("Needs at least two days of valuation history");
  expect(text).not.toContain("€0.00");
  expect(text).not.toContain("0.00%");
});

test("a partly unknown value names how many holdings have no price, details one click away", () => {
  const container = render(
    dashboard([
      point("2026-11-09", 10_000),
      point("2026-11-10", 9_800, { unpriced: ["ABC", "DEF"] }),
    ]),
  );
  const text = container.textContent ?? "";
  expect(text).toContain("No usable price for 2 holdings");
  expect(container.querySelector("details")?.textContent).toContain("No usable price: ABC, DEF");
});
