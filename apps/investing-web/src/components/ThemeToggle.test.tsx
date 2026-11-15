// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { THEME_KEY } from "../lib/theme";
import { ThemeToggle } from "./ThemeToggle";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const root = document.documentElement;
const initScript = readFileSync(resolve(process.cwd(), "public/theme-init.js"), "utf8");

beforeEach(() => {
  window.localStorage.clear();
  delete root.dataset.theme;
  root.style.colorScheme = "";
});
afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  act(() => createRoot(host).render(<ThemeToggle />));
  return host.querySelector("button")!;
}

test("toggling flips data-theme, colorScheme, aria-checked and storage", () => {
  root.dataset.theme = "dark";
  const button = mount();
  expect(button.getAttribute("aria-checked")).toBe("false");
  act(() => button.click());
  expect(root.dataset.theme).toBe("light");
  expect(root.style.colorScheme).toBe("light");
  expect(button.getAttribute("aria-checked")).toBe("true");
  expect(window.localStorage.getItem(THEME_KEY)).toBe("light");
  act(() => button.click());
  expect(root.dataset.theme).toBe("dark");
  expect(window.localStorage.getItem(THEME_KEY)).toBe("dark");
});

test("blocked storage still toggles in memory", () => {
  root.dataset.theme = "dark";
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  const button = mount();
  act(() => button.click());
  expect(root.dataset.theme).toBe("light");
  expect(button.getAttribute("aria-checked")).toBe("true");
});

test("init script applies the stored light theme, otherwise dark", () => {
  window.localStorage.setItem(THEME_KEY, "light");
  new Function(initScript)();
  expect(root.dataset.theme).toBe("light");
  expect(root.style.colorScheme).toBe("light");

  window.localStorage.setItem(THEME_KEY, "garbage");
  new Function(initScript)();
  expect(root.dataset.theme).toBe("dark");

  window.localStorage.clear();
  new Function(initScript)();
  expect(root.dataset.theme).toBe("dark");
});

test("init script falls back to dark when storage throws", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  new Function(initScript)();
  expect(root.dataset.theme).toBe("dark");
  expect(root.style.colorScheme).toBe("dark");
});
