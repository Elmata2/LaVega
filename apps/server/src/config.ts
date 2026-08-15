import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DIRNAME = path.dirname(fileURLToPath(import.meta.url));

/** apps/server/config.json — git-ignored, holds the Enable Banking credential
 *  for LOCAL dev. In production (Railway) the credential comes from env vars. */
export const DEFAULT_CONFIG_PATH = path.join(DIRNAME, "..", "config.json");

export const DEFAULT_PORT = 8787;

const PLACEHOLDER = "VUL-IN";
const DEFAULT_REDIRECT_URL = `http://localhost:${DEFAULT_PORT}/api/eb/callback`;
const DEFAULT_PSU_TYPE = "business";

export interface EbConfig {
  configured: boolean;
  applicationId: string | null;
  /** Inline PEM private key (from EB_PRIVATE_KEY env), if provided. */
  privateKey: string | null;
  /** Path to a PEM file (config.json / EB_PRIVATE_KEY_FILE), if provided. */
  privateKeyFile: string | null;
  redirectUrl: string;
  psuType: string;
}

interface RawEbConfig {
  applicationId?: string;
  privateKey?: string;
  privateKeyFile?: string;
  redirectUrl?: string;
  psuType?: string;
}

/** Read + parse JSON, falling back on any error (missing file, bad JSON, ...). */
function readJSON<T>(filePath: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/**
 * Load the Enable Banking config. Env vars (production/Railway) win over
 * config.json (local dev). Never throws: a missing applicationId or a `VUL-IN`
 * placeholder simply reports `configured: false`.
 *
 * Env: EB_APPLICATION_ID, EB_PRIVATE_KEY (inline PEM — literal `\n` is
 * un-escaped), EB_PRIVATE_KEY_FILE, EB_REDIRECT_URL, EB_PSU_TYPE.
 */
export function loadConfig(configPath: string = DEFAULT_CONFIG_PATH): EbConfig {
  const raw = readJSON<RawEbConfig | null>(configPath, null);
  const applicationId = process.env.EB_APPLICATION_ID ?? raw?.applicationId ?? null;
  const configured =
    typeof applicationId === "string" && applicationId.length > 0 && !applicationId.includes(PLACEHOLDER);
  const envKey = process.env.EB_PRIVATE_KEY;
  const privateKey = envKey ? envKey.replace(/\\n/g, "\n") : (raw?.privateKey ?? null);
  return {
    configured,
    applicationId: configured ? (applicationId as string) : null,
    privateKey,
    privateKeyFile: process.env.EB_PRIVATE_KEY_FILE ?? raw?.privateKeyFile ?? null,
    redirectUrl: process.env.EB_REDIRECT_URL ?? raw?.redirectUrl ?? DEFAULT_REDIRECT_URL,
    psuType: process.env.EB_PSU_TYPE ?? raw?.psuType ?? DEFAULT_PSU_TYPE,
  };
}

/** first 8 chars + "…" so the applicationId never appears in full in responses/logs. */
export function maskApplicationId(applicationId: string | null): string | null {
  if (!applicationId) return null;
  return applicationId.slice(0, 8) + "…";
}

/**
 * Load the Anthropic LLM config (server-only; the API key never reaches the
 * client). `configured` is true only when ANTHROPIC_API_KEY is a non-empty
 * string.
 */
export function loadLlmConfig(): { configured: boolean; apiKey: string | null } {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? null;
  return { configured: typeof apiKey === "string" && apiKey.length > 0, apiKey };
}

/** Shared secret for the n8n card-terms ingest. Unset means the endpoint is
 *  closed (503) — same shape as loadLlmConfig, so an unconfigured deployment
 *  refuses rather than accepting anonymous writes into the terms cache. */
export function loadIngestConfig(): { configured: boolean; token: string | null } {
  const token = process.env.CARD_TERMS_INGEST_TOKEN ?? null;
  return { configured: typeof token === "string" && token.length >= 16, token };
}
