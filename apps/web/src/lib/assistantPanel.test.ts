// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  ASSISTANT_KEY,
  defaultAssistant,
  fitPanels,
  forgetMemoryAssistant,
  readAssistant,
  writeAssistant,
} from "./assistantPanel";

beforeEach(() => {
  forgetMemoryAssistant();
  window.localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());

const RAIL = 84;
const MAIN = 480;
const both = (viewport: number, s: number, a: number, lastOpened: "sidebar" | "assistant") =>
  fitPanels({
    viewport,
    sidebar: { open: true, width: s },
    assistant: { open: true, width: a },
    lastOpened,
  });

test("1440: both fit at their stored widths", () => {
  const fit = both(1440, 296, 380, "assistant");
  expect(fit).toEqual({
    sidebarOpen: true,
    sidebarWidth: 296,
    assistantOpen: true,
    assistantWidth: 380,
  });
  expect(1440 - RAIL - 296 - 380).toBe(680);
});

test("1280: wide panels shrink toward their minimums, main keeps 480", () => {
  const fit = both(1280, 440, 520, "assistant");
  expect(fit.sidebarOpen && fit.assistantOpen).toBe(true);
  expect(1280 - RAIL - fit.sidebarWidth - fit.assistantWidth).toBeGreaterThanOrEqual(MAIN);
  expect(fit.sidebarWidth).toBeGreaterThanOrEqual(240);
  expect(fit.assistantWidth).toBeGreaterThanOrEqual(320);
  expect(1280 - RAIL - fit.sidebarWidth - fit.assistantWidth).toBe(MAIN);
});

test("1100: only lastOpened is shown", () => {
  expect(both(1100, 296, 380, "assistant")).toMatchObject({
    sidebarOpen: false,
    assistantOpen: true,
  });
  expect(both(1100, 296, 380, "sidebar")).toMatchObject({
    sidebarOpen: true,
    assistantOpen: false,
  });
});

test("1124 exactly: both at minimum fit", () => {
  expect(both(1124, 296, 380, "sidebar")).toEqual({
    sidebarOpen: true,
    sidebarWidth: 240,
    assistantOpen: true,
    assistantWidth: 320,
  });
});

test("one open panel: the other width is irrelevant, main keeps 480", () => {
  const a = fitPanels({
    viewport: 1100,
    sidebar: { open: false, width: 440 },
    assistant: { open: true, width: 520 },
    lastOpened: "sidebar",
  });
  expect(a.assistantOpen).toBe(true);
  expect(a.sidebarOpen).toBe(false);
  expect(1100 - RAIL - a.assistantWidth).toBeGreaterThanOrEqual(MAIN);
  const s = fitPanels({
    viewport: 1100,
    sidebar: { open: true, width: 440 },
    assistant: { open: false, width: 520 },
    lastOpened: "assistant",
  });
  expect(s.sidebarOpen).toBe(true);
  expect(1100 - RAIL - s.sidebarWidth).toBeGreaterThanOrEqual(MAIN);
});

test("the fit rule never reports a stored closed panel as open", () => {
  const fit = fitPanels({
    viewport: 1600,
    sidebar: { open: false, width: 296 },
    assistant: { open: false, width: 380 },
    lastOpened: "assistant",
  });
  expect(fit.sidebarOpen).toBe(false);
  expect(fit.assistantOpen).toBe(false);
});

test("first visit: assistant open from 1440 only", () => {
  expect(defaultAssistant(1440).open).toBe(true);
  expect(defaultAssistant(1439).open).toBe(false);
  expect(defaultAssistant(1440).width).toBe(380);
});

test("readAssistant: stored value, garbage and a throwing storage", () => {
  window.localStorage.setItem(ASSISTANT_KEY, '{"open":false,"width":400}');
  expect(readAssistant(1600)).toEqual({ open: false, width: 400 });
  window.localStorage.setItem(ASSISTANT_KEY, '{"open":true,"width":9999}');
  expect(readAssistant(1600).width).toBe(520);
  window.localStorage.setItem(ASSISTANT_KEY, "not json");
  expect(readAssistant(1600)).toEqual(defaultAssistant(1600));
  window.localStorage.setItem(ASSISTANT_KEY, "[1]");
  expect(readAssistant(1600)).toEqual(defaultAssistant(1600));
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(readAssistant(1600)).toEqual(defaultAssistant(1600));
});

test("writeAssistant returns false and keeps the choice in memory when setItem throws", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  expect(writeAssistant({ open: false, width: 333 })).toBe(false);
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => null);
  expect(readAssistant(1600)).toEqual({ open: false, width: 333 });
});

test("writeAssistant persists under lavega.assistantPanel", () => {
  expect(writeAssistant({ open: true, width: 400 })).toBe(true);
  expect(JSON.parse(window.localStorage.getItem("lavega.assistantPanel")!)).toEqual({
    open: true,
    width: 400,
  });
});

test("1123: both stored open do not fit, only lastOpened shows", () => {
  expect(both(1123, 296, 380, "assistant")).toMatchObject({
    sidebarOpen: false,
    assistantOpen: true,
  });
  expect(both(1123, 296, 380, "sidebar")).toMatchObject({
    sidebarOpen: true,
    assistantOpen: false,
  });
});

test("1124 with wide stored widths: both open at their minimums", () => {
  expect(both(1124, 440, 520, "assistant")).toEqual({
    sidebarOpen: true,
    sidebarWidth: 240,
    assistantOpen: true,
    assistantWidth: 320,
  });
});
