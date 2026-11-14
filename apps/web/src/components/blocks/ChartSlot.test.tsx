// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import ChartSlot from "./ChartSlot";
import { accounts, ASOF, forecast, scheduledFlows, txs } from "./fixtures";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;
beforeEach(() => {
  document.cookie = "lavega_locale=nl";
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  localStorage.clear();
  vi.restoreAllMocks();
  document.cookie = "lavega_locale=; Max-Age=0; Path=/";
});

function mount(span: 2 | 3 = 3) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root!.render(
      <ChartSlot
        span={span}
        saldo={{
          accounts,
          txs,
          scheduledFlows,
          asOf: ASOF,
          onNavigate: () => {},
          fxHistory: {},
          mode: "separate",
        }}
        cashflow={{ forecast, bufferCents: 500_000, onNavigate: () => {} }}
      />,
    ),
  );
}
const radios = () =>
  Array.from(container!.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
const radio = (name: string) =>
  radios().find((r) => r.closest("label")?.textContent?.trim() === name)!;
const heading = () => container!.querySelector("section")?.getAttribute("aria-label") ?? "";

test("opens on Totale positie, in a labelled radio group of two", () => {
  mount();
  const group = container!.querySelector('[role="radiogroup"]');
  expect(group?.getAttribute("aria-label")).toBe("Grafiek");
  expect(radios().map((r) => r.closest("label")?.textContent?.trim())).toEqual([
    "Totale positie",
    "Cashflow",
  ]);
  expect(radio("Totale positie").checked).toBe(true);
  expect(radio("Cashflow").checked).toBe(false);
  expect(heading()).toMatch(/^Totale positie/);
  expect(container!.textContent).toContain("Rekeningen →");
});

test("choosing Cashflow swaps the body and writes the preference", () => {
  mount();
  act(() => radio("Cashflow").click());
  expect(radio("Cashflow").checked).toBe(true);
  expect(heading()).toBe("Cashflow");
  expect(container!.textContent).toContain("Forecast →");
  expect(container!.textContent).not.toContain("Rekeningen →");
  expect(localStorage.getItem("lavega.homeChart")).toBe("cashflow");
  expect(container!.querySelectorAll("section")).toHaveLength(1);
});

test("a stored cashflow choice is honoured on mount", () => {
  localStorage.setItem("lavega.homeChart", "cashflow");
  mount();
  expect(radio("Cashflow").checked).toBe(true);
  expect(heading()).toBe("Cashflow");
});

test("a garbage stored value gives Totale positie", () => {
  localStorage.setItem("lavega.homeChart", "donut");
  mount();
  expect(radio("Totale positie").checked).toBe(true);
});

test("storage that throws still renders Totale positie and still switches", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  mount();
  expect(radio("Totale positie").checked).toBe(true);
  act(() => radio("Cashflow").click());
  expect(heading()).toBe("Cashflow");
});

test("the slot takes the span it is given", () => {
  mount(2);
  expect(container!.querySelector("section")?.className).toContain("span_2");
});

test("changing the choice keeps the radio group element and keyboard focus", () => {
  mount();
  const group = container!.querySelector('[role="radiogroup"]')!;
  const position = radio("Totale positie");
  const cashflow = radio("Cashflow");
  act(() => position.focus());
  expect(document.activeElement).toBe(position);

  // A mouse click on the other radio: the group and both inputs stay the same
  // nodes, so nothing the user was holding is thrown away.
  act(() => cashflow.click());
  expect(heading()).toBe("Cashflow");
  expect(container!.querySelector('[role="radiogroup"]')).toBe(group);
  expect(radio("Cashflow")).toBe(cashflow);
  expect(document.activeElement).toBe(position);

  // An arrow key: the browser moves focus to the next radio and clicks it.
  act(() => {
    position.focus();
    position.click();
  });
  expect(heading()).toMatch(/^Totale positie/);
  expect(document.activeElement).toBe(position);
  act(() => {
    cashflow.focus();
    cashflow.click();
  });
  expect(document.activeElement).toBe(cashflow);
  expect(cashflow.checked).toBe(true);
  expect(container!.querySelector('[role="radiogroup"]')).toBe(group);
});
