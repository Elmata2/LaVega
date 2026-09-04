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
