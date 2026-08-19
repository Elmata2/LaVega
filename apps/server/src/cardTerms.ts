import { comparisonTermsFor, isCovered, type BankNlTable, type CatalogEntry } from "@lavega/core";
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

/** WHERE a figure came from, ordered by how precise that source is. This is the
 *  precedence ladder, and it is the whole reason the comparison table can be
 *  trusted without swamping better data:
 *
 *  · `user`   — the owner's own correction. NOT in this cache at all: user facts
 *               live in his vault and `upsertFacts` in core refuses to let any
 *               agent-sourced fact overwrite one. Nothing served from here can
 *               reach him without passing that rule first, so his word wins
 *               structurally rather than by convention.
 *  · provider — the provider's OWN tariff page, fetched from a known URL by the
 *               n8n workflow (`ingestCardTerms`). The most precise thing there is.
 *  · comparison — bank.nl's koersopslag table. One step removed from the source,
 *               but curated, dated, and it covers banks that block us outright.
 *  · agent    — Claude + web search. Last, because its weak step was never
 *               reading a tariff but FINDING one: Revolut kept coming back empty
 *               while ING, ABN and Amex succeeded.
 *
 *  A write is accepted when it is at least as precise as what is already there,
 *  or when what is there has EXPIRED — a stale precise figure is not "fresher",
 *  and refusing to refresh it would freeze a wrong number in place forever. */
export type TermsSource = "provider" | "comparison" | "agent";
const PRECISION: Record<TermsSource, number> = { provider: 3, comparison: 2, agent: 1 };

type Entry = {
  terms: ProviderTerms;
  at: number;
  source: TermsSource;
  /** An agent lookup has already run for this key in this TTL, whatever it
   *  returned. Without this, a provider the agent has no cashback figure for
   *  would be re-asked on every single request, forever. */
  agentTried?: boolean;
};

const cache = new Map<string, Entry>();
const inFlight = new Set<string>();
const comparisonInFlight = new Set<string>();

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
  return t.fxFeePct !== undefined || t.convertFeePct !== undefined || t.cashbackPct !== undefined
    || t.pointsPerEuro !== undefined || t.transferFreeViaIdeal !== undefined;
}

/** Drop keys whose value is `undefined` — the lookup builds every field and
 *  leaves the unverified ones undefined, and "unverified" must not erase a
 *  figure another source already established. */
function stated(t: ProviderTerms): Partial<ProviderTerms> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(t)) if (v !== undefined) out[k] = v;
  return out as Partial<ProviderTerms>;
}

/** THE one path a figure takes into the cache — the ladder above is enforced
 *  here so no caller can skip it.
 *
 *  Fields the incoming row does NOT state are kept from what is already stored:
 *  bank.nl publishes a koersopslag and nothing else, so letting it land would
 *  otherwise wipe a cashback the agent had found. The entry's `source` becomes
 *  that of the most recent accepted write. */
/** How old a stored figure may be before a LESS precise but newer one may
 *  replace it. Alexander's objection, and he is right: "we cannot accept a
 *  7-month-old information gap in today's economy". A koersopslag checked in
 *  January is not more trustworthy than one found this morning merely because
 *  its source is tidier. Precision decides between figures of similar age;
 *  beyond this gap, age decides. */
const STALE_GAP_MS = 30 * 24 * 60 * 60 * 1000;

/** When the figure was true, as best we know: the source's own stated check
 *  date if it has one, else when we stored it. bank.nl stamps its rows; an
 *  agent lookup is by definition as of now. */
function figureDate(e: Entry): number {
  const stated = e.terms.checkedAt ? Date.parse(e.terms.checkedAt) : NaN;
  return Number.isFinite(stated) ? stated : e.at;
}

