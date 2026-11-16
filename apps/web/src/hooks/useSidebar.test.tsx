// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useSidebar, type SidebarApi } from "./useSidebar";
import { RAIL_WIDTH, SIDEBAR_KEY, forgetMemorySidebar } from "../lib/sidebar";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const seen: { api: SidebarApi | null } = { api: null };

function Probe() {
  const api = useSidebar();
  useEffect(() => {
    seen.api = api;
  });
  return null;
}

function setViewport(w: number) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: w });
}

function mount() {
  root = createRoot(document.createElement("div"));
  act(() => root!.render(<Probe />));
}

const api = () => seen.api!;

beforeEach(() => {
  forgetMemorySidebar();
  window.localStorage.clear();
  setViewport(1440);
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  seen.api = null;
  vi.restoreAllMocks();
});

test("starts open at 296 on a wide first visit, closed at 1100", () => {
  mount();
  expect(api().open).toBe(true);
  expect(api().width).toBe(296);
  act(() => root!.unmount());
  forgetMemorySidebar();
  setViewport(1100);
  mount();
  expect(api().open).toBe(false);
});

test("toggle flips and persists the collapsed state", () => {
  mount();
  act(() => api().toggle());
  expect(api().open).toBe(false);
  expect(JSON.parse(window.localStorage.getItem(SIDEBAR_KEY) ?? "")).toEqual({
    open: false,
    width: 296,
  });
  act(() => root!.unmount());
  mount();
  expect(api().open).toBe(false);
});

test("setWidth clamps and persists; reset restores 296 and keeps open", () => {
  mount();
  act(() => api().setWidth(9999));
  expect(api().width).toBe(440);
  act(() => api().setWidth(10));
  expect(api().width).toBe(240);
  act(() => api().toggle());
  act(() => api().reset());
  expect(api().width).toBe(296);
  expect(api().open).toBe(false);
  expect(JSON.parse(window.localStorage.getItem(SIDEBAR_KEY) ?? "").width).toBe(296);
});

test("the shown width follows the viewport rule; the stored choice is not shrunk", () => {
  window.localStorage.setItem(SIDEBAR_KEY, JSON.stringify({ open: true, width: 440 }));
  setViewport(900);
  mount();
  expect(api().width).toBe(900 - RAIL_WIDTH - 480);
  act(() => {
    setViewport(1600);
    window.dispatchEvent(new Event("resize"));
  });
  expect(api().width).toBe(440);
});

test("blocked storage still works in memory, no throw", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  mount();
  expect(() => act(() => api().toggle())).not.toThrow();
  expect(api().open).toBe(false);
  act(() => root!.unmount());
  mount();
  expect(api().open).toBe(false);
});
