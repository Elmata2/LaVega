// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readHomeChart, writeHomeChart } from "./homeChart";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("homeChart", () => {
  it("defaults to position", () => {
    expect(readHomeChart()).toBe("position");
  });

  it("round-trips both values through lavega.homeChart", () => {
    writeHomeChart("cashflow");
    expect(localStorage.getItem("lavega.homeChart")).toBe("cashflow");
    expect(readHomeChart()).toBe("cashflow");
    writeHomeChart("position");
    expect(readHomeChart()).toBe("position");
  });

  it("treats a garbage value as position", () => {
    localStorage.setItem("lavega.homeChart", "donut");
    expect(readHomeChart()).toBe("position");
  });

  it("survives storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readHomeChart()).toBe("position");
    expect(() => writeHomeChart("cashflow")).not.toThrow();
  });
});
