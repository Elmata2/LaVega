// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { Allocation, InvestingDashboardData } from "@lavega/core";
import { afterEach, expect, test } from "vitest";
import { AllocationDonut } from "./AllocationDonut";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

afterEach(() => document.body.replaceChildren());

const allocation: Allocation = { buckets: [], unpriced: [] };
type Ladder = NonNullable<InvestingDashboardData["allocation"]["ladder"]>;

function ladder(): Ladder {
  const shared = {
    holdings: 1000,
    total: 1250,
    denominator: 1250,
    denominatorRule:
      "Weights use max(cash + holdings, holdings) as the denominator. Cash counts as part of the portfolio, and a negative or stale cash balance cannot shrink the invested part below the holdings themselves, so the weights sum to at most 100%.",
    unpriced: [],
  };
  return {
    instrument: {
      ...shared,
      cash: 250,
      weightsSum: 1,
      rows: [
        { key: "AAPL", label: "Apple", kind: "holding", value: 750, weight: 0.6, unpriced: false },
        { key: "ASML", label: "ASML", kind: "holding", value: 250, weight: 0.2, unpriced: false },
        { key: "cash", label: "Cash", kind: "cash", value: 250, weight: 0.2, unpriced: false },
      ],
    },
    entity: {
      ...shared,
      cash: 250,
      weightsSum: 1,
      rows: [
        {
          key: "personal",
          label: "personal",
          kind: "holding",
          value: 1000,
          weight: 0.8,
          unpriced: false,
        },
        { key: "cash", label: "Cash", kind: "cash", value: 250, weight: 0.2, unpriced: false },
      ],
    },
  };
}

test("renders the cash-aware ladder with the documented denominator rule", () => {
  const container = document.createElement("div");
  document.body.append(container);
  act(() =>
    createRoot(container).render(
      <AllocationDonut instrument={allocation} entity={allocation} ladder={ladder()} />,
    ),
  );

  const text = container.textContent ?? "";
  expect(text).toContain("Ladder");
  expect(text).toContain("Cash");
  expect(text).toContain("20.0%");
  expect(text).toContain("Weights 100.0%");
  expect(text).toContain("max(cash + holdings, holdings)");
  expect(container.querySelector('[data-dashboard-section="allocation-ladder"]')).not.toBeNull();
});

test("labels the unclassified bucket when a holding has no classification", () => {
  const view = ladder();
  view.instrument.rows = [
    { key: "AAPL", label: "Apple", kind: "holding", value: 600, weight: 0.6, unpriced: false },
    {
      key: "unclassified",
      label: "Unclassified",
      kind: "unclassified",
      value: 400,
      weight: 0.4,
      unpriced: false,
    },
  ];
  const container = document.createElement("div");
  document.body.append(container);
  act(() =>
    createRoot(container).render(
      <AllocationDonut instrument={allocation} entity={allocation} ladder={view} />,
    ),
  );

  const text = container.textContent ?? "";
  expect(text).toContain("Unclassified");
  expect(text).toContain("unclassified");
});

test("a dashboard payload without a ladder renders no ladder section", () => {
  const container = document.createElement("div");
  document.body.append(container);
  act(() =>
    createRoot(container).render(<AllocationDonut instrument={allocation} entity={allocation} />),
  );
  expect(container.querySelector('[data-dashboard-section="allocation-ladder"]')).toBeNull();
});
