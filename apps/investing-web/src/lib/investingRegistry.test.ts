import { describe, expect, test } from "vitest";
import { HOME_MODULE, resolveModules, resolveWidgets } from "./investingRegistry.js";

describe("investing registry", () => {
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

  test("every widget but Key figures defaults on, in registry order regardless of storage order", () => {
    expect(resolveWidgets({})).toEqual(["performance", "allocation", "risk", "sectors", "agent"]);
    expect(resolveWidgets({ agent: true, sectors: false, performance: true })).toEqual([
      "performance",
      "allocation",
      "risk",
      "agent",
    ]);
  });

  test("Key figures defaults off because the Overview header carries them, but a saved on still wins", () => {
    expect(resolveWidgets({})).not.toContain("kpis");
    expect(resolveWidgets({ kpis: true })).toContain("kpis");
    expect(resolveWidgets({ kpis: false })).not.toContain("kpis");
  });

  test("unknown stored widget ids are dropped, never rendered as a card", () => {
    expect(resolveWidgets({ "old-widget": true } as never)).toEqual([
      "performance",
      "allocation",
      "risk",
      "sectors",
      "agent",
    ]);
  });
});
