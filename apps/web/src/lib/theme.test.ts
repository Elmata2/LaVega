// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { applyTheme, readStoredTheme, storeTheme, THEME_KEY } from "./theme";
import { isAppPathname } from "../appRoutes";

const root = document.documentElement;
const initScript = readFileSync(resolve(process.cwd(), "public/theme-init.js"), "utf8");

beforeEach(() => {
  window.history.replaceState({}, "", "/app");
  window.localStorage.clear();
  delete root.dataset.theme;
  root.style.colorScheme = "";
});
afterEach(() => vi.restoreAllMocks());

test("the storage key is lavega.theme", () => {
  expect(THEME_KEY).toBe("lavega.theme");
});

test("reads mono and midnight", () => {
  window.localStorage.setItem(THEME_KEY, "mono");
  expect(readStoredTheme()).toBe("mono");
  window.localStorage.setItem(THEME_KEY, "midnight");
  expect(readStoredTheme()).toBe("midnight");
});

test("missing value is midnight", () => {
  expect(readStoredTheme()).toBe("midnight");
});

test.each(["light", "MONO", "", "dark", "null", "{}"])("invalid value %j is midnight", (v) => {
  window.localStorage.setItem(THEME_KEY, v);
  expect(readStoredTheme()).toBe("midnight");
});

test("blocked storage (getItem throws) is midnight", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(readStoredTheme()).toBe("midnight");
});

test("apply mono sets data-theme and a light colour scheme", () => {
  applyTheme("mono");
  expect(root.dataset.theme).toBe("mono");
  expect(root.style.colorScheme).toBe("light");
});

test("apply midnight removes data-theme and sets a dark colour scheme", () => {
  root.dataset.theme = "mono";
  applyTheme("midnight");
  expect(root.hasAttribute("data-theme")).toBe(false);
  expect(root.style.colorScheme).toBe("dark");
});

function runInit() {
  // Classic script: run it in the page scope like a <script> tag would.
  new Function(initScript)();
}

test("init script applies stored mono", () => {
  window.localStorage.setItem(THEME_KEY, "mono");
  runInit();
  expect(root.dataset.theme).toBe("mono");
  expect(root.style.colorScheme).toBe("light");
});

test.each([null, "light", "garbage"])("init script leaves midnight for %j", (v) => {
  if (v !== null) window.localStorage.setItem(THEME_KEY, v);
  root.dataset.theme = "mono";
  runInit();
  expect(root.hasAttribute("data-theme")).toBe(false);
  expect(root.style.colorScheme).toBe("dark");
});

test("init script survives blocked storage", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(runInit).not.toThrow();
  expect(root.hasAttribute("data-theme")).toBe(false);
});

test("init script and theme.ts use the same key", () => {
  expect(initScript).toContain(`"${THEME_KEY}"`);
});

test("index.html loads the init script synchronously before the module script", () => {
  const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
  const tag = html.indexOf('<script src="/theme-init.js"></script>');
  expect(tag).toBeGreaterThan(-1);
  expect(tag).toBeLessThan(html.indexOf('type="module"'));
  expect(tag).toBeLessThan(html.indexOf("</head>"));
});

test("storeTheme persists and reports success", () => {
  expect(storeTheme("mono")).toBe(true);
  expect(window.localStorage.getItem(THEME_KEY)).toBe("mono");
  expect(storeTheme("midnight")).toBe(true);
  expect(readStoredTheme()).toBe("midnight");
});

test("storeTheme swallows blocked storage and returns false", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  expect(storeTheme("mono")).toBe(false);
});

const PATHS = [
  "/",
  "/en",
  "/reset-password",
  "/app",
  "/app/",
  "/app/profiel",
  "/application",
  "/en/app",
];

test.each(PATHS)("init script applies mono only on app paths: %s", (path) => {
  window.history.replaceState({}, "", path);
  window.localStorage.setItem(THEME_KEY, "mono");
  runInit();
  const wantMono = isAppPathname(path);
  expect(root.dataset.theme).toBe(wantMono ? "mono" : undefined);
  expect(root.style.colorScheme).toBe(wantMono ? "light" : "dark");
});
