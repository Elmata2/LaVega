import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DIRNAME = path.dirname(fileURLToPath(import.meta.url));

/** apps/server/config.json — git-ignored, holds the Enable Banking credential. */
export const DEFAULT_CONFIG_PATH = path.join(DIRNAME, "..", "config.json");

export const DEFAULT_PORT = 8787;

const PLACEHOLDER = "VUL-IN";
const DEFAULT_REDIRECT_URL = `http://localhost:${DEFAULT_PORT}/api/eb/callback`;
const DEFAULT_PSU_TYPE = "business";

export interface EbConfig {
  configured: boolean;
  applicationId: string | null;
  privateKeyFile: string | null;
  redirectUrl: string;
  psuType: string;
}

interface RawEbConfig {
  applicationId?: string;
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
 * Load the Enable Banking config. Never throws: a missing file or a
 * `VUL-IN` placeholder applicationId simply reports `configured: false`.
 */
export function loadConfig(configPath: string = DEFAULT_CONFIG_PATH): EbConfig {
  const raw = readJSON<RawEbConfig | null>(configPath, null);
  const applicationId = raw?.applicationId ?? null;
  const configured = Boolean(applicationId) && !applicationId!.includes(PLACEHOLDER);
  return {
    configured,
    applicationId: configured ? (applicationId as string) : null,
    privateKeyFile: raw?.privateKeyFile ?? null,
    redirectUrl: raw?.redirectUrl ?? DEFAULT_REDIRECT_URL,
    psuType: raw?.psuType ?? DEFAULT_PSU_TYPE,
  };
}

/** first 8 chars + "…" so the applicationId never appears in full in responses/logs. */
export function maskApplicationId(applicationId: string | null): string | null {
  if (!applicationId) return null;
  return applicationId.slice(0, 8) + "…";
}
