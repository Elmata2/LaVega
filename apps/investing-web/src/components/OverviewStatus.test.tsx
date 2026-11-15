// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, test } from "vitest";
import {
  OverviewStatus,
  mergeStatusItems,
  summarizeStatus,
  type StatusItem,
} from "./OverviewStatus";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

afterEach(() => {
  document.body.replaceChildren();
});

const sync: StatusItem = { message: "Trading 212 sync paused.", severity: "problem" };
const reading: StatusItem = {
  message: "Trading 212 credentials cannot be read.",
  severity: "problem",
  action: { to: "/brokers/connect", label: "Reconnect broker" },
};
const price: StatusItem = { message: "2 holdings without price.", severity: "problem" };

function mount(items: StatusItem[]) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <MemoryRouter>
        <OverviewStatus items={items} />
      </MemoryRouter>,
    ),
  );
  return container;
}

test("summarizes the count and names the first problems", () => {
  expect(summarizeStatus([sync])).toBe("1 data problem: Trading 212 sync paused");
  expect(summarizeStatus([sync, price])).toBe(
    "2 data problems: Trading 212 sync paused, 2 holdings without price",
  );
  expect(summarizeStatus([sync, price, reading])).toBe(
    "3 data problems: Trading 212 sync paused, 2 holdings without price and 1 more",
  );
});

test("the same sentence from two sources is counted once", () => {
  expect(mergeStatusItems([sync, { ...sync }, price])).toHaveLength(2);
});

test("renders nothing when there is nothing to report", () => {
  expect(mount([]).querySelector('[role="alert"]')).toBeNull();
});

test("one live region carries the count, and Details reveals every message and action", () => {
  const container = mount([sync, reading, price]);
  const alerts = container.querySelectorAll('[role="alert"]');
  expect(alerts).toHaveLength(1);
  expect(alerts[0]!.textContent).toContain("3 data problems");
  const toggle = Array.from(container.querySelectorAll("button")).find(
    (button) => button.textContent === "Details",
  )!;
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  const panel = container.querySelector(`#${CSS.escape(toggle.getAttribute("aria-controls")!)}`)!;
  expect((panel as HTMLElement).hidden).toBe(true);
  act(() => toggle.click());
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect((panel as HTMLElement).hidden).toBe(false);
  for (const item of [sync, reading, price]) expect(panel.textContent).toContain(item.message);
  expect(panel.querySelector('a[href="/brokers/connect"]')?.textContent).toBe("Reconnect broker");
});

test("the first action is reachable without opening Details", () => {
  const container = mount([sync, reading]);
  expect(container.querySelector('a[href="/brokers/connect"]')).not.toBeNull();
});
