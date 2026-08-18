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

/** Query providers in priority order. A failed source cannot break its lane. */
export async function firstProviderResult<Request, Result>(
  providers: readonly Provider<Request, Result>[],
  request: Request,
  log: (sourceKey: string, error: unknown) => void = () => undefined,
): Promise<ProviderResult<Result> | null> {
  const ordered = [...providers].sort((a, b) => b.priority - a.priority);
  for (const provider of ordered) {
    try {
      const value = await provider.get(request);
      if (value !== null) return { sourceKey: provider.sourceKey, value };
    } catch (error) {
      log(provider.sourceKey, error);
    }
  }
  return null;
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

export type MarketDataProviders<PriceRequest, Price, FxRequest, Fx, IdentifierRequest, Identifier> = {
  price: readonly Provider<PriceRequest, Price>[];
  fx: readonly Provider<FxRequest, Fx>[];
  identifier: readonly Provider<IdentifierRequest, Identifier>[];
};

export class MarketDataRouter<PriceRequest, Price, FxRequest, Fx, IdentifierRequest, Identifier> {
  constructor(
    private readonly providers: MarketDataProviders<PriceRequest, Price, FxRequest, Fx, IdentifierRequest, Identifier>,
    private readonly log: (sourceKey: string, error: unknown) => void = () => undefined,
  ) {}

  getPrice(request: PriceRequest): Promise<ProviderResult<Price> | null> {
    return firstProviderResult(this.providers.price, request, this.log);
  }

  getFx(request: FxRequest): Promise<ProviderResult<Fx> | null> {
    return firstProviderResult(this.providers.fx, request, this.log);
  }

  mapIdentifier(request: IdentifierRequest): Promise<ProviderResult<Identifier> | null> {
    return firstProviderResult(this.providers.identifier, request, this.log);
  }
}
