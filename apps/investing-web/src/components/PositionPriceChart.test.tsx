// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { PositionPriceChart } from "./PositionPriceChart";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

test("exposes position price history and marker details accessibly", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () => { root.render(<PositionPriceChart symbol="AAPL" currency="USD" points={[{ symbol: "AAPL", date: "2026-01-05", close: 100, currency: "USD", markers: [{ kind: "buy", eventDate: "2026-01-05", label: "Koop 2" }] }]} />); });
  expect(container.querySelector('[role="img"]')?.getAttribute("aria-label")).toContain("AAPL");
  expect(container.textContent).toContain("Koop");
  expect(container.textContent).toContain("Koop 2");
  root.unmount();
});

test("groups marker fields and supports marker keyboard activation", async () => {
  const activate = vi.fn();
  const points = [
    { symbol: "AAPL", date: "2026-01-05", close: 100, currency: "USD", markers: [] },
    { symbol: "AAPL", date: "2026-01-06", close: 102, currency: "USD", markers: [
      { kind: "buy" as const, eventDate: "2026-01-06", label: "Koop 2", quantity: 2, executionPrice: 101, amount: 202, commission: 1, currency: "USD" },
      { kind: "dividend" as const, eventDate: "2026-01-06", label: "Dividend 3 USD", amount: 3, dividendAmount: 3, currency: "USD" },
    ] },
  ];
  const container = document.createElement("div"); const root = createRoot(container);
  await act(async () => { root.render(<PositionPriceChart symbol="AAPL" currency="USD" points={points} onMarkerActivate={activate} />); });
  expect(container.textContent).toContain("Slotkoers");
  expect(container.textContent).toContain("2 stuks");
  expect(container.textContent).toContain("commissie");
  expect(container.textContent).toContain("Dividend");
  const marker = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Koop 2"));
  await act(async () => { marker?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); marker?.click(); });
  expect(activate).toHaveBeenCalledWith("2026-01-06");
  root.unmount();
});

test("moves exact-value crosshair with keyboard and clears zoom with Escape", async () => {
  const points = ["2026-01-05", "2026-02-10", "2026-03-20"].map((date, index) => ({ symbol: "AAPL", date, close: 100 + index, currency: "USD", markers: [] }));
  const container = document.createElement("div"); const root = createRoot(container);
  await act(async () => { root.render(<PositionPriceChart symbol="AAPL" currency="USD" points={points} />); });
  const chart = container.querySelector<HTMLElement>('[role="img"]')!;
  const all = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Alles");
  expect(Array.from(container.querySelectorAll("button")).some((button) => button.textContent === "Dit jaar")).toBe(true);
  await act(async () => { all?.click(); });
  await act(async () => { chart.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })); });
  expect(container.querySelector('[role="status"]')?.textContent).toContain("5 jan 2026");
  Object.defineProperty(chart, "clientWidth", { configurable: true, value: 400 });
  chart.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 320, width: 400, height: 320, toJSON: () => ({}) });
  await act(async () => { chart.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: 200, deltaY: -100 })); });
  expect(container.querySelector('button[aria-label="Zoom wissen"]')).not.toBeNull();
  await act(async () => { chart.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  expect(container.querySelector('button[aria-label="Zoom wissen"]')).toBeNull();
  expect(container.querySelectorAll('[aria-label="Exacte koerswaarden"] li').length).toBeGreaterThan(3);
  expect(container.querySelector('[aria-label="Exacte koerswaarden"]')?.textContent).toContain("koers onbekend");
  root.unmount();
});
