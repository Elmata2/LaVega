/*
 * Per-token rate limit for `/mcp` (ADR 0012 §6 "per-token rate limit").
 *
 * A fixed window in process memory, the same shape as the agent routes'
 * limiter. This is deliberately NOT the shared Neon limiter: `/mcp` must work on
 * a no-database install too, and the limit's job is to stop a runaway agent
 * loop, not to be a billing ceiling. On a multi-instance deployment the real
 * ceiling is the per-instance limit times the instance count — recorded as a
 * carried finding in docs/investing/MCP.md rather than hidden.
 */

export type McpRateLimiter = {
  /** Consume one unit for `key`; false means over the limit. */
  consume(key: string, at: number): boolean;
};

export const MCP_RATE_LIMIT_DEFAULT_PER_MINUTE = 60;

export function createMcpRateLimiter(
  options: { max?: number; windowMs?: number } = {},
): McpRateLimiter {
  const max = Math.max(1, Math.floor(options.max ?? MCP_RATE_LIMIT_DEFAULT_PER_MINUTE));
  const windowMs = Math.max(1_000, options.windowMs ?? 60_000);
  const buckets = new Map<string, { windowStart: number; hits: number }>();

  return {
    consume(key, at) {
      const windowStart = Math.floor(at / windowMs) * windowMs;
      /* Keep the map from growing forever without a timer: a stray key is
       * dropped once the map is large and its window has passed. */
      if (buckets.size > 10_000) {
        for (const [bucketKey, bucket] of buckets)
          if (bucket.windowStart < windowStart) buckets.delete(bucketKey);
      }
      const bucket = buckets.get(key);
      if (!bucket || bucket.windowStart !== windowStart) {
        buckets.set(key, { windowStart, hits: 1 });
        return true;
      }
      if (bucket.hits >= max) return false;
      bucket.hits += 1;
      return true;
    },
  };
}
