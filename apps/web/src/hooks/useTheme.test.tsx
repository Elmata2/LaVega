// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { forgetMemoryTheme, useTheme } from "./useTheme";
import type { Theme } from "../lib/theme";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const html = document.documentElement;
let root: Root | null = null;
let container: HTMLElement | null = null;
const seen = { current: "midnight" as Theme, set: (_t: Theme) => {} };
const probe = {
  get current() {
    return seen.current;
  },
};

function Probe() {
  const [theme, setTheme] = useTheme();
  useEffect(() => {
    seen.current = theme;
    seen.set = setTheme;
  });
  return null;
}

function mount() {
  container = document.createElement("div");
  root = createRoot(container);
  act(() => root!.render(<Probe />));
}

beforeEach(() => {
  forgetMemoryTheme();
  window.localStorage.clear();
  delete html.dataset.theme;
  html.style.colorScheme = "";
});
afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  container = null;
  vi.restoreAllMocks();
});

test("starts from the stored theme", () => {
  window.localStorage.setItem("lavega.theme", "mono");
  mount();
  expect(probe.current).toBe("mono");
});

test("setting persists and applies at once", () => {
  mount();
  act(() => seen.set("mono"));
  expect(probe.current).toBe("mono");
  expect(window.localStorage.getItem("lavega.theme")).toBe("mono");
  expect(html.dataset.theme).toBe("mono");
  act(() => seen.set("midnight"));
  expect(html.hasAttribute("data-theme")).toBe(false);
  expect(window.localStorage.getItem("lavega.theme")).toBe("midnight");
});

test("blocked storage still switches in memory, no throw", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  mount();
  expect(() => act(() => seen.set("mono"))).not.toThrow();
  expect(probe.current).toBe("mono");
  expect(html.dataset.theme).toBe("mono");
});

test("a later mount keeps the in-memory choice when storage is blocked", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  mount();
  act(() => seen.set("mono"));
  act(() => root!.unmount());
  mount();
  expect(probe.current).toBe("mono");
});

test("a storage event for lavega.theme from another tab updates state and attribute", () => {
  mount();
  window.localStorage.setItem("lavega.theme", "mono");
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key: "lavega.theme", newValue: "mono" }));
  });
  expect(probe.current).toBe("mono");
  expect(html.dataset.theme).toBe("mono");
  window.localStorage.setItem("lavega.theme", "midnight");
  act(() => {
    window.dispatchEvent(
      new StorageEvent("storage", { key: "lavega.theme", newValue: "midnight" }),
    );
  });
  expect(probe.current).toBe("midnight");
  expect(html.hasAttribute("data-theme")).toBe(false);
});

test("storage events for other keys are ignored; the listener is removed on unmount", () => {
  mount();
  window.localStorage.setItem("lavega.theme", "mono");
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key: "other", newValue: "x" }));
  });
  expect(probe.current).toBe("midnight");
  act(() => root!.unmount());
  root = null;
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key: "lavega.theme", newValue: "mono" }));
  });
  expect(html.hasAttribute("data-theme")).toBe(false);
});
