// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import { AllocationDonut } from "./AllocationDonut";
import type { Allocation } from "@lavega/core";

const allocation: Allocation = { buckets: [{ key: "AAPL", label: "Apple", value: 100, unpriced: false }], unpriced: [] };
const empty: Allocation = { buckets: [], unpriced: [] };

afterEach(() => document.body.replaceChildren());

function render(instrument: Allocation = allocation, entity: Allocation = allocation) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() => { root.render(<AllocationDonut instrument={instrument} entity={entity} />); });
  return { container, root };
}

test("renders accessible allocation and switches grouping", () => {
  const { container, root } = render(allocation, { buckets: [{ key: "Privé", label: "Privé", value: 100, unpriced: false }], unpriced: [] });
  expect(container.querySelector('[role="img"]')?.getAttribute("aria-label")).toContain("belegging");
  act(() => { (container.querySelector('button[aria-pressed="false"]') as HTMLButtonElement).click(); });
  expect(container.textContent).toContain("Privé");
  root.unmount();
});

test("renders explicit empty state", () => {
  const { container, root } = render(empty, empty);
  expect(container.textContent).toContain("Geen posities");
  root.unmount();
});
