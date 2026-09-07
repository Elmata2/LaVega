/**
 * Tiny in-memory sliding-window rate limiter. `createRateLimiter(max, windowMs)`
 * returns a guard `(key) => boolean` — `true` = allowed, `false` = over the
 * limit for that key within the last `windowMs`. `now` is injectable so tests
 * can advance the clock deterministically.
 *
 * Single-process, single-user personal app: the counts live in a Map that's
 * lost on restart. Good enough to keep a runaway client (or a stuck retry loop)
 * from hammering the paid Anthropic API.
 */
export function createRateLimiter(
  max: number,
  windowMs: number,
  now: () => number = () => Date.now(),
) {
  const hits = new Map<string, number[]>();
  return (key: string): boolean => {
    const t = now();
    const arr = (hits.get(key) ?? []).filter((ts) => t - ts < windowMs);
    if (arr.length >= max) {
      hits.set(key, arr);
      return false;
    }
    arr.push(t);
    hits.set(key, arr);
    return true;
  };
}

/**
 * The bucket a request counts against: one per caller per route.
 *
 * It used to be the route name alone, which made every caller in the world
 * share one bucket. That cut both ways — a stranger could spend 20 requests a
 * minute on the owner's Anthropic key, and those same 20 locked the owner out
 * of his own AI features.
 *
 * `userId` (from the verified session) is preferred because it cannot be
 * forged. Without one — the routes that are open, or local development with the
 * guard stood down — it falls back to the address, taking the RIGHTMOST
 * X-Forwarded-For entry: a client can prepend whatever it likes to that header,
 * and only the entry the nearest proxy appends is not attacker-chosen. Keying
 * on the leftmost would let one client mint a fresh bucket per request.
 */
export function rateLimitKey(route: string, userId: string | undefined, forwardedFor: string | undefined): string {
  if (userId) return `${route}:u:${userId}`;
  const chain = (forwardedFor ?? "").split(",").map((part) => part.trim()).filter(Boolean);
  const nearest = chain.length > 0 ? chain[chain.length - 1] : "unknown";
  return `${route}:ip:${nearest}`;
}
