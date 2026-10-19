import type { Context, MiddlewareHandler } from "hono";
import { verifiedSession } from "./auth.js";

/**
 * The session guard for `/api/*` — and for `/investing/api/*`, which is the
 * same API reached through the investing SPA's own prefix (see
 * `INVESTING_API_ALIAS` below; falling to close that alias is security review
 * 2026-10-17, H1).
 *
 * Until this existed, `verifiedSession` was defined in auth.ts and called from
 * nowhere: Better Auth was wired to Neon but guarded no route, so every API —
 * including the ones that spend the owner's Mistral key and the ones that own
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
  "/api/fx/history", // ECB historical daily rates, currency + date range only, no personal data
  "/api/eb/status", // { configured: bool } only
  "/api/agent/status", // { configured: bool } only
  "/api/n8n/status", // { configured: bool } only
  "/api/card-terms/ingest", // machine endpoint; carries its OWN shared secret
  "/api/cron/investing-sync", // machine endpoint; carries its OWN bearer secret
  "/api/investing/health", // { ok, service } only, no personal data
]);

/* The investing SPA reaches the SAME API surface through `/investing/api/*`:
 * `toInvestingStatic`/`rewriteInvestingRequest` strip `/investing` before the
 * investing app sees the request, so `/investing/api/<ns>/…` is byte-for-byte
 * `/api/<ns>/…`. The guard was mounted on `/api/*` alone, which left that alias
 * entirely unguarded — an anonymous `curl` could read and write the investing
 * API under the local tenant. Mapping the alias onto the canonical path keeps
 * ONE public list instead of a second copy that drifts. */
export const INVESTING_API_ALIAS = "/investing/api";

/** Is `path` part of the API surface this guard owns (canonical or alias)? */
export function isGuardedApiPath(path: string): boolean {
  return (
    path.startsWith("/api/") ||
    path === INVESTING_API_ALIAS ||
    path.startsWith(`${INVESTING_API_ALIAS}/`)
  );
}

export function isPublicApiPath(path: string): boolean {
  const viaAlias = path === INVESTING_API_ALIAS || path.startsWith(`${INVESTING_API_ALIAS}/`);
  const canonical = viaAlias
    ? `/api/${path.slice(INVESTING_API_ALIAS.length).replace(/^\//, "")}`
    : path;
  if (PUBLIC_API_PATHS.has(canonical)) return true;
  /* `/api/auth/*` and `/api/eb/callback` are mounted on `/api/*` only, so under
   * the alias they are not "public" — they are simply not routes at all. */
  if (viaAlias) return false;
  if (canonical.startsWith("/api/auth/")) return true; // how you log in
  /* The bank redirects the user's browser here from its own domain. Whether a
   * session cookie survives that hop is decided by SameSite behaviour we do not
   * control, and a bank connection that breaks on a browser default is worse
   * than one that does not depend on it. This route is not unauthenticated: it
   * requires a `state` this server issued for a signed-in user, unguessable,
   * single-use and valid for minutes, and it takes the user's identity from
   * that row rather than from anything the caller sends. */
  return canonical === "/api/eb/callback";
}

/**
 * Is this a hosted deployment, where the escape hatch below must never apply?
 *
 * `NODE_ENV=production` is what the long-lived Docker/Railway image runs with;
 * Vercel sets `VERCEL_ENV` on every deployment (production and preview alike).
 * Either is a marker that this process serves real users.
 */
export function isHostedDeployment(): boolean {
  return (
    process.env.NODE_ENV === "production" ||
    Boolean(process.env.VERCEL_ENV) ||
    process.env.VERCEL === "1"
  );
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
 *
 * On a hosted deployment the flag is REFUSED. It switches off both guards, so a
 * stray `LAVEGA_ALLOW_UNAUTHENTICATED=1` in a platform's environment UI would
 * publish the vault and the broker API to anyone who finds the URL — a switch
 * whose failure mode is total. A self-host or `pnpm dev` is not a hosted
 * deployment and keeps the escape hatch.
 */
export function guardIsDisabled(): boolean {
  if (process.env.LAVEGA_ALLOW_UNAUTHENTICATED !== "1") return false;
  return !isHostedDeployment();
}

export function apiGuard(): MiddlewareHandler {
  return async (c, next) => {
    if (!isGuardedApiPath(c.req.path)) return next();
    if (isPublicApiPath(c.req.path)) return next();
    /* There is deliberately no `OPTIONS` bypass here anymore. It existed so a
     * CORS preflight — which carries no cookies by definition — was not judged.
     * But a preflight never reaches this middleware: the loopback-only CORS
     * middleware above answers it (204) before the guard runs, and a preflight
     * from anywhere else is a cross-origin caller this API does not serve. A
     * blanket `OPTIONS` pass was latency with no benefit: it let any method-less
     * probe through the one place that is supposed to be closed by default. */
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
