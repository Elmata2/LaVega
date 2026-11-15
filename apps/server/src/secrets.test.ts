import { expect, test } from "vitest";
import { secretsMatch } from "./secrets.js";

/* A3 (security review 2026-10-17): the card-terms ingest token and the cron
 * bearer secret were compared with `===`, which stops at the first differing
 * byte — a timing side channel that can recover the token character by
 * character. */

test("matching secrets compare equal", () => {
  expect(secretsMatch("correct-horse-battery-staple", "correct-horse-battery-staple")).toBe(true);
});

test("a wrong secret of the same length is refused", () => {
  expect(secretsMatch("correct-horse-battery-stapl3", "correct-horse-battery-staple")).toBe(false);
});

test("a wrong secret of a different length is refused, not thrown on", () => {
  // `timingSafeEqual` throws on unequal lengths; hashing both sides first is
  // what makes a length mismatch an ordinary `false`.
  expect(secretsMatch("short", "correct-horse-battery-staple")).toBe(false);
  expect(secretsMatch("", "")).toBe(true);
  expect(secretsMatch("Bearer ", "Bearer secret")).toBe(false);
});
