// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  RAIL_WIDTH,
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_KEY,
  clampWidth,
  defaultSidebar,
  forgetMemorySidebar,
  readSidebar,
  writeSidebar,
} from "./sidebar";

beforeEach(() => {
  forgetMemorySidebar();
  window.localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

test("clamps to 240 and 440", () => {
  expect(clampWidth(100, 1600)).toBe(240);
  expect(clampWidth(900, 1600)).toBe(440);
  expect(clampWidth(300, 1600)).toBe(300);
});

test("main keeps 480: cap is viewport - rail - 480", () => {
  expect(clampWidth(440, 900)).toBe(900 - RAIL_WIDTH - 480);
  expect(clampWidth(296, 900)).toBe(296);
  expect(clampWidth(440, 1031)).toBe(440);
});

test("the min wins when the viewport rule would go below it", () => {
  expect(clampWidth(300, 700)).toBe(240);
});

test("coerces a non-finite width to the default", () => {
  expect(clampWidth(Number.NaN, 1600)).toBe(SIDEBAR_DEFAULT_WIDTH);
});

test("first visit: open from 1280, closed at 1024-1279", () => {
  expect(defaultSidebar(1440)).toEqual({ open: true, width: 296 });
  expect(defaultSidebar(1280)).toEqual({ open: true, width: 296 });
  expect(defaultSidebar(1279)).toEqual({ open: false, width: 296 });
  expect(defaultSidebar(1024)).toEqual({ open: false, width: 296 });
});

test("reads a stored value and clamps its width", () => {
  window.localStorage.setItem(SIDEBAR_KEY, JSON.stringify({ open: false, width: 9999 }));
  expect(readSidebar(1600)).toEqual({ open: false, width: 440 });
  window.localStorage.setItem(SIDEBAR_KEY, JSON.stringify({ open: true, width: 10 }));
  expect(readSidebar(1600)).toEqual({ open: true, width: 240 });
});

test("a stored choice beats the 1024-1279 first-visit default", () => {
  window.localStorage.setItem(SIDEBAR_KEY, JSON.stringify({ open: true, width: 300 }));
  expect(readSidebar(1100)).toEqual({ open: true, width: 300 });
});

test.each([
  "not json",
  "null",
  "42",
  '"x"',
  "[]",
  "{}",
  '{"open":"yes","width":"wide"}',
  '{"open":1,"width":null}',
])("garbage storage %s falls back to defaults", (raw) => {
  window.localStorage.setItem(SIDEBAR_KEY, raw);
  expect(readSidebar(1440)).toEqual({ open: true, width: 296 });
  expect(readSidebar(1100)).toEqual({ open: false, width: 296 });
});

test("one bad field falls back alone", () => {
  window.localStorage.setItem(SIDEBAR_KEY, JSON.stringify({ open: false, width: "x" }));
  expect(readSidebar(1440)).toEqual({ open: false, width: 296 });
});

test("write persists the collapsed state and the width", () => {
  expect(writeSidebar({ open: false, width: 350 })).toBe(true);
  expect(JSON.parse(window.localStorage.getItem(SIDEBAR_KEY) ?? "")).toEqual({
    open: false,
    width: 350,
  });
  expect(readSidebar(1600)).toEqual({ open: false, width: 350 });
});

test("blocked storage: read gives defaults, write returns false, nothing throws", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(readSidebar(1440)).toEqual({ open: true, width: 296 });
  expect(writeSidebar({ open: false, width: 300 })).toBe(false);
});

test("blocked storage keeps the in-memory choice for later reads", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  writeSidebar({ open: false, width: 300 });
  expect(readSidebar(1440)).toEqual({ open: false, width: 300 });
});
