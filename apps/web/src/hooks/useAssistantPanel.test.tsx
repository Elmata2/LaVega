// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useAssistantPanel, type AssistantPanelApi } from "./useAssistantPanel";
import { ASSISTANT_KEY, forgetMemoryAssistant } from "../lib/assistantPanel";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
const seen: { api: AssistantPanelApi | null } = { api: null };

function Probe() {
  const api = useAssistantPanel();
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
  forgetMemoryAssistant();
  window.localStorage.clear();
  setViewport(1440);
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  seen.api = null;
  vi.restoreAllMocks();
});

test("first visit: open at 380 from 1440, closed below", () => {
  mount();
  expect(api().prefs).toEqual({ open: true, width: 380 });
  act(() => root!.unmount());
  forgetMemoryAssistant();
  setViewport(1300);
  mount();
  expect(api().prefs.open).toBe(false);
});

test("toggle and setWidth persist; setWidth clamps to 320..520; reset goes to 380", () => {
  mount();
  act(() => api().toggle());
  expect(JSON.parse(window.localStorage.getItem(ASSISTANT_KEY)!)).toEqual({
    open: false,
    width: 380,
  });
  act(() => api().setWidth(9999));
  expect(api().prefs.width).toBe(520);
  act(() => api().setWidth(10));
  expect(api().prefs.width).toBe(320);
  act(() => api().reset());
  expect(api().prefs).toEqual({ open: false, width: 380 });
});

test("blocked storage: the choice still holds in memory", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  mount();
  act(() => api().toggle());
  expect(api().prefs.open).toBe(false);
});
