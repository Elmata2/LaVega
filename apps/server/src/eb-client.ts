import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/**
 * Enable Banking RS256 JWT signer + a thin API client.
 *
 * Ported from the clean-room reference `server.mjs` (`ebJWT`/`eb`) to typed
 * TS. The reference read a module-level `CONFIG` global; here the config is
 * passed in explicitly so this module has no hidden state and is trivially
 * testable with a throwaway key.
 *
 * Scope: JWT signing + generic request/response plumbing only. The actual
 * Enable Banking routes (`/aspsps`, `/auth`, `/callback`, `/sync`) are a
 * separate task and are not implemented here.
 */

const EB_ISSUER = "enablebanking.com";
const EB_AUDIENCE = "api.enablebanking.com";
const JWT_TTL_SECONDS = 3600;

export const DEFAULT_EB_BASE_URL = "https://api.enablebanking.com";

/** apps/server — relative `privateKeyFile` paths resolve against this directory (not `process.cwd()`). */
const SERVER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

export interface EbClientConfig {
  applicationId: string | null;
  /** Inline PEM private key (Railway secret). Takes precedence over privateKeyFile. */
  privateKey?: string | null;
  privateKeyFile: string | null;
}

function base64url(input: string | Buffer | Uint8Array): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input);
  return buf.toString("base64url");
}

function resolvePrivateKeyPath(privateKeyFile: string): string {
  return path.isAbsolute(privateKeyFile) ? privateKeyFile : path.join(SERVER_DIR, privateKeyFile);
}

/** DER length octets (definite form: short for <128, long form above). */
function derLength(len: number): number[] {
  if (len < 0x80) return [len];
  const bytes: number[] = [];
  for (let n = len; n > 0; n >>= 8) bytes.unshift(n & 0xff);
  return [0x80 | bytes.length, ...bytes];
}

/** DER TLV: tag + length + content. */
function derWrap(tag: number, content: Uint8Array): Uint8Array<ArrayBuffer> {
  const length = derLength(content.length);
  const out = new Uint8Array(1 + length.length + content.length);
  out[0] = tag;
  out.set(length, 1);
  out.set(content, 1 + length.length);
  return out;
}

// SEQUENCE { OID rsaEncryption, NULL } — the fixed AlgorithmIdentifier every
// PKCS#8 RSA key carries.
const RSA_ALGORITHM_IDENTIFIER = Uint8Array.from([
  0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00,
]);

/**
 * Wrap a PKCS#1 ("BEGIN RSA PRIVATE KEY") DER body in the PKCS#8
 * ("BEGIN PRIVATE KEY") envelope: `SEQUENCE { version 0, AlgorithmIdentifier,
 * OCTET STRING <pkcs1Der> }`. WebCrypto's `importKey("pkcs8", ...)` only
 * accepts PKCS#8 — and Enable Banking's onboarding docs generate keys with
 * `openssl genrsa`, which emits PKCS#1.
 */
function pkcs1ToPkcs8(pkcs1Der: Uint8Array): Uint8Array<ArrayBuffer> {
  const version = Uint8Array.from([0x02, 0x01, 0x00]); // INTEGER 0
  const privateKeyOctetString = derWrap(0x04, pkcs1Der);
  const body = new Uint8Array(
    version.length + RSA_ALGORITHM_IDENTIFIER.length + privateKeyOctetString.length,
  );
  body.set(version, 0);
  body.set(RSA_ALGORITHM_IDENTIFIER, version.length);
  body.set(privateKeyOctetString, version.length + RSA_ALGORITHM_IDENTIFIER.length);
  return derWrap(0x30, body); // SEQUENCE
}

function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const base64 = pem.replace(/-----(BEGIN|END) [^-]+-----/g, "").replace(/\s+/g, "");
  return Uint8Array.from(Buffer.from(base64, "base64"));
}

/**
 * Import a PEM RSA private key (PKCS#1 or PKCS#8) as a WebCrypto signing
 * key. `crypto.subtle` is global in Node, Cloudflare Workers, and Vercel
 * Edge alike — unlike `node:crypto`, so this makes the signer portable.
 */
async function importSigningKey(pem: string): Promise<CryptoKey> {
  const der = pemToDer(pem);
  const pkcs8Der = /BEGIN RSA PRIVATE KEY/.test(pem) ? pkcs1ToPkcs8(der) : der;
  return crypto.subtle.importKey(
    "pkcs8",
    pkcs8Der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/**
 * Build a RS256-signed JWT for Enable Banking's API: header carries
 * `kid: applicationId`; claims are `iss`/`aud`/`iat`/`exp` (1h TTL). No JWT
 * library — plain WebCrypto (`crypto.subtle.sign`) + base64url, matching
 * the reference.
 */
export async function ebJWT(config: EbClientConfig): Promise<string> {
  const { applicationId, privateKeyFile } = config;
  if (!applicationId) {
    throw new Error("Enable Banking: applicationId is missing from config");
  }
  // Prefer an inline PEM (Railway secret); fall back to a key file (local dev).
  let privateKey: string;
  if (config.privateKey && config.privateKey.includes("BEGIN")) {
    privateKey = config.privateKey;
  } else {
    if (!privateKeyFile) {
      throw new Error("Enable Banking: no private key (set EB_PRIVATE_KEY or privateKeyFile)");
    }
    const keyPath = resolvePrivateKeyPath(privateKeyFile);
    if (!existsSync(keyPath)) {
      throw new Error(`Enable Banking: private key not found at ${keyPath}`);
    }
    privateKey = readFileSync(keyPath, "utf8");
  }

  const iat = Math.floor(Date.now() / 1000);
  const header = { typ: "JWT", alg: "RS256", kid: applicationId };
  const claims = { iss: EB_ISSUER, aud: EB_AUDIENCE, iat, exp: iat + JWT_TTL_SECONDS };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signingKey = await importSigningKey(privateKey);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    signingKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64url(new Uint8Array(signature))}`;
}

/** A non-2xx response from the Enable Banking API. */
export class EnableBankingApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "EnableBankingApiError";
    this.status = status;
  }
}

function extractErrorMessage(data: unknown): string | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  const errorObj = d.error;
  if (typeof errorObj === "object" && errorObj !== null) {
    const m = (errorObj as Record<string, unknown>).message;
    if (typeof m === "string") return m;
  }
  if (typeof d.message === "string") return d.message;
  if (typeof d.detail === "string") return d.detail;
  return null;
}

/**
 * Call the Enable Banking API at `baseUrl + urlPath`, authenticated with a
 * freshly-signed `ebJWT`. Sends `body` as JSON when present, parses the JSON
 * response, and throws `EnableBankingApiError` with a clear message on any
 * non-2xx status.
 *
 * `baseUrl` defaults to the real API but is overridable via this parameter
 * or the `EB_BASE_URL` env var — so callers (and tests) can point it at a
 * local mock server instead of the network.
 */
export async function eb(
  config: EbClientConfig,
  method: string,
  urlPath: string,
  body?: unknown,
  baseUrl: string = process.env.EB_BASE_URL ?? DEFAULT_EB_BASE_URL,
): Promise<unknown> {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${await ebJWT(config)}`,
      "Content-Type": "application/json",
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: unknown;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const message = extractErrorMessage(data) ?? text.slice(0, 400);
    throw new EnableBankingApiError(res.status, `Enable Banking ${res.status}: ${message}`);
  }
  return data;
}
