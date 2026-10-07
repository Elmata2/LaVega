import { expect, test } from "vitest";
import { gateState } from "./vault-gate.js";

test("an opened or newly created vault goes straight to the app", () => {
  expect(gateState("opened")).toBe("ready");
  expect(gateState("created")).toBe("ready");
});

test("a password vault from before account keys asks once", () => {
  expect(gateState("password-vault")).toBe("password-vault");
});
