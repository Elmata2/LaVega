import { expect, test } from "vitest";
import { createMcpRateLimiter } from "./rateLimit.js";

test("a token may spend its quota and is then refused", () => {
  const limiter = createMcpRateLimiter({ max: 2, windowMs: 60_000 });
  expect(limiter.consume("token-1", 1_000)).toBe(true);
  expect(limiter.consume("token-1", 2_000)).toBe(true);
  expect(limiter.consume("token-1", 3_000)).toBe(false);
});

test("the window resets, so a refused token is not locked out forever", () => {
  const limiter = createMcpRateLimiter({ max: 1, windowMs: 60_000 });
  expect(limiter.consume("token-1", 0)).toBe(true);
  expect(limiter.consume("token-1", 30_000)).toBe(false);
  expect(limiter.consume("token-1", 60_000)).toBe(true);
});

test("each token has its own bucket", () => {
  const limiter = createMcpRateLimiter({ max: 1, windowMs: 60_000 });
  expect(limiter.consume("token-1", 0)).toBe(true);
  expect(limiter.consume("token-2", 0)).toBe(true);
  expect(limiter.consume("token-1", 0)).toBe(false);
});
