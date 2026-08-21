// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, test } from "vitest";
import type { PortfolioValuePoint } from "@lavega/core";
import { NetWorthChart, netWorthPointsForWindow, toNetWorthChartPoint } from "./NetWorthChart";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => document.body.replaceChildren());

const points: PortfolioValuePoint[] = Array.from({ length: 10 }, (_, index) => ({
  date: `2026-01-${String(index + 1).padStart(2, "0")}`,
  positionsValue: index === 6 ? null : 100 + index * 10,
  cashValue: index === 7 ? null : 20,
  value: index === 6 ? 20 : index === 7 ? 170 : 120 + index * 10,
  unpriced: index === 6 ? ["OLD"] : [],
  forwardFilled: index === 4 ? ["ASML"] : [],
  cashUnknown: index === 7 ? ["ibkr:USD"] : [],
}));

function changeInput(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function pointerEvent(type: string, clientX: number) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, button: 0 });
  Object.defineProperty(event, "pointerId", { value: 1 });
  return event;
}

test("keeps unknown legs null and textures only forward-filled positions", () => {
  expect(toNetWorthChartPoint(points[4]!)).toMatchObject({ stalePositions: 140, forwardFilled: ["ASML"] });
  expect(toNetWorthChartPoint(points[6]!)).toMatchObject({ positionsValue: null, value: 20, stalePositions: null, unpriced: ["OLD"] });
  expect(toNetWorthChartPoint(points[7]!)).toMatchObject({ cashValue: null, value: 170, cashUnknown: ["ibkr:USD"] });
});

test("uses independent typed range, keyboard crosshair, and zoom clearing", async () => {
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  await act(async () => { root.render(<NetWorthChart data={{ "1M": points, All: points }} currency="EUR" />); });
  expect(container.textContent).toContain("Nettovermogen");
  expect(container.textContent).toContain("Geschatte koers: ASML");
  expect(container.textContent).toContain("Uitgesloten wegens verouderde koers: OLD");
  expect(container.textContent).toContain("Cashwaarde onbekend: ibkr:USD");

  const from = container.querySelector<HTMLInputElement>('input[aria-label="Nettovermogen van datum"]')!;
  const to = container.querySelector<HTMLInputElement>('input[aria-label="Nettovermogen tot datum"]')!;
  await act(async () => { changeInput(from, "2026-01-03"); changeInput(to, "2026-01-08"); });
  await act(async () => { container.querySelector<HTMLFormElement>('form[aria-label="Datumbereik nettovermogen kiezen"]')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
  expect(container.querySelector('button[aria-label="Zoom nettovermogen wissen"]')).not.toBeNull();

  const chart = container.querySelector<HTMLElement>('[role="img"]')!;
  await act(async () => { chart.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })); });
  expect(container.querySelector('[aria-live="polite"]')?.textContent).toContain("3 jan");
  await act(async () => { chart.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  expect(container.querySelector('button[aria-label="Zoom nettovermogen wissen"]')).toBeNull();
  await act(async () => root.unmount());
});

test("renders accessible exact values and explicit empty state", async () => {
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  await act(async () => { root.render(<NetWorthChart data={{ "1M": points, All: points }} />); });
  expect(container.querySelector('[role="img"]')?.getAttribute("aria-label")).toContain("Beleggingen");
  expect(container.querySelector('ul[aria-label="Exacte nettovermogenswaarden"]')?.textContent).toContain("Waarde onbekend");
  await act(async () => { root.render(<NetWorthChart data={{ "1M": [], All: [] }} />); });
  expect(container.textContent).toContain("Geen vermogenshistorie");
  await act(async () => root.unmount());
});

test("window helper does not alter source series", () => {
  expect(netWorthPointsForWindow({ All: points }, { kind: "custom", from: "2026-01-03", to: "2026-01-05", baseRange: "1M" }).map((point) => point.date)).toEqual(["2026-01-03", "2026-01-04", "2026-01-05"]);
  expect(points).toHaveLength(10);
});

test("supports chart-local wheel and drag zoom", async () => {
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  await act(async () => { root.render(<NetWorthChart data={{ "1M": points, All: points }} />); });
  const chart = container.querySelector<HTMLElement>('[role="img"]')!;
  Object.defineProperty(chart, "clientWidth", { configurable: true, value: 400 });
  chart.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 400, bottom: 320, width: 400, height: 320, toJSON: () => ({}) });
  const wheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, clientX: 200, deltaY: -100 });
  await act(async () => { chart.dispatchEvent(wheel); });
  expect(wheel.defaultPrevented).toBe(true);
  expect(container.querySelector('button[aria-label="Zoom nettovermogen wissen"]')).not.toBeNull();
  const wheelWindow = container.querySelector('button[aria-label="Zoom nettovermogen wissen"]')?.textContent;
  await act(async () => { chart.dispatchEvent(pointerEvent("pointerdown", 80)); });
  await act(async () => { chart.dispatchEvent(pointerEvent("pointermove", 300)); });
  await act(async () => { chart.dispatchEvent(pointerEvent("pointerup", 300)); });
  expect(container.querySelector('button[aria-label="Zoom nettovermogen wissen"]')?.textContent).not.toBe(wheelWindow);
  await act(async () => root.unmount());
});
