import { createSign } from "node:crypto";
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
  privateKeyFile: string | null;
}

function base64url(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64url");
}

function resolvePrivateKeyPath(privateKeyFile: string): string {
  return path.isAbsolute(privateKeyFile) ? privateKeyFile : path.join(SERVER_DIR, privateKeyFile);
}

/**
 * Build a RS256-signed JWT for Enable Banking's API: header carries
 * `kid: applicationId`; claims are `iss`/`aud`/`iat`/`exp` (1h TTL). No JWT
 * library — plain `node:crypto` + base64url, matching the reference.
 */
export function ebJWT(config: EbClientConfig): string {
  const { applicationId, privateKeyFile } = config;
  if (!applicationId) {
    throw new Error("Enable Banking: applicationId is missing from config");
  }
  if (!privateKeyFile) {
    throw new Error("Enable Banking: privateKeyFile is missing from config");
  }
  const keyPath = resolvePrivateKeyPath(privateKeyFile);
  if (!existsSync(keyPath)) {
    throw new Error(`Enable Banking: private key not found at ${keyPath}`);
  }
  const privateKey = readFileSync(keyPath, "utf8");

  const iat = Math.floor(Date.now() / 1000);
  const header = { typ: "JWT", alg: "RS256", kid: applicationId };
  const claims = { iss: EB_ISSUER, aud: EB_AUDIENCE, iat, exp: iat + JWT_TTL_SECONDS };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}`;
  const signature = createSign("RSA-SHA256").update(signingInput).sign(privateKey);
  return `${signingInput}.${base64url(signature)}`;
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
      Authorization: `Bearer ${ebJWT(config)}`,
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
