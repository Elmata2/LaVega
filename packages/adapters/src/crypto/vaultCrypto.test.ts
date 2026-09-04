import { expect, test } from "vitest";
import { newSalt, deriveKey, encryptJSON, decryptJSON, PBKDF2_ITERATIONS } from "./vaultCrypto.js";

test("round-trip: encrypt then decrypt with the same passphrase returns the input", async () => {
  const salt = newSalt();
  const key = await deriveKey("correct horse", salt, PBKDF2_ITERATIONS);
  const data = { accounts: [{ key: "A1", balance: 1.98 }], secret: "geheim" };
  const blob = await encryptJSON(key, salt, PBKDF2_ITERATIONS, data);
  const back = await decryptJSON<typeof data>(key, blob);
  expect(back).toEqual(data);
});

test("wrong passphrase => decrypt rejects (GCM auth failure), never returns garbage", async () => {
  const salt = newSalt();
  const good = await deriveKey("correct horse", salt, PBKDF2_ITERATIONS);
  const blob = await encryptJSON(good, salt, PBKDF2_ITERATIONS, { x: 1 });
  const bad = await deriveKey("wrong horse", salt, PBKDF2_ITERATIONS);
  await expect(decryptJSON(bad, blob)).rejects.toBeTruthy();
});

test("fresh IV per encryption (no IV reuse) even for identical data", async () => {
  const salt = newSalt();
  const key = await deriveKey("pw", salt, PBKDF2_ITERATIONS);
  const a = await encryptJSON(key, salt, PBKDF2_ITERATIONS, { x: 1 });
  const b = await encryptJSON(key, salt, PBKDF2_ITERATIONS, { x: 1 });
  expect(a.iv).not.toBe(b.iv);
  expect(a.ct).not.toBe(b.ct); // different IV => different ciphertext
});

test("ciphertext does not contain the plaintext", async () => {
  const salt = newSalt();
  const key = await deriveKey("pw", salt, PBKDF2_ITERATIONS);
  const blob = await encryptJSON(key, salt, PBKDF2_ITERATIONS, {
    counterparty: "ALBERT HEIJN",
    balance: 1234.56,
  });
  // base64 ciphertext must not leak the plaintext substrings
  const hay = blob.ct + blob.iv + blob.salt;
  expect(hay.includes("ALBERT")).toBe(false);
});

test("deriveKey rejects an iteration count below the floor (tamper hardening)", async () => {
  await expect(deriveKey("pw", newSalt(), 1000)).rejects.toBeTruthy();
});

test("blob metadata is well-formed", async () => {
  const salt = newSalt();
  const key = await deriveKey("pw", salt, PBKDF2_ITERATIONS);
  const blob = await encryptJSON(key, salt, PBKDF2_ITERATIONS, { x: 1 });
  expect(blob).toMatchObject({ v: 1, kdf: "PBKDF2-SHA256", iterations: PBKDF2_ITERATIONS });
  expect(typeof blob.salt).toBe("string");
  expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(210_000);
});
