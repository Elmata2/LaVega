import { betterAuth, type Auth } from "better-auth";
import { type Database } from "@lavega/database";
import { runtimeDatabase } from "@lavega/investing-server/src/credentialStore.js";
import { sendAuthEmail } from "./authEmail.js";

const origin = (host: string | undefined) => (host?.trim() ? `https://${host.trim()}` : null);

/**
 * The hostnames this deployment answers on, most durable first.
 *
 * A preview has two: VERCEL_URL is the immutable per-commit deployment, and
 * VERCEL_BRANCH_URL is the branch alias that stays put across commits. The
 * alias is the link a person opens, so it leads — but both have to be trusted
 * or whichever one the browser used has its /api/auth calls refused.
 */
function deploymentOrigins(): string[] {
  return [origin(process.env.VERCEL_BRANCH_URL), origin(process.env.VERCEL_URL)].filter(
    (value): value is string => value !== null,
  );
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
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  const origins = [...new Set([...configured, ...deploymentOrigins()])];
  return origins.length ? origins : ["http://localhost:8787"];
}

export function getAuth(): Auth<any> | null {
  if (!process.env.DATABASE_URL || !process.env.BETTER_AUTH_SECRET) return null;
  const database: Database | null = runtimeDatabase();
  if (!database) return null;
  return betterAuth({
    database,
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: authBaseUrl(),
    trustedOrigins: authTrustedOrigins(),
    ...authOptions(),
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    /* PINNED, NOT INHERITED. Every state-changing route here is a cookie-
     * authenticated POST with no CSRF token, so what actually stops a third
     * party site from triggering one is the cookie's SameSite. That was
     * Better Auth's default rather than our decision, and a default is a thing
     * that changes in a minor release without anyone reading the note. */
    advanced: {
      defaultCookieAttributes: { sameSite: "lax", secure: true, httpOnly: true },
    },
  });
}

/** Five new accounts per IP per 10 minutes. Better Auth's own default is 3 per
 *  10 seconds, which still allows a script to create accounts all day. */
export const SIGN_UP_RATE_LIMIT = { window: 600, max: 5 };

/**
 * Who may create an account, and what that account is allowed to do.
 *
 * Signup stays open. A session is not a key to someone else's data: every
 * private store is keyed by `session.user.id`. What signup must not do is
 * hand out a session for an address the person does not control, or let one
 * address create accounts without a limit.
 *
 * `requireEmailVerification` refuses sign-in until the address is confirmed.
 * The confirmation link is sent through `sendAuthEmail`. Accounts that
 * existed before this rule are marked verified by migration 0014.
 */
export function authOptions() {
  return {
    emailAndPassword: {
      enabled: true,
      disableSignUp: false,
      requireEmailVerification: true,
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      sendVerificationEmail: async (data: { user: { email: string }; url: string }) => {
        await sendAuthEmail({
          to: data.user.email,
          subject: "Confirm your LaVega account",
          text: `Confirm your LaVega account:\n${data.url}\n`,
        });
      },
    },
    /* Better Auth's own limiter keys on a client IP it will refuse to guess
     * when X-Forwarded-For has more than one address. That collapses every
     * visitor into one bucket. The signup cap therefore lives on the route
     * (index.ts), which uses the rightmost forwarded address. This switch
     * only turns on Better Auth's short burst limit for sign-in. */
    rateLimit: {
      enabled: true,
      window: 60,
      max: 30,
    },
  };
}

export async function verifiedSession(request: Request) {
  const auth = getAuth();
  if (!auth) return null;
  return auth.api.getSession({ headers: request.headers });
}
