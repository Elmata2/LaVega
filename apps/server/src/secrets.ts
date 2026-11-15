import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Constant-time equality for two shared secrets.
 *
 * `a === b` on a secret leaks how much of a guess was right through how long
 * the compare took: V8 stops at the first differing byte, so an attacker who
 * can time the response can recover the token one character at a time. Both
 * sides are hashed to a fixed width first, which also removes the length as a
 * timing signal (`timingSafeEqual` throws on unequal lengths, and padding to a
 * common length still leaks which side was longer).
 *
 * Used for the card-terms ingest token and the cron bearer secret — the two
 * places a machine, not a person, holds the matching value.
 */
export function secretsMatch(given: string, expected: string): boolean {
  const a = createHash("sha256").update(given, "utf8").digest();
  const b = createHash("sha256").update(expected, "utf8").digest();
  return timingSafeEqual(a, b);
}
