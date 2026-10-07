/** Sealed with a key derived from a vault password. Only read now: to adopt a
 *  vault made before accounts held the key, or to restore an old back-up. */
export type PassphraseCipherBlob = {
  v: 1;
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string; // base64 of the 16-byte salt
  iv: string; // base64 of the 12-byte IV (unique per blob)
  ct: string; // base64 of the AES-GCM ciphertext (incl. auth tag)
};

/** Sealed with the account's vault key (docs/adr/0009-account-held-vault-key.md). */
export type AccountCipherBlob = {
  v: 2;
  kdf: "account-key";
  iv: string;
  ct: string;
};

export type CipherBlob = PassphraseCipherBlob | AccountCipherBlob;

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
function fromB64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export const PBKDF2_ITERATIONS = 210_000;

/** Turns the 32 raw bytes from GET /api/vault/key into a key the page can use
 *  but never read back out. */
export function importVaultKey(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.length !== 32) throw new Error("vault key must be 32 bytes");
  return globalThis.crypto.subtle.importKey(
    "raw",
    raw as BufferSource,
    { name: "AES-GCM" },
    false, // non-extractable
    ["encrypt", "decrypt"],
  );
}

export function vaultKeyFromBase64(b64: string): Promise<CryptoKey> {
  return importVaultKey(fromB64(b64));
}

/** A fresh non-extractable vault key, for a deployment with no accounts. */
export function generateVaultKey(): Promise<CryptoKey> {
  return globalThis.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function sealJSON(key: CryptoKey, data: unknown): Promise<AccountCipherBlob> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(JSON.stringify(data)),
  );
  return { v: 2, kdf: "account-key", iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}

export function newSalt(): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(16));
}

export async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  // Floor the work factor: an attacker who tampered a stored blob's `iterations`
  // down to a tiny number could otherwise force a cheap-to-bruteforce derivation.
  if (iterations < PBKDF2_ITERATIONS) {
    throw new Error(`PBKDF2 iterations te laag (${iterations} < ${PBKDF2_ITERATIONS})`);
  }
  const material = await globalThis.crypto.subtle.importKey(
    "raw",
    enc.encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return globalThis.crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false, // non-extractable
    ["encrypt", "decrypt"],
  );
}

export async function encryptJSON(
  key: CryptoKey,
  salt: Uint8Array,
  iterations: number,
  data: unknown,
): Promise<PassphraseCipherBlob> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await globalThis.crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(JSON.stringify(data)),
  );
  return {
    v: 1,
    kdf: "PBKDF2-SHA256",
    iterations,
    salt: toB64(salt),
    iv: toB64(iv),
    ct: toB64(new Uint8Array(ct)),
  };
}

export async function decryptJSON<T>(key: CryptoKey, blob: CipherBlob): Promise<T> {
  const iv = fromB64(blob.iv);
  const ct = fromB64(blob.ct);
  const pt = await globalThis.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    ct as BufferSource,
  ); // throws on auth failure
  return JSON.parse(dec.decode(pt)) as T;
}
