import { expect, test } from "vitest";
import { MIN_VAULT_PASSWORD, vaultPasswordProblem } from "./vaultPassword.js";

test("a password shorter than the minimum is refused, and the reason says why", () => {
  const problem = vaultPasswordProblem("kort");
  expect(problem).not.toBeNull();
  expect(problem).toContain(String(MIN_VAULT_PASSWORD));
});

test("one character under the minimum is still refused", () => {
  expect(vaultPasswordProblem("a".repeat(MIN_VAULT_PASSWORD - 1) + "B1")).not.toBeNull();
});

test("a long passphrase is accepted", () => {
  expect(vaultPasswordProblem("mijn kluis is van mij")).toBeNull();
});

test("length alone is not enough — one repeated character is refused", () => {
  expect(vaultPasswordProblem("a".repeat(20))).not.toBeNull();
});

test("an empty password is refused", () => {
  expect(vaultPasswordProblem("")).not.toBeNull();
});
