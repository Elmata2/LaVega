import type { Context, MiddlewareHandler } from "hono";
import { verifiedSession } from "./auth.js";

/**
 * The session guard for /api/*.
 *
 * Until this existed, `verifiedSession` was defined in auth.ts and called from
 * nowhere: Better Auth was wired to Neon but guarded no route, so every API —
 * including the ones that spend the owner's Anthropic key and the ones that own
 * the broker vault — answered any stranger with a `curl`. CORS did not cover it;
 * CORS stops browsers, not clients.
 *
 * Closed by default. A request is let through only if it is on the public list
 * below, or it carries a verified session. When auth is NOT configured
 * (`DATABASE_URL`/`BETTER_AUTH_SECRET` absent) `verifiedSession` returns null
 * and everything non-public is refused — that is the intended direction to fail.
 */

/* Public because they answer with no personal data and the app polls them
 * before anyone is logged in (the login screen itself needs /api/auth). */
const PUBLIC_API_PATHS = new Set([
  "/api/rates", // public NL savings rates
  "/api/fx/rate", // ECB mid-market rates
  "/api/eb/status", // { configured: bool } only
  "/api/agent/status", // { configured: bool } only
  "/api/card-terms/ingest", // machine endpoint; carries its OWN shared secret
]);

export function isPublicApiPath(path: string): boolean {
  if (path.startsWith("/api/auth/")) return true; // how you log in
  /* The bank redirects the user's browser here from its own domain. Whether a
   * session cookie survives that hop is decided by SameSite behaviour we do not
   * control, and a bank connection that breaks on a browser default is worse
   * than one that does not depend on it. This route is not unauthenticated: it
   * requires a `state` this server issued for a signed-in user, unguessable,
   * single-use and valid for minutes, and it takes the user's identity from
   * that row rather than from anything the caller sends. */
  if (path === "/api/eb/callback") return true;
  return PUBLIC_API_PATHS.has(path);
}

/**
 * Is the guard allowed to stand down? Only when explicitly told to, and the
 * default is "no" — a flag that defaults to open would reproduce the bug this
 * middleware exists to fix.
 *
 * `pnpm dev` needs it: Vite serves the app on :5173 while the server runs on
 * :8787, which makes every call cross-origin, and a cross-origin fetch does not
 * send the session cookie unless it asks (`credentials: "include"`), which none
 * of the client's fetches do. Production serves the app from this same origin,
 * where cookies are sent by default, and sets nothing.
 */
export function guardIsDisabled(): boolean {
  return process.env.LAVEGA_ALLOW_UNAUTHENTICATED === "1";
}

export function apiGuard(): MiddlewareHandler {
  return async (c, next) => {
    if (!c.req.path.startsWith("/api/")) return next();
    if (isPublicApiPath(c.req.path)) return next();
    // A CORS preflight carries no cookies by definition, so judging it would
    // refuse every cross-origin POST before the real request could identify
    // itself. The real request that follows is still guarded.
    if (c.req.method === "OPTIONS") return next();
    if (guardIsDisabled()) return next();

    const session = await verifiedSession(c.req.raw);
    if (!session) return c.json({ error: "unauthorized" }, 401);
    setSessionUserId(c, (session as { user?: { id?: string } }).user?.id);
    return next();
  };
}

/* The authenticated user, for anything downstream that needs to attribute a
 * request to a person rather than to a spoofable header (the rate limiter). */
export function setSessionUserId(c: Context, id: string | undefined): void {
  if (id) (c as unknown as { set(k: string, v: unknown): void }).set("lavegaUserId", id);
}

export function sessionUserId(c: Context): string | undefined {
  return (c as unknown as { get(k: string): unknown }).get("lavegaUserId") as string | undefined;
}
