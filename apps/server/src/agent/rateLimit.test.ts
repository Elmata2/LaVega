import { expect, test, vi } from "vitest";
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

test("a rotating caller cannot pin the tracked set: the oldest bucket is evicted at the cap", () => {
  // Every spoofed X-Forwarded-For used to mint a key that lived for the
  // process lifetime. A flood of distinct keys must push the oldest bucket out,
  // so a spent budget does not survive the flood.
  const limit = createRateLimiter(1, 60_000, () => 0);
  expect(limit("victim")).toBe(true);
  expect(limit("victim")).toBe(false);
  for (let i = 0; i < 10_000; i++) limit(`ip-${i}`);
  expect(limit("victim")).toBe(true); // evicted, so it starts fresh
});

test("eviction drops the least recently used bucket, not the freshest one", () => {
  const limit = createRateLimiter(1, 60_000, () => 0);
  expect(limit("warm")).toBe(true);
  expect(limit("hot")).toBe(true);
  // Fill to the cap: "warm" and "hot" plus 9,998 fillers is exactly 10,000 keys.
  for (let i = 0; i < 9_998; i++) limit(`filler-${i}`);
  expect(limit("hot")).toBe(false); // "hot" is in use, so it becomes the most recent
  expect(limit("newcomer")).toBe(true); // overflow: evicts "warm", the least recent
  expect(limit("hot")).toBe(false); // "hot" survived with its count intact
  expect(limit("warm")).toBe(true); // "warm" was evicted, so it starts fresh
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

test("cf-connecting-ip is ignored by default: off Cloudflare a caller sets it themselves", () => {
  const headers = new Headers({ "cf-connecting-ip": "6.6.6.6", "x-real-ip": "198.51.100.4" });
  expect(clientIp(headers)).toBe("198.51.100.4");
  expect(clientIp(new Headers({ "cf-connecting-ip": "6.6.6.6" }))).toBe("unknown");
});

test("cf-connecting-ip wins over x-real-ip once the deployment opts in", () => {
  vi.stubEnv("LAVEGA_TRUST_CF_CONNECTING_IP", "1");
  try {
    const headers = new Headers({ "cf-connecting-ip": "203.0.113.7", "x-real-ip": "172.70.0.1" });
    expect(clientIp(headers)).toBe("203.0.113.7");
  } finally {
    vi.unstubAllEnvs();
  }
});

test("x-real-ip beats a forgeable x-forwarded-for", () => {
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
