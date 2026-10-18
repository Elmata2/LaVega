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

test("a key's entry is pruned once its window has fully passed", () => {
  let t = 0;
  const limit = createRateLimiter(2, 1000, () => t);
  limit("solo");
  expect(limit.size).toBe(1);
  t = 1000; // "solo"'s only hit is now outside the window
  limit("other"); // any call prunes stale entries, not just "solo"'s own
  expect(limit.size).toBe(1); // "solo" is gone; "other" is the only key left
});

test("the tracked-key Map is bounded, however many distinct keys arrive", () => {
  // Every spoofed X-Forwarded-For used to mint a key that lived for the
  // process lifetime, and the guard scanned them all on every call. A rotating
  // caller must now hit a hard ceiling instead.
  const limit = createRateLimiter(5, 60_000, () => 0, 100);
  for (let i = 0; i < 5_000; i++) limit(`ip-${i}`);
  expect(limit.size).toBeLessThanOrEqual(100);
});

test("eviction drops the least recently used bucket, not the freshest one", () => {
  const limit = createRateLimiter(5, 60_000, () => 0, 2);
  limit("hot");
  limit("warm");
  limit("hot"); // "hot" is now the most recently used
  limit("cold"); // overflow: evicts "warm", the least recently used
  expect(limit.size).toBe(2);
  // "hot" survived, so its own count carried over rather than resetting: three
  // more calls are still evaluated against the two already recorded.
  for (let i = 0; i < 3; i++) expect(limit("hot")).toBe(true);
  expect(limit("hot")).toBe(false);
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

import { clientIp, rateLimitKey } from "./rateLimit.js";

test("two users on the same route get separate buckets", () => {
  const a = rateLimitKey("chat", "user-a", undefined);
  const b = rateLimitKey("chat", "user-b", undefined);
  expect(a).not.toBe(b);
});

test("one user on two routes gets separate buckets", () => {
  expect(rateLimitKey("chat", "user-a", undefined)).not.toBe(
    rateLimitKey("extract", "user-a", undefined),
  );
});

test("the same user on the same route reuses one bucket", () => {
  expect(rateLimitKey("chat", "user-a", undefined)).toBe(rateLimitKey("chat", "user-a", undefined));
});

test("without a session it falls back to the caller's address", () => {
  const a = rateLimitKey("chat", undefined, "1.1.1.1");
  const b = rateLimitKey("chat", undefined, "2.2.2.2");
  expect(a).not.toBe(b);
});

test("a user id is preferred over the address, because it cannot be spoofed", () => {
  expect(rateLimitKey("chat", "user-a", "1.1.1.1")).toBe(rateLimitKey("chat", "user-a", "2.2.2.2"));
});

/* --- Which header the address is read from. `X-Forwarded-For` is a list a
 * caller can prepend to; only an edge-owned single-value header is trustworthy,
 * and trusting the rotatable one is how a caller minted a fresh bucket per
 * request (security review 2026-10-17, H3). --- */

test("cf-connecting-ip wins over x-forwarded-for, which a caller can forge", () => {
  const headers = new Headers({
    "cf-connecting-ip": "203.0.113.7",
    "x-forwarded-for": "9.9.9.9, 203.0.113.7",
  });
  expect(clientIp(headers)).toBe("203.0.113.7");
});

test("x-real-ip is the next trusted header", () => {
  const headers = new Headers({ "x-real-ip": "198.51.100.4", "x-forwarded-for": "9.9.9.9" });
  expect(clientIp(headers)).toBe("198.51.100.4");
});

test("it falls back to the RIGHTMOST forwarded-for entry, which the nearest proxy appends", () => {
  const spoofed = clientIp(new Headers({ "x-forwarded-for": "9.9.9.9, 203.0.113.7" }));
  const honest = clientIp(new Headers({ "x-forwarded-for": "203.0.113.7" }));
  expect(spoofed).toBe("203.0.113.7");
  expect(spoofed).toBe(honest);
});

test("no address at all is one shared bucket, never a fresh one", () => {
  expect(clientIp(new Headers())).toBe("unknown");
  expect(rateLimitKey("chat", undefined, undefined)).toBe(rateLimitKey("chat", undefined, ""));
});
