import { lookupProviderTerms, type ProviderTerms, type TravelInput } from "./agent/travel.js";

/* Provider card terms — the SAME shape of thing as the savings benchmark in
 * rates.ts, and cached the same way, for the same reason: "Revolut charges 0%
 * up to EUR1000/month" is PUBLIC information, identical for every user and
 * unrelated to anyone's accounts. Looking it up per user, on demand, at the
 * exact moment someone wants an answer was the worst possible timing — the
 * lookup takes 40s-5min, which no button can wait for.
 *
 * So: ask for what you need, get whatever is already known INSTANTLY, and any
 * gaps are filled by a background lookup that the next request picks up. */

const TTL_MS = 7 * 24 * 60 * 60 * 1000; // card tariffs change rarely; a week is plenty
const MAX_TRACKED = 60;

type Entry = { terms: ProviderTerms; at: number };

const cache = new Map<string, Entry>();
const inFlight = new Set<string>();

/** Cache key: the provider as asked, per home country + destination currency —
 *  the same brand charges differently per market, so those are part of identity. */
function keyOf(provider: string, homeCountry: string, currency: string): string {
  return `${homeCountry}|${currency}|${provider.trim().toLowerCase()}`;
}

function fresh(e: Entry | undefined): boolean {
  return e != null && Date.now() - e.at < TTL_MS;
}

/** Does this reply contain anything we can actually rank with? A note alone is
 *  not an answer — the ranking needs a number. */
function usable(t: ProviderTerms): boolean {
  return t.fxFeePct !== undefined || t.cashbackPct !== undefined
    || t.pointsPerEuro !== undefined || t.transferFreeViaIdeal !== undefined;
}

/** Start a lookup for one provider, unless one is already running for it. The
 *  promise is deliberately not awaited by the caller: the request returns now
 *  and the answer lands in the cache for the next one. A failure is swallowed
 *  on purpose — the provider simply stays unknown, which the UI already shows
 *  honestly ("voorwaarden nog onbekend") and the owner can type in himself. */
function startLookup(provider: string, base: Omit<TravelInput, "providers">, apiKey: string, deps: Deps): void {
  const key = keyOf(provider, base.homeCountry, base.currency);
  if (inFlight.has(key) || fresh(cache.get(key))) return;
  inFlight.add(key);
  void (async () => {
    try {
      const found = await (deps.lookup ?? lookupProviderTerms)({ ...base, providers: [provider] }, apiKey);
      // Only cache an answer that actually carries a NUMBER. A reply with just
      // a note ("couldn't verify — the search tool hit its limit") is a failed
      // lookup wearing an answer's clothes; caching it for a week would lock in
      // that failure and stop us retrying. Better to leave it unknown and let
      // the next ask try again.
      if (found.length > 0 && usable(found[0])) {
        // Evict the oldest entry rather than growing without bound.
        if (cache.size >= MAX_TRACKED) {
          const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
          if (oldest) cache.delete(oldest[0]);
        }
        cache.set(key, { terms: found[0], at: Date.now() });
      }
    } catch {
      /* stays unknown; the UI says so and the owner can correct it */
    } finally {
      inFlight.delete(key);
    }
  })();
}

export type Deps = { lookup?: typeof lookupProviderTerms };

export type CardTermsResult = {
  /** Terms we already know, ready to use right now. */
  terms: ProviderTerms[];
  /** Providers whose lookup is running — ask again shortly. */
  pending: string[];
};

/** Answer immediately with what is cached, and kick off background lookups for
 *  the rest. Never blocks on the model, so this route can't hit the 100s
 *  Cloudflare ceiling that killed the synchronous version. */
export function getCardTerms(input: TravelInput, apiKey: string, deps: Deps = {}): CardTermsResult {
  const { providers, ...base } = input;
  const terms: ProviderTerms[] = [];
  const pending: string[] = [];
  for (const provider of providers) {
    const hit = cache.get(keyOf(provider, base.homeCountry, base.currency));
    if (fresh(hit)) {
      terms.push(hit!.terms);
      continue;
    }
    // Stale-while-revalidate, the same fallback order rates.ts uses (fresh ->
    // live -> last good). An expired entry is still a real tariff and beats
    // showing "unknown": hand it over NOW and refresh it in the background. A
    // week-old fee is almost certainly still right; a blank one is never right.
    startLookup(provider, base, apiKey, deps);
    if (hit) terms.push(hit.terms);
    else pending.push(provider);
  }
  return { terms, pending };
}

/** Test seam: drop everything (there is no cross-request state to preserve). */
export function resetCardTerms(): void {
  cache.clear();
  inFlight.clear();
}