function write(key: string, terms: ProviderTerms, source: TermsSource): boolean {
  const prev = cache.get(key);
  const incomingDate = terms.checkedAt && Number.isFinite(Date.parse(terms.checkedAt))
    ? Date.parse(terms.checkedAt)
    : Date.now();
  // Age beats precision once the gap is wide enough. Without this the ladder
  // says a tidy source wins forever, and a stale figure freezes in place -
  // which is exactly how bank.nl's January table would have overwritten a
  // lookup done today.
  if (prev && fresh(prev)) {
    const gap = incomingDate - figureDate(prev); // positive = the incoming figure is newer
    // Much OLDER: refused however tidy its source. This is the rule that stops
    // bank.nl's January table from overwriting a lookup done this morning.
    if (gap < -STALE_GAP_MS) return false;
    // Much NEWER: accepted even from a less precise source, because a current
    // figure beats a stale one for a fee that moves.
    // Similar age: precision decides, as before.
    if (gap <= STALE_GAP_MS && PRECISION[source] < PRECISION[prev.source]) return false;
  }
  if (!prev && cache.size >= MAX_TRACKED) {
    // Evict the oldest entry rather than growing without bound.
    const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  // Merge the FIGURES, never the date. Fields the incoming row does not state are
  // kept (bank.nl publishes only a koersopslag, so letting it land must not wipe
  // a cashback the agent found) — but `checkedAt` describes WHEN A SOURCE
  // CHECKED, and it belongs to the write that carried it, not to the entry.
  //
  // Left to merge, it detached from its own number: bank.nl stamped 2026-01-15,
  // the agent then found 1,2% today, and the merged entry served a figure looked
  // up this morning under January's date. The screen dutifully printed "laatst
  // opgezocht op 15 jan 2026" about something minutes old. A source that states
  // no date is as of now, which `at` already records.
  const merged = prev ? { ...prev.terms, ...stated(terms) } : { ...terms };
  if (terms.checkedAt === undefined) delete merged.checkedAt;
  cache.set(key, { terms: merged, at: Date.now(), source });
  return true;
}

/** Start a lookup for one provider, unless one is already running for it. The
 *  promise is deliberately not awaited by the caller: the request returns now
 *  and the answer lands in the cache for the next one. A failure is swallowed
 *  on purpose — the provider simply stays unknown, which the UI already shows
 *  honestly ("voorwaarden nog onbekend") and the owner can type in himself. */
/** Does a cached row still need the agent?
 *
 *  A comparison table answers ONE question: the koersopslag. The ranking also
 *  needs cashback and the conversion leg. Treating any fresh row as finished
 *  meant bank.nl filled fxFeePct in one fetch, the row counted as fresh, and the
 *  agent that would have supplied the rest never ran — so cashback stayed
 *  unknown for every Dutch bank bank.nl covers, while providers it does NOT
 *  cover (American Express) got a full lookup. The floor was blocking the
 *  ceiling.
 *
 *  `agentTried` stops the opposite failure: a provider that genuinely has no
 *  cashback programme would otherwise be re-asked on every request forever. */
function incomplete(e: Entry): boolean {
  if (e.agentTried) return false;
  return e.terms.cashbackPct === undefined || e.terms.convertFeePct === undefined;
}

function startLookup(provider: string, base: Omit<TravelInput, "providers">, apiKey: string, deps: Deps): void {
  const key = keyOf(provider, base.homeCountry, base.currency);
  const held = cache.get(key);
  if (inFlight.has(key) || (fresh(held) && !incomplete(held as Entry))) return;
  inFlight.add(key);
  void (async () => {
    try {
      const found = await (deps.lookup ?? lookupProviderTerms)({ ...base, providers: [provider] }, apiKey);
      // Only cache an answer that actually carries a NUMBER. A reply with just
      // a note ("couldn't verify — the search tool hit its limit") is a failed
      // lookup wearing an answer's clothes; caching it for a week would lock in
      // that failure and stop us retrying. Better to leave it unknown and let
      // the next ask try again.
      if (found.length > 0 && usable(found[0])) write(key, found[0], "agent");
      // Record the attempt either way: a provider with no cashback programme
      // must not be re-asked on every request for the rest of the TTL.
      const after = cache.get(key);
      if (after) cache.set(key, { ...after, agentTried: true });
    } catch {
      /* stays unknown; the UI says so and the owner can correct it */
    } finally {
      inFlight.delete(key);
    }
  })();
}

/** Fill the gaps from the bank.nl comparison table — ONE HTTP GET covering
 *  seven Dutch banks and both card kinds, against a Claude+search lookup per
 *  provider that takes 40s-5min and fails outright on the sites behind
 *  Cloudflare. Runs in the background like `startLookup`, and for the same
 *  reason: the request must not wait on it.
 *
 *  Only for a Dutch home country (it is a Dutch source about Dutch banks) and
 *  only when there is a currency to convert INTO — a euro destination has no
 *  koersopslag to compare. Only the gaps are filled: an entry that is already
 *  fresh has already been answered, and if it later expires it becomes a gap
 *  and gets the comparison figure then. */
function startComparisonFill(gaps: string[], base: Omit<TravelInput, "providers">, deps: Deps): void {
  const load = deps.comparison;
  if (!load || gaps.length === 0) return;
  if (base.homeCountry !== "NL" || base.currency === "EUR") return;
  const market = `${base.homeCountry}|${base.currency}`;
  if (comparisonInFlight.has(market)) return;
  comparisonInFlight.add(market);
  void (async () => {
    try {
      const table = await load();
      for (const provider of gaps) {
        const found = comparisonTermsFor(table.rows, provider);
        // A bank this page says nothing about, or a card kind it never priced,
        // returns null and stays UNKNOWN. Never a zero, never the other card's
        // figure — that is what makes the ranking trustworthy.
        if (found) write(keyOf(found.provider, base.homeCountry, base.currency), found, "comparison");
      }
    } catch {
      /* the comparison stays unknown; the agent lookup still runs alongside */
    } finally {
      comparisonInFlight.delete(market);
    }
  })();
}

export type Deps = {
  lookup?: typeof lookupProviderTerms;
  /** The bank.nl comparison table. Injected rather than imported so a test can
   *  never reach the network, and so the layer can simply be absent. */
  comparison?: () => Promise<BankNlTable>;
};

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
  const gaps: string[] = [];
  for (const provider of providers) {
    const hit = cache.get(keyOf(provider, base.homeCountry, base.currency));
    if (fresh(hit) && !incomplete(hit as Entry)) {
      terms.push(hit!.terms);
      continue;
    }
    // Fresh but thin: serve what we have NOW and let the agent fill the rest in
    // the background. Nobody waits, and the gap closes by itself.
    if (fresh(hit)) {
      terms.push(hit!.terms);
      startLookup(provider, base, apiKey, deps);
      continue;
    }
    // Stale-while-revalidate, the same fallback order rates.ts uses (fresh ->
    // live -> last good). An expired entry is still a real tariff and beats
    // showing "unknown": hand it over NOW and refresh it in the background. A
    // week-old fee is almost certainly still right; a blank one is never right.
    gaps.push(provider);
    startLookup(provider, base, apiKey, deps);
    if (hit) terms.push(hit.terms);
    else pending.push(provider);
  }
  // One fetch for every gap at once, so the cheap source gets its answer in
  // long before the per-provider model lookups do.
  startComparisonFill(gaps, base, deps);
  return { terms, pending };
}

