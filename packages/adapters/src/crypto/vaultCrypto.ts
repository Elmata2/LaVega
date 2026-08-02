export type CipherBlob = {
  v: 1;
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string; // base64 of the 16-byte salt
  iv: string; // base64 of the 12-byte IV (unique per blob)
  ct: string; // base64 of the AES-GCM ciphertext (incl. auth tag)
};

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

export function newSalt(): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(16));
}

export async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  // Floor the work factor: an attacker who tampered a stored blob's `iterations`
  // down to a tiny number could otherwise force a cheap-to-bruteforce derivation.
  if (iterations < PBKDF2_ITERATIONS) {
    throw new Error(`PBKDF2 iterations te laag (${iterations} < ${PBKDF2_ITERATIONS})`);
  }
  const material = await globalThis.crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return globalThis.crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false, // non-extractable
    ["encrypt", "decrypt"],
  );
}

export async function encryptJSON(key: CryptoKey, salt: Uint8Array, iterations: number, data: unknown): Promise<CipherBlob> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const ct = await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(JSON.stringify(data)));
  return { v: 1, kdf: "PBKDF2-SHA256", iterations, salt: toB64(salt), iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}

export async function decryptJSON<T>(key: CryptoKey, blob: CipherBlob): Promise<T> {
  const iv = fromB64(blob.iv);
  const ct = fromB64(blob.ct);
  const pt = await globalThis.crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, ct as BufferSource); // throws on auth failure
  return JSON.parse(dec.decode(pt)) as T;
}
