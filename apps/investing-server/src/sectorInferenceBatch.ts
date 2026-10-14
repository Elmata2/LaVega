import type { CurrentPosition } from "@lavega/core";
import type { SectorProfileStore } from "./inMemorySectorProfileStore.js";
import { resolvePortfolioSectors } from "./sectorResolution.js";
import type { SectorClassifier } from "./sectorClassifier.js";

/** Bounds one inference round to this many classifier invocations, so a
 *  portfolio with many unknown symbols can't run one request past a
 *  serverless deadline — the client re-calls for what's left. */
export const SECTOR_INFERENCE_BATCH_SIZE = 10;

/** Bounds the `exclude` list a caller may send: a page session's own
 *  accumulated failed symbols, never an unbounded client-supplied array. */
export const MAX_SECTOR_INFERENCE_EXCLUDE = 200;

export type SectorInferenceBatchInput = {
  tenantId: string;
  /** The caller's already-price-filtered positions (marketValue > 0). */
  priced: readonly CurrentPosition[];
  /** Upper-cased symbols the caller has already seen fail this page session. */
  exclude: ReadonlySet<string>;
  /** Every tenant correction in one read, keyed by upper-cased symbol. */
  corrections: Readonly<Record<string, string>>;
  /** Broker symbol to the Yahoo listing price sync already resolved it to. */
  resolveListing: (symbol: string) => Promise<string | null>;
  store: SectorProfileStore;
  classifier?: SectorClassifier;
  batchSize: number;
};

export type SectorInferenceBatchResult = {
  classified: number;
  failed: number;
  failedSymbols: string[];
  remaining: number;
};

/** Selects and classifies one round's worth of unknown priced symbols. The
 *  batch selection is the whole point: which candidates this round takes,
 *  under what dedupe and exclusion rules, and how "classified" is decided
 *  afterwards. The classifier is optional — without one there is nothing to
 *  run, so the round is a no-op. */
export async function inferSectorBatch(
  input: SectorInferenceBatchInput,
): Promise<SectorInferenceBatchResult> {
  const { priced, exclude, corrections, resolveListing, store, classifier, batchSize } = input;
  if (!classifier) return { classified: 0, failed: 0, failedSymbols: [], remaining: 0 };
  const seen = new Set<string>();
  const candidates: CurrentPosition[] = [];
  /* A renamed holding's lookup key (its price-resolved listing, same as
   * resolveWeights would use), kept per candidate so the classifier isn't
   * asked to reclassify a symbol a provider profile already answers for
   * under its listing, and so "cached this round" below can be read back
   * under the same key the write actually landed on. Computed once here
   * and handed to resolvePortfolioSectors below (rather than re-resolved
   * from tenantId+symbol) so a single PriceStore read decides both this
   * round's candidate list and the round's actual cache key — two reads
   * per candidate could otherwise land on different coverage rows if a
   * price sync updates PriceStore between them, reporting a symbol this
   * round successfully classified as failed. */
  const lookupSymbols = new Map<string, string>();
  /* Two broker symbols resolving to the same listing (a renamed holding
   * held under both its old and new code, or via two brokers) must not
   * both become candidates: resolvePortfolioSectors dedupes its own
   * pending list by raw symbol, not by resolved listing, so both would
   * race sectorStore.get(lookupSymbol) as empty and both would pay for a
   * classification of the same instrument. The second claimant is simply
   * left off `candidates` — once the first's classification lands, the
   * per-position cache check above picks it up next round for free. */
  const seenLookups = new Set<string>();
  for (const position of priced) {
    const key = position.symbol.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    /* A symbol the caller already saw fail this page session (the client
     * fills `exclude` with it) is skipped so the same head-of-line
     * candidates aren't retried forever ahead of ones that might succeed. */
    if (exclude.has(key)) continue;
    if (corrections[key]) continue;
    const lookupSymbol = (await resolveListing(position.symbol)) ?? position.symbol;
    if (await store.get(lookupSymbol)) continue;
    if (seenLookups.has(lookupSymbol)) continue;
    seenLookups.add(lookupSymbol);
    lookupSymbols.set(key, lookupSymbol);
    candidates.push(position);
  }
  const batch = candidates.slice(0, batchSize);
  await resolvePortfolioSectors(batch, {
    store,
    classifier,
    resolveListing: async (symbol) => lookupSymbols.get(symbol.toUpperCase()) ?? symbol,
  });
  /* classified counts symbols actually cached this round (classified or
   * no-match), never batch.length — a classifier failure leaves the
   * symbol uncached, and reporting it as classified anyway is what let
   * the client refresh forever on the same always-failing symbols
   * (#135 final review, C1). The candidate filter above guarantees each
   * batch entry's lookup key was empty before this call, so finding a
   * profile there now means this round wrote it. */
  const cachedThisRound = new Set<string>();
  for (const position of batch) {
    const key = position.symbol.toUpperCase();
    if (await store.get(lookupSymbols.get(key)!)) cachedThisRound.add(key);
  }
  const failedSymbols = batch
    .map((position) => position.symbol.toUpperCase())
    .filter((symbol) => !cachedThisRound.has(symbol));
  return {
    classified: cachedThisRound.size,
    failed: failedSymbols.length,
    failedSymbols,
    remaining: candidates.length - batch.length,
  };
}
