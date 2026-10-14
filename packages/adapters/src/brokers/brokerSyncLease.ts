import { DateTime, Option } from "effect";

/**
 * A lease is stale once its heartbeat is strictly older than the cutoff.
 *
 * A heartbeat exactly at the cutoff is still live, so a slow-but-alive owner
 * keeps the broker through a tie and only a strictly later cutoff takes it
 * over. Every store compares through this one predicate, so the file adapter
 * cannot drift from the memory and SQL ones on the boundary. An unparseable
 * timestamp reads as not stale, as `Date.parse` did before this was shared.
 */
export function isBrokerLeaseStale(heartbeatAt: string, staleBefore: string): boolean {
  const heartbeat = DateTime.make(heartbeatAt);
  const cutoff = DateTime.make(staleBefore);
  return (
    Option.isSome(heartbeat) &&
    Option.isSome(cutoff) &&
    DateTime.isLessThan(heartbeat.value, cutoff.value)
  );
}
