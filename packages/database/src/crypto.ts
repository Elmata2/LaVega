import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export function encryptionKey(): Buffer {
  const value = process.env.LAVEGA_ENCRYPTION_KEY;
  if (!value) throw new Error("LAVEGA_ENCRYPTION_KEY is required");
  const key = /^[0-9a-f]{64}$/i.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value, "base64");
  if (key.length !== 32) throw new Error("LAVEGA_ENCRYPTION_KEY must decode to 32 bytes");
  return key;
}

/** Versioned AES-256-GCM envelope. Key never enters PostgreSQL. */
export function encryptBlob(value: unknown): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([1, iv.length]), iv, cipher.getAuthTag(), ciphertext]);
}

/**
 * Decrypt, or say it could not be done.
 *
 * A blob sealed under a key that is no longer configured is not corrupt and not
 * absent — it is unreadable, and those three want different answers. Callers
 * that hold a cache can carry on without it; callers that hold the only copy of
 * something must not pretend it was never there.
 */
export function tryDecryptBlob<T>(
  blob: Buffer | Uint8Array,
): { readable: true; value: T } | { readable: false } {
  try {
    return { readable: true, value: decryptBlob<T>(blob) };
  } catch {
    return { readable: false };
  }
}

export function decryptBlob<T>(blob: Buffer | Uint8Array): T {
  const bytes = Buffer.from(blob);
  if (bytes[0] !== 1 || bytes[1] !== 12 || bytes.length < 30)
    throw new Error("Invalid encrypted blob");
  const iv = bytes.subarray(2, 14);
  const tag = bytes.subarray(14, 30);
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([decipher.update(bytes.subarray(30)), decipher.final()]).toString("utf8"),
  ) as T;
}
