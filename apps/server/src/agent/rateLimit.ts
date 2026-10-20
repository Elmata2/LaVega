export type RateLimiter = (key: string) => boolean;

/**
 * Hard ceiling on tracked keys.
 *
 * Without one, `hits` was a process-lifetime Map an anonymous caller grew for
 * free: every spoofed `X-Forwarded-For` minted a key that lived forever, and
 * the guard scanned the WHOLE Map on every request to find the stale ones —
 * O(n) work per request, so the cost of an attack rose with the damage it had
 * already done. The old sweep is gone; eviction is bounded instead.
 */
const MAX_TRACKED_KEYS = 10_000;

/**
 * How many older entries one call may drop while pruning. Bounded, so the cost
 * per request is O(1) amortised rather than O(keys): stale keys drain a few at
 * a time instead of all at once on whichever unlucky request notices them.
 */
const PRUNE_PER_CALL = 4;

/**
 * Tiny in-memory sliding-window rate limiter. `createRateLimiter(max, windowMs)`
 * returns a guard `(key) => boolean` — `true` = allowed, `false` = over the
 * limit for that key within the last `windowMs`. `now` is injectable so tests
 * can advance the clock deterministically. The Map stays private to the closure.
 *
 * Keys are kept in least-recently-used order (each call re-inserts its own key),
 * so the entry at the front is the one least likely to be needed again — that
 * is what both the stale prune and the hard-cap eviction drop. The Map is capped
 * at MAX_TRACKED_KEYS; a caller who fills it evicts its own oldest buckets, which
 * is why a per-key limit alone cannot bound a rotating-IP caller (see the global
 * cap on the sign-up path, authLimits.ts).
 *
 * Single-process, single-user personal app: the counts live in a Map that's
 * lost on restart. Good enough to keep a runaway client (or a stuck retry loop)
 * from hammering the paid Mistral API.
 */
export function createRateLimiter(
  max: number,
  windowMs: number,
  now: () => number = () => Date.now(),
): RateLimiter {
  const hits = new Map<string, number[]>();

  /* Drop entries from the front until we hit a live one and are under the cap.
   * Bounded by PRUNE_PER_CALL + however far over the cap we are, never the
   * whole Map. */
  const prune = (t: number): void => {
    let dropped = 0;
    for (const [k, arr] of hits) {
      if (hits.size <= MAX_TRACKED_KEYS && dropped >= PRUNE_PER_CALL) break;
      if (hits.size > MAX_TRACKED_KEYS || t - arr[arr.length - 1]! >= windowMs) {
        hits.delete(k);
        dropped++;
        continue;
      }
      // Front is still live and we are under the cap: in LRU order everything
      // behind it is newer, so there is nothing older left to drop.
      break;
    }
  };

  const guard = (key: string): boolean => {
    const t = now();
    prune(t);
    const existing = hits.get(key);
    // Re-insert on every call so Map order is last-use order, not insertion
    // order — otherwise eviction would drop the busiest buckets first.
    if (existing !== undefined) hits.delete(key);
    const arr = (existing ?? []).filter((ts) => t - ts < windowMs);
    if (arr.length >= max) {
      hits.set(key, arr);
      return false;
    }
    arr.push(t);
    hits.set(key, arr);
    prune(t);
    return true;
  };
  return guard;
}

/** A header bag with a case-insensitive `get`. `Headers` and Hono's `c.req.header` both fit. */
export type HeaderBag = { get(name: string): string | null | undefined };

/**
 * The caller's address, taken from the header the platform's edge actually sets.
 *
 * `X-Forwarded-For` is a LIST a caller can prepend to. Only the entry the
 * nearest proxy appends is not attacker-chosen, which is why the old rule took
 * the RIGHTMOST — but that still trusted a header nothing verifies, and a
 * rotating value minted a fresh rate-limit bucket per request.
 *
 * `x-real-ip` is set (overwritten) by Vercel and Railway, so it wins.
 * `cf-connecting-ip` is only trustworthy when Cloudflare actually proxies the
 * app; on any other host a caller sends it themselves and picks their own
 * bucket. It is therefore read first only when `LAVEGA_TRUST_CF_CONNECTING_IP=1`
 * says the deployment sits behind Cloudflare, and ignored otherwise. XFF is the
 * last fallback, and then only its rightmost entry.
 */
export function clientIp(headers: HeaderBag): string {
  const trusted =
    process.env.LAVEGA_TRUST_CF_CONNECTING_IP === "1"
      ? ["cf-connecting-ip", "x-real-ip"]
      : ["x-real-ip"];
  for (const name of trusted) {
    const value = headers.get(name)?.trim();
    if (value) return value;
  }
  const chain = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return chain.length > 0 ? chain[chain.length - 1]! : "unknown";
}

/**
 * The bucket a request counts against: one per caller per route.
 *
 * It used to be the route name alone, which made every caller in the world
 * share one bucket. That cut both ways — a stranger could spend 20 requests a
 * minute on the owner's Mistral key, and those same 20 locked the owner out
 * of his own AI features.
 *
 * `userId` (from the verified session) is preferred because it cannot be
 * forged. Without one — the routes that are open, or local development with the
 * guard stood down — it falls back to `ip`, which callers resolve through
 * `clientIp` above.
 */
export function rateLimitKey(
  route: string,
  userId: string | undefined,
  ip: string | undefined,
): string {
  if (userId) return `${route}:u:${userId}`;
  return `${route}:ip:${ip?.trim() || "unknown"}`;
}
