import { afterEach, expect, test } from "vitest";
import { decryptBlob, encryptBlob, requireUserId, withTenant } from "./index.js";

afterEach(() => { delete process.env.LAVEGA_ENCRYPTION_KEY; });

test("encrypted blobs round-trip and do not contain plaintext", () => {
  process.env.LAVEGA_ENCRYPTION_KEY = "00".repeat(32);
  const blob = encryptBlob({ secret: "not-for-neon" });
  expect(blob.toString("utf8")).not.toContain("not-for-neon");
  expect(decryptBlob<{ secret: string }>(blob)).toEqual({ secret: "not-for-neon" });
});

test("encryption rejects missing or invalid key", () => {
  expect(() => encryptBlob({ value: 1 })).toThrow("LAVEGA_ENCRYPTION_KEY");
  process.env.LAVEGA_ENCRYPTION_KEY = "bad";
  expect(() => encryptBlob({ value: 1 })).toThrow("32 bytes");
});

test("tenant identity is mandatory", () => {
  expect(() => requireUserId(undefined)).toThrow("Authenticated user identity is required");
  expect(() => requireUserId(" ")).toThrow("Authenticated user identity is required");
});

test("withTenant sets transaction-local identity and rolls back on failure", async () => {
  const calls: string[] = [];
  const client = {
    query: async (sql: string) => { calls.push(sql); return { rows: [] }; },
    release: () => calls.push("release"),
  } as never;
  const db = { connect: async () => client } as never;
  await expect(withTenant(db, "user-1", async () => { throw new Error("fail"); })).rejects.toThrow("fail");
  expect(calls).toEqual(["BEGIN", "SELECT set_config('app.user_id', $1, true)", "ROLLBACK", "release"]);
});
