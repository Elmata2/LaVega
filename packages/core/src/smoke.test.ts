import { expect, test } from "vitest";
import { VERSION } from "./index.js";
test("core loads", () => {
  expect(VERSION).toBe("0.0.0");
});
