import { expect, test } from "vitest";
import { gateState } from "./vault-gate.js";

test("status null => loading, regardless of legacy data", () => {
  expect(gateState(null, false)).toBe("loading");
  expect(gateState(null, true)).toBe("loading");
});

test("status unlocked => ready, regardless of legacy data", () => {
  expect(gateState("unlocked", false)).toBe("ready");
  expect(gateState("unlocked", true)).toBe("ready");
});

test("status locked => unlock, regardless of legacy data", () => {
  expect(gateState("locked", false)).toBe("unlock");
  expect(gateState("locked", true)).toBe("unlock");
});

test("status empty with legacy data => migrate", () => {
  expect(gateState("empty", true)).toBe("migrate");
});

test("status empty without legacy data => setup", () => {
  expect(gateState("empty", false)).toBe("setup");
});
