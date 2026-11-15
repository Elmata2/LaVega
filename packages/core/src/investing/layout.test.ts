import { describe, expect, test } from "vitest";
import { INVESTING_MODULE_IDS, INVESTING_WIDGET_IDS, validateInvestingLayout } from "./layout.js";

describe("investing layout validation", () => {
  test("no widget id is also a module id", () => {
    const modules = new Set<string>(INVESTING_MODULE_IDS);
    for (const widgetId of INVESTING_WIDGET_IDS) expect(modules.has(widgetId)).toBe(false);
  });

  test("drops unknown ids and non-boolean values, keeps known booleans", () => {
    expect(
      validateInvestingLayout({
        modules: { positions: false, "unknown-module": true, "net-worth": "yes" },
        widgets: { performance: true, bogus: true },
      }),
    ).toEqual({ modules: { positions: false }, widgets: { performance: true } });
  });

  test("a malformed body normalizes to an empty layout instead of throwing", () => {
    expect(validateInvestingLayout(null)).toEqual({ modules: {}, widgets: {} });
    expect(validateInvestingLayout("not an object")).toEqual({ modules: {}, widgets: {} });
    expect(validateInvestingLayout({ modules: "nope", widgets: 3 })).toEqual({
      modules: {},
      widgets: {},
    });
  });

  test("a missing modules or widgets key normalizes to an empty map for that key", () => {
    expect(validateInvestingLayout({ widgets: { agent: false } })).toEqual({
      modules: {},
      widgets: { agent: false },
    });
  });
});
