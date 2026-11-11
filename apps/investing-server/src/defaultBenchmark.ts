import { DEFAULT_BENCHMARK_SYMBOL, type BenchmarkSelectionStore } from "@lavega/core";

/**
 * The benchmarks a read measures against. An empty selection is not "compare
 * with nothing": it means the account has not chosen yet, and beta and alpha
 * would stay structurally unavailable. Such an account starts on MSCI World —
 * a global equity index quoted in EUR — until the owner picks another one.
 *
 * The default is applied on read, not written to the store: removing every
 * benchmark returns the account to the default instead of leaving a metric
 * that can never be computed.
 */
export async function effectiveBenchmarkSymbols(
  store: Pick<BenchmarkSelectionStore, "get">,
  tenantId: string,
): Promise<string[]> {
  const { symbols } = await store.get(tenantId);
  return symbols.length > 0 ? [...symbols] : [DEFAULT_BENCHMARK_SYMBOL];
}
