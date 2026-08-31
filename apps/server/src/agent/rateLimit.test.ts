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

import { rateLimitKey } from "./rateLimit.js";

test("two users on the same route get separate buckets", () => {
  const a = rateLimitKey("chat", "user-a", undefined);
  const b = rateLimitKey("chat", "user-b", undefined);
  expect(a).not.toBe(b);
});

test("one user on two routes gets separate buckets", () => {
  expect(rateLimitKey("chat", "user-a", undefined)).not.toBe(rateLimitKey("extract", "user-a", undefined));
});

test("the same user on the same route reuses one bucket", () => {
  expect(rateLimitKey("chat", "user-a", undefined)).toBe(rateLimitKey("chat", "user-a", undefined));
});

test("without a session it falls back to the caller's address", () => {
  const a = rateLimitKey("chat", undefined, "1.1.1.1");
  const b = rateLimitKey("chat", undefined, "2.2.2.2");
  expect(a).not.toBe(b);
});

test("it trusts the RIGHTMOST forwarded-for entry, which the nearest proxy appends", () => {
  // A caller can prepend anything to X-Forwarded-For; only the entry the edge
  // adds last is not attacker-chosen. Keying on the leftmost would let one
  // client mint unlimited buckets by rotating a spoofed prefix.
  const spoofed = rateLimitKey("chat", undefined, "9.9.9.9, 203.0.113.7");
  const honest = rateLimitKey("chat", undefined, "203.0.113.7");
  expect(spoofed).toBe(honest);
});

test("a user id is preferred over the address, because it cannot be spoofed", () => {
  expect(rateLimitKey("chat", "user-a", "1.1.1.1")).toBe(rateLimitKey("chat", "user-a", "2.2.2.2"));
});
