// @vitest-environment jsdom
import { afterEach, expect, test } from "vitest";
import {
  DEFAULT_WIDGETS,
  WIDGETS,
  enabledWidgets,
  getEnabledWidgets,
  resetWidgets,
  setEnabledWidgets,
} from "./moduleRegistry";

afterEach(() => localStorage.clear());

test("widgets are listed in page order and none is on by default", () => {
  expect(WIDGETS.map((w) => w.id)).toEqual([
    "aandacht",
    "positie",
    "recente-transacties",
    "betaalagenda",
    "btw-stand",
    "facturen-open",
    "top-uitgaven",
  ]);
  expect(WIDGETS.some((w) => w.defaultOn === true)).toBe(false);
  expect(DEFAULT_WIDGETS).toEqual([]);
  expect(enabledWidgets(null)).toEqual([]);
});

test("a stored choice from before is kept through on and seen", () => {
  expect(
    enabledWidgets({
      on: ["betaalagenda"],
      seen: ["aandacht", "room-card", "positie", "betaalagenda", "facturen-open", "btw-stand"],
    }),
  ).toEqual(["betaalagenda"]);
});

test("the bare legacy list keeps its answer and starts nothing else", () => {
  expect(enabledWidgets(["aandacht"])).toEqual(["aandacht"]);
});

test("the widgets added with Home start off for a stored choice", () => {
  expect(
    enabledWidgets({ on: ["aandacht"], seen: ["aandacht", "positie", "betaalagenda"] }),
  ).toEqual(["aandacht"]);
});

test("resetWidgets removes the stored choice and leaves everything off", () => {
  setEnabledWidgets(["aandacht", "betaalagenda"]);
  expect(localStorage.getItem("lavega.overviewWidgets")).not.toBeNull();
  resetWidgets();
  expect(localStorage.getItem("lavega.overviewWidgets")).toBeNull();
  expect(enabledWidgets(getEnabledWidgets())).toEqual([]);
});
