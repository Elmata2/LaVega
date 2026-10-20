import type { Context, MiddlewareHandler } from "hono";

/* Same-origin enforcement for state-changing requests.
 *
 * Everything here is a cookie-authenticated call with no CSRF token, so what
 * actually stops a third-party page from triggering one is the cookie's
 * SameSite — and `lax` still rides along on a top-level GET. That is exactly
 * how `GET /api/n8n/queue` was CSRF-able (security review 2026-10-17, M4): the
 * upstream DELETES what it returns, so an attacker link drained and destroyed
 * the victim's invoice queue.
 *
 * Two independent signals, cheapest first:
 *
 *   `Sec-Fetch-Site` — set by the browser, not scriptable, and impossible for
 *   another site to forge. `cross-site` is the CSRF shape, so it is refused
 *   outright. `same-site`/`same-origin`/`none` pass.
 *
 *   `Origin` — the authoritative signal for every fetch and form POST. It is
 *   accepted only when it equals this request's own origin, is a loopback
 *   origin (`pnpm dev`'s Vite on :5173 calling the server on :8787), or is one
 *   of the deployment's trusted origins. A request that carries neither header
 *   (a non-browser client, an allowlisted machine endpoint) is not a CSRF
 *   vector and passes. */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
/** A loopback origin — localhost or 127.0.0.1, any port. Same rule as index.ts's dev CORS. */
const LOOPBACK_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

/**
 * The origin the browser believes it is talking to, reconstructed from the
 * proxy headers a host platform forwards. `new URL(c.req.url)` alone is wrong
 * behind a TLS-terminating proxy: the function sees `http://` and its internal
 * hostname while the browser sent an `https://…` Origin, so a correct
 * same-origin POST would be refused.
 */
function effectiveOrigin(c: Context): string {
  const url = new URL(c.req.url);
  const proto =
    c.req.header("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(":", "");
  const host =
    c.req.header("x-forwarded-host")?.split(",")[0]?.trim() || c.req.header("host") || url.host;
  return `${proto}://${host}`;
}

function isAllowedOrigin(
  origin: string,
  ownOrigin: string,
  trustedOrigins: ReadonlySet<string>,
): boolean {
  return origin === ownOrigin || LOOPBACK_ORIGIN.test(origin) || trustedOrigins.has(origin);
}

/**
 * Reject cross-site state-changing requests on `/api/*` (and its
 * `/investing/api/*` alias). `trustedOrigins` is the deployment's own list —
 * the same one Better Auth already trusts — so a hosted deploy whose public
 * hostname differs from the function's internal URL still accepts its own app.
 */
export function sameOriginGuard(trustedOrigins: readonly string[] = []): MiddlewareHandler {
  const trusted = new Set(trustedOrigins);
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next();
    if (c.req.header("sec-fetch-site") === "cross-site")
      return c.json({ error: "Cross-site request refused.", code: "cross-site-request" }, 403);
    const origin = c.req.header("origin");
    if (origin && !isAllowedOrigin(origin, effectiveOrigin(c), trusted))
      return c.json({ error: "Cross-site request refused.", code: "cross-site-request" }, 403);
    return next();
  };
}
