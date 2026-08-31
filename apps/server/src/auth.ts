import { betterAuth, type Auth } from "better-auth";
import { createDatabase, type Database } from "@lavega/database";

const origin = (host: string | undefined) => host?.trim() ? `https://${host.trim()}` : null;

/**
 * The hostnames this deployment answers on, most durable first.
 *
 * A preview has two: VERCEL_URL is the immutable per-commit deployment, and
 * VERCEL_BRANCH_URL is the branch alias that stays put across commits. The
 * alias is the link a person opens, so it leads — but both have to be trusted
 * or whichever one the browser used has its /api/auth calls refused.
 */
function deploymentOrigins(): string[] {
  return [origin(process.env.VERCEL_BRANCH_URL), origin(process.env.VERCEL_URL)].filter((value): value is string => value !== null);
}

/**
 * Where this deployment thinks it lives.
 *
 * A preview gets a fresh hostname on every commit, so no configured value can
 * name it and Better Auth would sign cookies for the wrong origin. Production
 * sets BETTER_AUTH_URL and keeps the canonical hostname.
 */
export function authBaseUrl(): string {
  return process.env.BETTER_AUTH_URL?.trim() || deploymentOrigins()[0] || "http://localhost:8787";
}

/** Configured origins plus this deployment's own — without itself, its own /api/auth calls are refused. */
export function authTrustedOrigins(): string[] {
  const configured = (process.env.BETTER_AUTH_TRUSTED_ORIGINS ?? process.env.BETTER_AUTH_URL ?? "")
    .split(",").map((origin) => origin.trim()).filter(Boolean);
  const origins = [...new Set([...configured, ...deploymentOrigins()])];
  return origins.length ? origins : ["http://localhost:8787"];
}

let database: Database | null = null;
let instance: Auth<any> | null = null;

export function getAuth(): Auth<any> | null {
  if (!process.env.DATABASE_URL || !process.env.BETTER_AUTH_SECRET) return null;
  if (instance) return instance;
  database ??= createDatabase();
  instance = betterAuth({
    database,
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: authBaseUrl(),
    trustedOrigins: authTrustedOrigins(),
    emailAndPassword: { enabled: true },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
  });
  return instance;
}

export async function verifiedSession(request: Request) {
  const auth = getAuth();
  if (!auth) return null;
  return auth.api.getSession({ headers: request.headers });
}
