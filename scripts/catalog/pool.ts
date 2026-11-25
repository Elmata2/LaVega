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

/** Minutes before the deadline at which the per-figure passes stop starting figures. Pass 1 (FX and
 *  interest) must always be written before the workflow step times out; a figure that has started
 *  can still run for several minutes. */
export const EXTRA_PASS_MARGIN_MIN = 20;

/** The deadline of the per-figure passes: the deadline minus the margin, never below half of it.
 *  0 (no deadline) stays 0. */
export function extraPassDeadlineMin(deadlineMin: number): number {
  if (deadlineMin <= 0) return 0;
  return Math.max(deadlineMin - EXTRA_PASS_MARGIN_MIN, Math.floor(deadlineMin / 2));
}

/** Runs `work` over `items` one after the other, asking `shouldContinue` before each. Returns the items
 *  it did not reach. */
export async function forEachWhile<T>(
  items: readonly T[],
  shouldContinue: () => boolean,
  work: (item: T) => Promise<void>,
): Promise<T[]> {
  for (let i = 0; i < items.length; i++) {
    if (!shouldContinue()) return items.slice(i);
    await work(items[i]!);
  }
  return [];
}
