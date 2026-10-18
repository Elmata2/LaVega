import { expect, test } from "vitest";
import { createPublicAuthLimiter } from "./authLimits.js";

/* A1 / #253 (security review 2026-10-17): sign-up was limited, but
 * `send-verification-email` and `request-password-reset` were not. Both mail an
 * address the caller types in and answer differently for a known and an unknown
 * one — an account-enumeration oracle AND a verification-bombing amplifier. */

const post = (path: string, ip: string) =>
  new Headers({ "cf-connecting-ip": ip, "content-type": "application/json" });

test("one address cannot hammer one limited endpoint", () => {
  const allow = createPublicAuthLimiter(60_000, 5, 1_000);
  for (let i = 0; i < 5; i++)
    expect(allow("POST", "/api/auth/send-verification-email", post("x", "1.1.1.1"))).toBe(true);
  expect(allow("POST", "/api/auth/send-verification-email", post("x", "1.1.1.1"))).toBe(false);
});

test("a rotating address cannot mint fresh buckets for free — the global cap binds", () => {
  const allow = createPublicAuthLimiter(60_000, 100, 30);
  let allowed = 0;
  for (let i = 0; i < 100; i++)
    if (allow("POST", "/api/auth/request-password-reset", post("x", `10.0.0.${i}`))) allowed++;
  expect(allowed).toBe(30);
});

test("the three mail/account endpoints share the one global ceiling", () => {
  const allow = createPublicAuthLimiter(60_000, 100, 2);
  expect(allow("POST", "/api/auth/sign-up/email", post("x", "1"))).toBe(true);
  expect(allow("POST", "/api/auth/send-verification-email", post("x", "2"))).toBe(true);
  expect(allow("POST", "/api/auth/request-password-reset", post("x", "3"))).toBe(false);
});

test("sign-in and every other auth path are untouched — this is not a login limit", () => {
  const allow = createPublicAuthLimiter(60_000, 1, 1);
  for (let i = 0; i < 50; i++) {
    expect(allow("POST", "/api/auth/sign-in/email", post("x", `10.0.0.${i}`))).toBe(true);
    expect(allow("GET", "/api/auth/get-session", post("x", `10.0.0.${i}`))).toBe(true);
  }
});
