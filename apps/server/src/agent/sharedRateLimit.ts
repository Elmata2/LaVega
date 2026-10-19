import { createHash } from "node:crypto";
import { createRateLimitRepository, type Database } from "@lavega/database";
import { runtimeDatabase } from "@lavega/investing-server/src/credentialStore.js";
import { createRateLimiter, type RateLimiter } from "./rateLimit.js";

/*
 * One limiter that every serverless instance shares (#246, security review
 * 2026-10-17 M8). The in-process `createRateLimiter` in rateLimit.ts remains
 * the fallback and the only store a deployment without DATABASE_URL has.
 *
 * The seam is deliberately one method. A caller asks "may this key spend one
 * unit now", and both implementations answer the same question. Nothing above
 * this line branches on which one is in use.
 */

export type RateLimitStore = {
  readonly kind: "memory" | "postgres";
  /** Consume one unit for `key`; `true` = still within the limit. */
  hit(key: string): Promise<boolean>;
};

/** The bounded in-process guard from #238, behind the seam. */
export function memoryRateLimitStore(
  max: number,
  windowMs: number,
  now: () => number = () => Date.now(),
): RateLimitStore {
  let at = now();
  const limit: RateLimiter = createRateLimiter(max, windowMs, () => at);
  return {
    kind: "memory",
    async hit(key) {
      at = now();
      return limit(key);
    },
  };
}

/**
 * The bucket key as it reaches the table. A digest, so no address or user id is
 * stored in the clear, and every key has one fixed length. It is a pseudonym,
 * not anonymisation: an address is enumerable, so this protects against casual
 * reading of the table, not against someone who already has the database.
 */
export function hashBucketKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function postgresRateLimitStore(
  db: Database,
  max: number,
  windowMs: number,
  now: () => number = () => Date.now(),
): RateLimitStore {
  const repository = createRateLimitRepository(db, { max, windowMs });
  return {
    kind: "postgres",
    hit: (key) => repository.consume(hashBucketKey(key), now()),
  };
}

export type SharedRateLimiter = (key: string) => Promise<boolean>;

export type SharedRateLimiterOptions = {
  max: number;
  windowMs: number;
  /** The request's pool, or null when this deployment has no database. */
  database?: () => Database | null;
  now?: () => number;
  /** Called at most once a minute while the shared store is unavailable, and
   *  once a minute while there is no database. Defaults to `console.warn`. */
  report?: (message: string, error?: unknown) => void;
};

/** After a failure, skip the shared store for this long. Without it a Neon
 *  outage would add its connect timeout to every AI request before the local
 *  fallback even ran. */
const RETRY_AFTER_MS = 30_000;
const WARN_INTERVAL_MS = 60_000;

/**
 * A limiter whose ceiling holds across instances.
 *
 * With a database it counts in Postgres. Without one, or when Postgres throws,
 * it counts in the process-local Map and says so, at most once a minute. That
 * is deliberate and it is a fallback, not a silent second mode:
 *
 *  - fail closed (503 on every AI route while Neon is down) adds an outage the
 *    app does not need. These routes already fail closed at the budget check,
 *    which reads the same Neon, so a limiter outage can never open the spend
 *    tap: requireBudget() answers 503 before any model call.
 *  - fail open (allow everything) would remove the ceiling silently. The local
 *    guard keeps a real, if per-instance, ceiling in place and the warning
 *    names what was lost.
 *
 * So: fail open to the bounded local guard. Never to unlimited. A failure also
 * stands the shared store down for RETRY_AFTER_MS per process, so a dead
 * database costs one timeout, not one per request.
 */
export function createSharedRateLimiter(options: SharedRateLimiterOptions): SharedRateLimiter {
  const database = options.database ?? runtimeDatabase;
  const local = memoryRateLimitStore(options.max, options.windowMs, options.now);
  const report =
    options.report ??
    ((message: string, error?: unknown) => {
      const detail =
        error === undefined ? "" : ` (${error instanceof Error ? error.message : String(error)})`;
      console.warn(`agent/rateLimit: ${message}${detail}`);
    });
  let noDatabaseWarnedAt = Number.NEGATIVE_INFINITY;
  let failureWarnedAt = Number.NEGATIVE_INFINITY;
  let retryAt = 0;

  return async (key) => {
    const db = database();
    if (!db) {
      if (Date.now() - noDatabaseWarnedAt >= WARN_INTERVAL_MS) {
        noDatabaseWarnedAt = Date.now();
        report("no DATABASE_URL — the rate limit is per-process, not shared across instances");
      }
      return local.hit(key);
    }
    if (Date.now() < retryAt) return local.hit(key);
    try {
      return await postgresRateLimitStore(db, options.max, options.windowMs, options.now).hit(key);
    } catch (error) {
      retryAt = Date.now() + RETRY_AFTER_MS;
      if (Date.now() - failureWarnedAt >= WARN_INTERVAL_MS) {
        failureWarnedAt = Date.now();
        report("shared store failed — falling back to the per-process limit", error);
      }
      return local.hit(key);
    }
  };
}
