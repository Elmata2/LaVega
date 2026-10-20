import { expect, test } from "vitest";
import { app } from "./index.js";

/* M1 / #239 (security review 2026-10-17): no route had a body-size limit, so a
 * large POST to a public JSON endpoint was buffered whole into memory — an
 * unauthenticated memory-exhaustion vector. The cap runs BEFORE the session
 * guard, so an oversized body is refused on size alone. */

const OVERSIZE = "x".repeat(9 * 1024 * 1024);

test("an oversized POST is refused with 413 before any auth work", async () => {
  const res = await app.request("/api/card-terms/ingest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ padding: OVERSIZE }),
  });
  expect(res.status).toBe(413);
  expect(await res.json()).toEqual({
    error: "Het verzoek is te groot.",
    code: "payload-too-large",
  });
});

test("the limit does not break the sealed vault backup, which is the largest legitimate body", async () => {
  // 1 MB — comfortably above a real encrypted vault — must reach the route's
  // own auth (401, no session) rather than being refused by the limiter.
  const res = await app.request("/api/vault/backup?overwrite=true", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      blob: { v: 2, kdf: "account-key", iv: "a", ct: "b" },
      pad: "y".repeat(1_000_000),
    }),
  });
  expect(res.status).toBe(401);
});
