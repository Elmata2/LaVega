/** Runs `worker` over `items` with at most `limit` at once. Items start in order.
 *  If a worker throws, nothing new starts, the running ones settle, and the first
 *  error is thrown. When `shouldStart` returns false nothing new starts either; the
 *  running ones settle and the pool resolves. */
export async function runPool<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>,
  shouldStart?: () => boolean,
): Promise<void> {
  let next = 0;
  let failed = false;
  let firstError: unknown;
  const lane = async (): Promise<void> => {
    while (!failed && next < items.length && (shouldStart?.() ?? true)) {
      const index = next++;
      try {
        await worker(items[index]!, index);
      } catch (e) {
        if (!failed) {
          failed = true;
          firstError = e;
        }
      }
    }
  };
  const lanes = Math.max(1, Math.min(Math.floor(limit), items.length));
  await Promise.all(Array.from({ length: lanes }, lane));
  if (failed) throw firstError;
}

/** Why the run should stop starting new products, or null. A deadline of 0 and no ceiling disable their checks. */
export function stopReason(
  spentUsd: number,
  maxUsd: number | null,
  elapsedMin: number,
  deadlineMin: number,
): null | "cost ceiling" | "time limit" {
  if (maxUsd && spentUsd >= maxUsd) return "cost ceiling";
  if (deadlineMin > 0 && elapsedMin >= deadlineMin) return "time limit";
  return null;
}
