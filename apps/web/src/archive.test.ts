// @vitest-environment jsdom
import { expect, test } from "vitest";
import {
  DEFAULT_MODULES,
  DEFAULT_WIDGETS,
  enabledModules,
  enabledWidgets,
  normaliseWidgets,
  navModules,
} from "./components/moduleRegistry";
import {
  ARCHIVED_VIEWS,
  ARCHIVED_WIDGETS,
  SHOW_INVOICE_FORWARDING,
  SHOW_SCOPE_SWITCH,
  initialScope,
  isArchivedView,
  isArchivedWidget,
} from "./archive";

test("switch on archives facturen, belasting, valuta", () => {
  expect(ARCHIVED_VIEWS).toEqual(["facturen", "belasting", "valuta"]);
  expect(isArchivedView("belasting")).toBe(true);
  expect(isArchivedView("forecast")).toBe(false);
});

test("switch on archives the three business widgets", () => {
  expect(ARCHIVED_WIDGETS).toEqual(["positie", "facturen-open", "btw-stand"]);
  expect(isArchivedWidget("btw-stand")).toBe(true);
  expect(isArchivedWidget("aandacht")).toBe(false);
});

test("switch on hides the scope switch and invoice forwarding", () => {
  expect(SHOW_SCOPE_SWITCH).toBe(false);
  expect(SHOW_INVOICE_FORWARDING).toBe(false);
});

test("stored prefs naming archived ids are ignored, not an error", () => {
  expect(enabledModules(["overview", "facturen", "belasting", "forecast"])).toEqual([
    "overview",
    "forecast",
  ]);
  expect(
    enabledWidgets({ on: ["btw-stand", "aandacht"], seen: ["btw-stand", "aandacht"] }),
  ).toEqual(["aandacht", "intake-invite", "room-card", "betaalagenda"]);
  expect(normaliseWidgets(["positie", "facturen-open", "btw-stand", "aandacht"])).toEqual([
    "aandacht",
  ]);
  expect(navModules(["overview", "valuta"] as never).map((m) => m.id)).toEqual(["overview"]);
});

test("default modules and widgets exclude archived ids", () => {
  expect(DEFAULT_MODULES.some(isArchivedView)).toBe(false);
  expect(DEFAULT_WIDGETS.some(isArchivedWidget)).toBe(false);
});

test("stored default business + switch hidden opens personal and leaves storage alone", () => {
  localStorage.setItem("lavega.defaultScope", "business");
  expect(initialScope()).toBe("personal");
  expect(localStorage.getItem("lavega.defaultScope")).toBe("business");
  // Flipping the switch on restores the stored default.
  expect(initialScope(true)).toBe("business");
  localStorage.clear();
});
