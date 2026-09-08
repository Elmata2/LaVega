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
export type PsuType = "business" | "personal";
const DEFAULT_PSU_TYPE: PsuType = "business";

/** EB_PSU_TYPE is the default for callers that do not choose; the bank picker
 *  sends one explicitly. A misspelt value falls back to the default with a
 *  warning instead of reaching Enable Banking as garbage. */
function psuTypeSetting(raw: string | undefined): PsuType {
  if (raw === undefined || raw === "") return DEFAULT_PSU_TYPE;
  if (raw === "business" || raw === "personal") return raw;
  console.warn(`EB_PSU_TYPE "${raw}" is not business or personal; using ${DEFAULT_PSU_TYPE}`);
  return DEFAULT_PSU_TYPE;
}

export interface EbConfig {
  configured: boolean;
  applicationId: string | null;
  /** Inline PEM private key (from EB_PRIVATE_KEY env), if provided. */
  privateKey: string | null;
  /** Path to a PEM file (config.json / EB_PRIVATE_KEY_FILE), if provided. */
  privateKeyFile: string | null;
  redirectUrl: string;
  psuType: PsuType;
  /** Where the signing key comes from; "missing" means every EB call will fail. */
  keySource: "env" | "env-not-pem" | "file" | "missing";
  /** What the pasted EB_PRIVATE_KEY looks like, never its content: enough to
   *  tell an operator what went wrong with the paste. */
  keyShape: KeyShape;
}

export type KeyShape = {
  kind: "pem" | "base64-pem" | "base64-body" | "path" | "other" | "none";
  length: number;
};

function shapeOf(value: string | null): KeyShape {
  if (!value) return { kind: "none", length: 0 };
  const v = value.trim();
  const length = v.length;
  if (v.includes("-----BEGIN")) return { kind: "pem", length };
  if (/\.pem$|^[./~]/.test(v) && !v.includes(" ") && length < 200) return { kind: "path", length };
  if (/^[A-Za-z0-9+/=\s\\n]+$/.test(v)) {
    const decoded = Buffer.from(v.replace(/\\n/g, ""), "base64").toString("utf8");
    return { kind: decoded.includes("-----BEGIN") ? "base64-pem" : "base64-body", length };
  }
  return { kind: "other", length };
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
/** The PEM as an operator may have pasted it into a dashboard: with literal
 *  `\n` for line breaks, or base64-encoded as a whole file. Anything without a
 *  `-----BEGIN` line after that is not a key we can sign with. */
function pemFromSetting(value: string): string | null {
  const unescaped = value.replace(/\\n/g, "\n").trim();
  if (unescaped.includes("-----BEGIN")) return unescaped;
  try {
    const decoded = Buffer.from(unescaped, "base64").toString("utf8");
    if (decoded.includes("-----BEGIN")) return decoded.trim();
  } catch {
    /* not base64 */
  }
  return null;
}

export function loadConfig(configPath: string = DEFAULT_CONFIG_PATH): EbConfig {
  const raw = readJSON<RawEbConfig | null>(configPath, null);
  const applicationId = process.env.EB_APPLICATION_ID ?? raw?.applicationId ?? null;
  const hasApplicationId =
    typeof applicationId === "string" &&
    applicationId.length > 0 &&
    !applicationId.includes(PLACEHOLDER);
  const envKey = process.env.EB_PRIVATE_KEY || raw?.privateKey || null;
  const privateKey = envKey ? pemFromSetting(envKey) : null;
  const privateKeyFile = process.env.EB_PRIVATE_KEY_FILE ?? raw?.privateKeyFile ?? null;
  const keySource = privateKey
    ? "env"
    : envKey
      ? "env-not-pem"
      : privateKeyFile
        ? "file"
        : "missing";
  // An application id without a key is not configured: every call would fail
  // at signing, and /api/eb/status must not claim otherwise (it did, once).
  const configured = hasApplicationId && (keySource === "env" || keySource === "file");
  return {
    configured,
    keySource,
    keyShape: shapeOf(envKey),
    applicationId: hasApplicationId ? (applicationId as string) : null,
    privateKey,
    privateKeyFile,
    redirectUrl: process.env.EB_REDIRECT_URL ?? raw?.redirectUrl ?? DEFAULT_REDIRECT_URL,
    psuType: psuTypeSetting(process.env.EB_PSU_TYPE ?? raw?.psuType),
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
