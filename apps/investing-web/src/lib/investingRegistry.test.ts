import { describe, expect, test } from "vitest";
import {
  HOME_MODULE,
  MODULES,
  WIDGETS,
  resolveModules,
  resolveWidgets,
  toggleModule,
  toggleWidget,
  investingModulePath,
} from "./investingRegistry.js";

describe("investing registry", () => {
  test("no widget id is also a module id", () => {
    const moduleIds = new Set(MODULES.map((m) => m.id));
    for (const widget of WIDGETS) expect(moduleIds.has(widget.id as never)).toBe(false);
  });

  test("overview is always present and first, regardless of stored data", () => {
    expect(resolveModules({})[0]).toBe(HOME_MODULE);
    expect(resolveModules({ positions: false, "net-worth": false, agents: false })).toEqual([
      "overview",
    ]);
  });

  test("an absent key falls back to the registry default (all modules on)", () => {
    expect(resolveModules({})).toEqual(["overview", "positions", "net-worth", "agents"]);
  });

  test("unknown stored module ids are dropped, not surfaced as a tab", () => {
    expect(resolveModules({ "old-module": true } as never)).toEqual([
      "overview",
      "positions",
      "net-worth",
      "agents",
    ]);
  });

  test("all widgets default on and follow registry order regardless of storage order", () => {
    expect(resolveWidgets({})).toEqual([
      "performance",
      "allocation",
      "kpis",
      "risk",
      "sectors",
      "agent",
    ]);
    expect(resolveWidgets({ agent: true, sectors: false, performance: true })).toEqual([
      "performance",
      "allocation",
      "kpis",
      "risk",
      "agent",
    ]);
  });

  test("unknown stored widget ids are dropped, never rendered as a card", () => {
    expect(resolveWidgets({ "old-widget": true } as never)).toEqual([
      "performance",
      "allocation",
      "kpis",
      "risk",
      "sectors",
      "agent",
    ]);
  });

  test("toggling overview off is a no-op", () => {
    expect(toggleModule({}, "overview" as never, false)).toEqual({});
  });

  test("toggling a module or widget off removes only that id", () => {
    expect(toggleModule({ positions: true }, "positions", false)).toEqual({ positions: false });
    expect(toggleWidget({ agent: true }, "agent", false)).toEqual({ agent: false });
  });

  test("every module resolves to a real path", () => {
    for (const id of ["overview", "positions", "net-worth", "agents"] as const) {
      expect(investingModulePath(id)).toMatch(/^\//);
    }
  });
});
