import { expect, test } from "vitest";
import { createRateLimiter } from "./rateLimit.js";

test("allows up to max requests per key, then blocks the next", () => {
  let t = 0;
  const limit = createRateLimiter(2, 1000, () => t);
  expect(limit("extract")).toBe(true);
  expect(limit("extract")).toBe(true);
  expect(limit("extract")).toBe(false); // 3rd within the window is blocked
});

test("frees the budget once the window has fully passed", () => {
  let t = 0;
  const limit = createRateLimiter(2, 1000, () => t);
  expect(limit("extract")).toBe(true);
  expect(limit("extract")).toBe(true);
  expect(limit("extract")).toBe(false);
  t = 1000; // the two hits at t=0 now fall outside (t - ts < 1000 is false)
  expect(limit("extract")).toBe(true);
  expect(limit("extract")).toBe(true);
  expect(limit("extract")).toBe(false);
});

test("each key has an independent budget", () => {
  let t = 0;
  const limit = createRateLimiter(2, 1000, () => t);
  expect(limit("a")).toBe(true);
  expect(limit("a")).toBe(true);
  expect(limit("a")).toBe(false);
  // "b" is untouched by "a" exhausting its budget
  expect(limit("b")).toBe(true);
  expect(limit("b")).toBe(true);
  expect(limit("b")).toBe(false);
});
