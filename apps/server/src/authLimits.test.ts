import { expect, test } from "vitest";
import { AUTH_GLOBAL_MAX, createPublicAuthLimiter } from "./authLimits.js";
import { SIGN_UP_RATE_LIMIT } from "./auth.js";

/* A1 / #253 (security review 2026-10-17): sign-up was limited, but
 * `send-verification-email` and `request-password-reset` were not. Both mail an
 * address the caller types in and answer differently for a known and an unknown
 * one — an account-enumeration oracle AND a verification-bombing amplifier. */

const headersFor = (ip: string) =>
  new Headers({ "x-real-ip": ip, "content-type": "application/json" });

test("one address cannot hammer one limited endpoint", () => {
  const allow = createPublicAuthLimiter();
  const path = "/api/auth/send-verification-email";
  for (let i = 0; i < SIGN_UP_RATE_LIMIT.max; i++)
    expect(allow("POST", path, headersFor("1.1.1.1"))).toBe(true);
  expect(allow("POST", path, headersFor("1.1.1.1"))).toBe(false);
});

test("a rotating address cannot mint fresh buckets for free — the global cap binds", () => {
  const allow = createPublicAuthLimiter();
  let allowed = 0;
  for (let i = 0; i < AUTH_GLOBAL_MAX + 70; i++)
    if (allow("POST", "/api/auth/request-password-reset", headersFor(`10.0.0.${i}`))) allowed++;
  expect(allowed).toBe(AUTH_GLOBAL_MAX);
});

test("the three mail/account endpoints share the one global ceiling", () => {
  const allow = createPublicAuthLimiter();
  const paths = [
    "/api/auth/sign-up/email",
    "/api/auth/send-verification-email",
    "/api/auth/request-password-reset",
  ];
  for (let i = 0; i < AUTH_GLOBAL_MAX; i++)
    expect(allow("POST", paths[i % paths.length]!, headersFor(`10.1.0.${i}`))).toBe(true);
  expect(allow("POST", paths[0]!, headersFor("10.2.0.1"))).toBe(false);
});

test("a request refused by its own address does not spend a global unit", () => {
  const allow = createPublicAuthLimiter(60_000, 1, 3);
  const path = "/api/auth/request-password-reset";
  expect(allow("POST", path, headersFor("1.1.1.1"))).toBe(true);
  for (let i = 0; i < 10; i++) expect(allow("POST", path, headersFor("1.1.1.1"))).toBe(false);
  expect(allow("POST", path, headersFor("2.2.2.2"))).toBe(true);
  expect(allow("POST", path, headersFor("3.3.3.3"))).toBe(true);
  expect(allow("POST", path, headersFor("4.4.4.4"))).toBe(false);
});

test("a request refused by the global cap does not spend its address's allowance", () => {
  let now = 0;
  const allow = createPublicAuthLimiter(60_000, 2, 1, () => now);
  const path = "/api/auth/send-verification-email";
  expect(allow("POST", path, headersFor("1.1.1.1"))).toBe(true);
  now = 30_000;
  for (let i = 0; i < 10; i++) expect(allow("POST", path, headersFor("2.2.2.2"))).toBe(false);
  now = 60_001;
  expect(allow("POST", path, headersFor("2.2.2.2"))).toBe(true);
  expect(allow("POST", path, headersFor("2.2.2.2"))).toBe(false);
});

test("sign-in and every other auth path are untouched — this is not a login limit", () => {
  const allow = createPublicAuthLimiter();
  for (let i = 0; i < 50; i++) {
    expect(allow("POST", "/api/auth/sign-in/email", headersFor("10.0.0.1"))).toBe(true);
    expect(allow("GET", "/api/auth/get-session", headersFor("10.0.0.1"))).toBe(true);
  }
});
