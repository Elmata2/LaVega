/** A source for one market-data capability. Higher priority wins. */
export type Provider<Request, Result> = {
  sourceKey: string;
  priority: number;
  get(request: Request): Promise<Result | null>;
};

export type ProviderResult<Result> = { sourceKey: string; value: Result };

export type CachedRecord<Value> = {
  key: string;
  sourceKey: string;
  value: Value;
  fetchedAt: number;
  staleAt: number;
  expiresAt: number;
};

export type CacheState = "fresh" | "stale" | "expired";

export function cacheState(record: CachedRecord<unknown>, now: number): CacheState {
  if (now < record.staleAt) return "fresh";
  if (now < record.expiresAt) return "stale";
  return "expired";
}

/** Lane results carry their problems; a non-empty array means the source fell short. */
export function hasProblems(value: { problems?: unknown }): boolean {
  return Array.isArray(value.problems) && value.problems.length > 0;
}

/** Query providers in priority order. A failed source cannot break its lane. */
export async function firstProviderResult<Request, Result>(
  providers: readonly Provider<Request, Result>[],
  request: Request,
  log: (sourceKey: string, error: unknown) => void = () => undefined,
  hasProblems: (result: Result) => boolean = () => false,
  failureResult?: (problems: string[]) => Result,
): Promise<ProviderResult<Result> | null> {
  const ordered = [...providers].sort((a, b) => b.priority - a.priority);
  let problemResult: ProviderResult<Result> | null = null;
  const problems: string[] = [];
  for (const provider of ordered) {
    try {
      const value = await provider.get(request);
      if (value !== null) {
        const result = { sourceKey: provider.sourceKey, value };
        if (hasProblems(value)) {
          problemResult = result;
          problems.push(...providerProblems(value));
          continue;
        }
        return problems.length > 0 ? withProviderProblems(result, problems) : result;
      }
    } catch (error) {
      log(provider.sourceKey, error);
      problems.push(`${provider.sourceKey}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (problemResult && problems.length > 0) return withProviderProblems(problemResult, problems);
  return failureResult && problems.length > 0 ? { sourceKey: "router", value: failureResult([...new Set(problems)]) } : null;
}

function providerProblems(value: unknown): string[] {
  const problems = (value as { problems?: unknown }).problems;
  return Array.isArray(problems) ? problems.filter((problem): problem is string => typeof problem === "string") : [];
}

function withProviderProblems<Result>(result: ProviderResult<Result>, problems: string[]): ProviderResult<Result> {
  if (result.value === null || typeof result.value !== "object" || Array.isArray(result.value)) return result;
  const value = result.value as { problems?: unknown } & Record<string, unknown>;
  const ownProblems = Array.isArray(value.problems) ? value.problems.filter((problem): problem is string => typeof problem === "string") : [];
  return { ...result, value: { ...value, problems: [...new Set([...problems, ...ownProblems])] } as Result };
}

/** Sort cached values without dropping expired values; callers may use them as a last resort. */
export function sortCachedRecords<Value>(
  records: readonly CachedRecord<Value>[],
  priorities: Readonly<Record<string, number>>,
  now: number,
): CachedRecord<Value>[] {
  const stateRank: Record<CacheState, number> = { fresh: 0, stale: 1, expired: 2 };
  return [...records].sort((a, b) =>
    stateRank[cacheState(a, now)] - stateRank[cacheState(b, now)]
    || (priorities[b.sourceKey] ?? 0) - (priorities[a.sourceKey] ?? 0)
    || b.fetchedAt - a.fetchedAt,
  );
}
