// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { AllocationDonut } from "./AllocationDonut";
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
    ],
    unpriced: [],
  };
  const { container, root } = render(many, many);
  const labels = [...container.querySelectorAll("li > div .truncate")].map(
    (node) => node.textContent,
  );
  // Top 3 individually named, largest first, rest folded into one bucket.
  expect(labels).toEqual(["Bravo", "Echo", "Charlie", "Other (3)"]);
  expect(container.textContent).not.toContain("Alpha");
  act(() => {
    (container.querySelector("button.truncate") as HTMLButtonElement).click();
  });
  expect(container.textContent).toContain("Alpha");
  expect(container.textContent).toContain("Delta");
  expect(container.textContent).toContain("Foxtrot");
  root.unmount();
});
