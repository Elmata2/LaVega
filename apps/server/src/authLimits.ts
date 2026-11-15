import { createRateLimiter, clientIp, rateLimitKey, type RateLimiter } from "./agent/rateLimit.js";
import { SIGN_UP_RATE_LIMIT } from "./auth.js";

/* Rate limits for the public auth endpoints that send mail or create accounts.
 *
 * Sign-up was limited; `send-verification-email` and `request-password-reset`
 * were not. Both are open, both send a mail to an address the caller types in,
 * and both answer differently for a known and an unknown address — so they were
 * an account-enumeration oracle AND a way to bomb a stranger's inbox with
 * verification mail (security review 2026-10-17, A1 / #253).
 *
 * Two ceilings, because one is not enough:
 *
 *   per-address — one caller cannot hammer one endpoint (the 5/10min rule
 *   sign-up already had).
 *
 *   global — a caller who rotates `X-Forwarded-For` (or simply opens
 *   connections from many addresses) gets a fresh per-address bucket every
 *   request, so the per-address limit never fires and the Map grows without
 *   bound. This one bucket is shared by EVERY caller, so the endpoint as a
 *   whole cannot be used as an amplifier no matter where the requests come
 *   from. */
export const AUTH_RATE_LIMITED_PATHS = new Set([
  "/api/auth/sign-up/email",
  "/api/auth/send-verification-email",
  "/api/auth/request-password-reset",
]);

/**
 * All callers together may make this many limited auth requests per window
 * (SIGN_UP_RATE_LIMIT.window, 10 minutes). Generous for a real deployment —
 * sign-in itself is not limited here, only the three mail/account endpoints —
 * and small enough that a script cannot mail-bomb from a pool of addresses.
 */
export const AUTH_GLOBAL_MAX = 30;

/** `true` = allowed. Applies to POSTs on the three paths above and nothing else. */
export type PublicAuthLimiter = (method: string, path: string, headers: Headers) => boolean;

export function createPublicAuthLimiter(
  windowMs: number = SIGN_UP_RATE_LIMIT.window * 1000,
  maxPerAddress: number = SIGN_UP_RATE_LIMIT.max,
  globalMax: number = AUTH_GLOBAL_MAX,
  now: () => number = () => Date.now(),
): PublicAuthLimiter {
  const perAddress: RateLimiter = createRateLimiter(maxPerAddress, windowMs, now);
  const global: RateLimiter = createRateLimiter(globalMax, windowMs, now);
  return (method, path, headers) => {
    if (method !== "POST" || !AUTH_RATE_LIMITED_PATHS.has(path)) return true;
    const addressKey = rateLimitKey(path, undefined, clientIp(headers));
    /* Check both ceilings before spending from either, so a refusal costs
     * nothing: a request the per-address bucket refuses must not burn a global
     * unit, and one the global bucket refuses must not burn the address's. */
    if (!global.wouldAllow("auth:all") || !perAddress.wouldAllow(addressKey)) return false;
    global("auth:all");
    perAddress(addressKey);
    return true;
  };
}
