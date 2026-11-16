// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test } from "vitest";
import { useSidebar, type SidebarApi } from "./useSidebar";
import { forgetMemorySidebar } from "../lib/sidebar";

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
const setViewport = (w: number) =>
  Object.defineProperty(window, "innerWidth", { configurable: true, value: w });

beforeEach(() => {
  forgetMemorySidebar();
  window.localStorage.clear();
  setViewport(1100);
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  seen.api = null;
});

test("prefs is the stored choice, viewport follows resize", () => {
  window.localStorage.setItem("lavega.sidebar", '{"open":true,"width":440}');
  root = createRoot(document.createElement("div"));
  act(() => root!.render(<Probe />));
  expect(seen.api!.prefs).toEqual({ open: true, width: 440 });
  expect(seen.api!.viewport).toBe(1100);
  act(() => {
    setViewport(700);
    window.dispatchEvent(new Event("resize"));
  });
  expect(seen.api!.viewport).toBe(700);
  /* The shown width shrinks; the stored choice does not. */
  expect(seen.api!.prefs.width).toBe(440);
  expect(seen.api!.width).toBeLessThan(440);
});