/** Write terms in from OUTSIDE the LLM path — the n8n workflow that fetches a
 *  provider's own tariff page and extracts the numbers from it, and (with
 *  `source: "comparison"`) the bank.nl table.
 *
 *  Why this exists: the agent's weak step was never reading a tariff, it was
 *  FINDING one. Revolut kept coming back empty while ING, ABN and Amex
 *  succeeded. Handing a known URL to a workflow removes the search entirely,
 *  which is the same reason the geld.nl scraper beats asking a model for
 *  savings rates. The agent stays as the fallback for providers nobody has
 *  configured a source for.
 *
 *  Returns how many were accepted; rows with no usable number are rejected for
 *  the same reason a failed lookup isn't cached, and rows refused by the
 *  precedence ladder are rejected too — a caller that is told "accepted" when
 *  nothing changed has been misinformed. */
export function ingestCardTerms(
  homeCountry: string,
  currency: string,
  rows: ProviderTerms[],
  source: TermsSource = "provider",
): { accepted: number; rejected: string[] } {
  const rejected: string[] = [];
  let accepted = 0;
  for (const row of rows) {
    const provider = String(row?.provider ?? "").trim();
    if (!provider || !usable(row)) {
      if (provider) rejected.push(provider);
      continue;
    }
    if (write(keyOf(provider, homeCountry, currency), { ...row, provider }, source)) accepted++;
    else rejected.push(provider);
  }
  return { accepted, rejected };
}

/** Where a catalogue figure sits on the existing precision ladder. A provider's
 *  own page or PDF is the most precise thing there is; the agent is the least.
 *  Reusing the ladder means the catalogue cannot quietly outrank a correction. */
const ROUTE_SOURCE: Record<string, TermsSource> = {
  "provider-page": "provider",
  "provider-pdf": "provider",
  wayback: "provider",
  comparison: "comparison",
  agent: "agent",
};

/** Load the committed catalogue into the cache. Instant and free — it is a file —
 *  so the block is answered before anything is looked up.
 *
 *  A figure whose CONDITIONS were never established is refused. That is not
 *  fussiness: Revolut's 0% was true only inside a €1.000 monthly cap, and it
 *  shipped as unconditional, ranked first, and told him the trip was free.
 *
 *  It goes through `write`, like every other source, so the catalogue is ranked
 *  rather than privileged: a figure older than what is held is refused however
 *  tidy its source, and the owner's own correction still wins one layer further
 *  out in `upsertFacts` — everything served from here reaches him as an
 *  agent-sourced fact, which that function refuses to let overwrite a user one. */
export function ingestCatalogue(
  entries: readonly CatalogEntry[],
  homeCountry: string,
  currency: string,
): { accepted: number; rejected: string[] } {
  const rejected: string[] = [];
  let accepted = 0;
  for (const entry of entries) {
    const fx = entry.fields.fxFeePct;
    if (!isCovered(fx)) {
      rejected.push(entry.product);
      continue;
    }
    const ok = write(
      keyOf(entry.product, homeCountry, currency),
      {
        provider: entry.product,
        fxFeePct: fx!.value,
        checkedAt: fx!.checkedAt,
        // The cap travels WITH the rate. "0% tot € 1.000 p/m, daarna 1%" shown
        // as a flat 0% is the entire Revolut incident; dropping the clause on
        // the way in would recreate it inside the app instead of outside it.
        note: fx!.conditions ?? undefined,
      },
      ROUTE_SOURCE[fx!.route] ?? "agent",
    );
    if (ok) accepted++;
    else rejected.push(entry.product);
  }
  return { accepted, rejected };
}

/** Test seam: drop everything (there is no cross-request state to preserve). */
export function resetCardTerms(): void {
  cache.clear();
  inFlight.clear();
  comparisonInFlight.clear();
}
