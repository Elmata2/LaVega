// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { AllocationDonut, apportionPercentages } from "./AllocationDonut";
import type { Allocation } from "@lavega/core";

const allocation: Allocation = {
  buckets: [{ key: "AAPL", label: "Apple", value: 100, unpriced: false }],
  unpriced: [],
};
const empty: Allocation = { buckets: [], unpriced: [] };

afterEach(() => document.body.replaceChildren());

function render(instrument: Allocation = allocation, entity: Allocation = allocation) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => {
    root.render(<AllocationDonut instrument={instrument} entity={entity} />);
  });
  return { container, root };
}

test("renders accessible allocation and switches grouping", () => {
  const { container, root } = render(allocation, {
    buckets: [{ key: "Privé", label: "Privé", value: 100, unpriced: false }],
    unpriced: [],
  });
  expect(container.querySelector('[role="img"]')?.getAttribute("aria-label")).toContain("holding");
  act(() => {
    (container.querySelector('button[aria-pressed="false"]') as HTMLButtonElement).click();
  });
  expect(container.textContent).toContain("Privé");
  root.unmount();
});

test("renders explicit empty state", () => {
  const { container, root } = render(empty, empty);
  expect(container.textContent).toContain("No positions");
  root.unmount();
});

test("excludes unpriced holdings and names unknown symbols", () => {
  const incomplete: Allocation = {
    buckets: [
      { key: "AAPL", label: "Apple", value: 100, unpriced: false },
      { key: "OLD", label: "Old Holding", value: null, unpriced: true },
    ],
    unpriced: ["OLD"],
  };
  const { container, root } = render(incomplete, incomplete);
  expect(container.textContent).toContain("Value unknown: OLD");
  expect(container.textContent).toContain("Not included in the chart or percentage");
  expect(container.textContent).not.toContain("Old Holding");
  root.unmount();
});

test("caps named slices, sorts by value, and folds the rest into an expandable Overige bucket", () => {
  const many: Allocation = {
    buckets: [
      { key: "A", label: "Alpha", value: 10, unpriced: false },
      { key: "B", label: "Bravo", value: 400, unpriced: false },
      { key: "C", label: "Charlie", value: 30, unpriced: false },
      { key: "D", label: "Delta", value: 20, unpriced: false },
      { key: "E", label: "Echo", value: 40, unpriced: false },
      { key: "F", label: "Foxtrot", value: 5, unpriced: false },
      { key: "G", label: "Golf", value: 4, unpriced: false },
      { key: "H", label: "Hotel", value: 3, unpriced: false },
      { key: "I", label: "India", value: 2, unpriced: false },
      { key: "J", label: "Juliet", value: 1, unpriced: false },
      { key: "K", label: "Kilo", value: 0.5, unpriced: false },
      { key: "L", label: "Lima", value: 0.25, unpriced: false },
    ],
    unpriced: [],
  };
  const { container, root } = render(many, many);
  const labels = [...container.querySelectorAll("li > div .truncate")].map(
    (node) => node.textContent,
  );
  // Top 10 individually named, largest first, rest folded into one bucket.
  expect(labels).toEqual([
    "Bravo",
    "Echo",
    "Charlie",
    "Delta",
    "Alpha",
    "Foxtrot",
    "Golf",
    "Hotel",
    "India",
    "Juliet",
    "Other (2)",
  ]);
  expect(container.textContent).toContain("Alpha");
  act(() => {
    (container.querySelector("button.truncate") as HTMLButtonElement).click();
  });
  expect(container.textContent).toContain("Alpha");
  expect(container.textContent).toContain("Delta");
  expect(container.textContent).toContain("Foxtrot");
  expect(container.textContent).toContain("Kilo");
  expect(container.textContent).toContain("Lima");
  root.unmount();
});

test("renders largest-remainder percentages that sum to 100, not naive rounding's 101", () => {
  const holdings: Allocation = {
    buckets: [
      { key: "AAPL", label: "Apple", value: 43.73, unpriced: false },
      { key: "MSFT", label: "Microsoft", value: 31.68, unpriced: false },
      { key: "ASML", label: "ASML", value: 24.59, unpriced: false },
    ],
    unpriced: [],
  };
  const { container, root } = render(holdings, holdings);
  const percentages = [...container.querySelectorAll("li > div .tabular-nums")]
    .map((node) => node.textContent)
    .filter((text): text is string => !!text?.endsWith("%"));
  expect(percentages).toEqual(["44%", "32%", "24%"]);
  root.unmount();
});

test("apportionPercentages always sums to exactly 100 across random weight vectors, ties, zeros, and single-bucket cases", () => {
  let seed = 42;
  const nextRandom = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let trial = 0; trial < 500; trial += 1) {
    const size = 1 + Math.floor(nextRandom() * 8);
    const values = Array.from({ length: size }, () => Math.floor(nextRandom() * 50));
    const percentages = apportionPercentages(values);
    expect(percentages).toHaveLength(values.length);
    if (values.some((value) => value > 0)) {
      expect(percentages.reduce((sum, value) => sum + value, 0)).toBe(100);
    }
    for (const value of percentages) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
  }
  expect(apportionPercentages([1, 1, 1])).toEqual(
    expect.arrayContaining([expect.any(Number), expect.any(Number), expect.any(Number)]),
  );
  expect(apportionPercentages([1, 1, 1]).reduce((sum, value) => sum + value, 0)).toBe(100);
  expect(apportionPercentages([0, 0, 5]).reduce((sum, value) => sum + value, 0)).toBe(100);
  expect(apportionPercentages([7])).toEqual([100]);
  expect(apportionPercentages([0, 0, 0])).toEqual([0, 0, 0]);
});
