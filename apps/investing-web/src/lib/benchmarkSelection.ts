import { MAX_BENCHMARKS, type BenchmarkInstrument } from "@lavega/core";
import { DASHBOARD_REFRESH_EVENT, requestRefresh } from "./syncSession";

/** The server's answer to a benchmark search: what matched, whether those
 *  matches are curated suggestions instead of live Yahoo results, and any
 *  problems the search itself could not turn into results. */
export type BenchmarkSearchPayload = {
  results: BenchmarkInstrument[];
  fallback: boolean;
  problems: string[];
};

/** Google-style "no consent, no fetch": the server answers 428 instead of
 *  searching. The message is user-facing, so the card can show it as-is. */
export const BENCHMARK_CONSENT_MESSAGE =
  "Yahoo Finance consent is required before you can search benchmarks. Allow Yahoo Finance, then try again.";

export const BENCHMARK_SEARCH_FAILED_MESSAGE = "Benchmark search failed. Try again.";
export const BENCHMARK_SAVE_FAILED_MESSAGE = "Benchmark selection could not be saved.";

export class BenchmarkConsentError extends Error {
  constructor() {
    super(BENCHMARK_CONSENT_MESSAGE);
    this.name = "BenchmarkConsentError";
  }
}

async function problemsFrom(response: Response): Promise<string[]> {
  const payload = (await response.json().catch(() => null)) as { problems?: unknown } | null;
  return readableProblems(payload?.problems);
}

function readableProblems(problems: unknown): string[] {
  return Array.isArray(problems)
    ? problems.filter((problem): problem is string => typeof problem === "string" && problem !== "")
    : [];
}

/** GET /api/investing/benchmarks/search?q=… — a Yahoo consent gap surfaces as
 *  BenchmarkConsentError, every other non-OK answer as its readable reason. */
export async function searchBenchmarks(
  query: string,
  signal?: AbortSignal,
): Promise<BenchmarkSearchPayload> {
  const response = await fetch(`/api/investing/benchmarks/search?q=${encodeURIComponent(query)}`, {
    signal,
  });
  if (response.status === 428) throw new BenchmarkConsentError();
  if (!response.ok) {
    const problems = await problemsFrom(response);
    throw new Error(problems[0] ?? BENCHMARK_SEARCH_FAILED_MESSAGE);
  }
  const payload = (await response
    .json()
    .catch(() => null)) as Partial<BenchmarkSearchPayload> | null;
  return {
    results: Array.isArray(payload?.results) ? payload.results : [],
    fallback: payload?.fallback === true,
    problems: readableProblems(payload?.problems),
  };
}

/** PUT /api/investing/benchmarks with the whole selection, so add and remove
 *  share one save path. Duplicates and more than MAX_BENCHMARKS symbols are
 *  rejected before any request. On success the dashboard is invalidated and
 *  price sync is continued, exactly like the comparison chart's save. */
export async function saveBenchmarkSymbols(symbols: readonly string[]): Promise<void> {
  const trimmed = symbols.map((symbol) => symbol.trim()).filter(Boolean);
  const unique = [...new Set(trimmed)];
  if (unique.length !== trimmed.length) throw new Error("A benchmark can only be selected once.");
  if (unique.length > MAX_BENCHMARKS)
    throw new Error(`Choose at most ${MAX_BENCHMARKS} benchmarks.`);

  const response = await fetch("/api/investing/benchmarks", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ symbols: unique }),
  });
  if (!response.ok) {
    const problems = await problemsFrom(response);
    throw new Error(problems[0] ?? BENCHMARK_SAVE_FAILED_MESSAGE);
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(DASHBOARD_REFRESH_EVENT));
  /* A newly chosen benchmark has no prices yet. The server only fetches them
   * while a request is in flight, so the page asks for them. */
  await requestRefresh();
}
