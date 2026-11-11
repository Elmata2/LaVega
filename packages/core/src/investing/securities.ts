/*
 * Ported from Sure (we-promise/sure) commit 562fe09 — AGPL-3.0 — independently
 * reimplemented for LaVega; changed 2026-11-11.
 */

/* Security master (plan §3 WS4.5, #297).
 *
 * Sure sources (AGPL-3.0, pinned commit above):
 *  - `app/models/security.rb:12-16, 93-94, 179-232` — identity is
 *    `(ticker, exchange_operating_mic)`, MIC aliases are canonicalised, and a
 *    ticker is unique only inside its MIC.
 *  - `app/models/security/provided.rb:178-199` — a security remembers the
 *    provider that priced it; when that provider is unavailable it is SKIPPED,
 *    never silently queried against a different provider.
 *  - `app/models/security/price/importer.rb:5, 33-76, 129-148, 329-343` —
 *    provider fetch clamped to the listing start, and recent LOCF rows carry a
 *    `provisional` flag so they are re-fetched for a short window.
 *  - `app/models/security/price.rb:1-14` — the provisional flag's meaning.
 *
 * Deliberately different: Sure has no ISIN column and treats the same ticker on
 * two venues as two securities. LaVega stores ISIN on positions and trades, so
 * the canonical key is ISIN-first: one ISIN from two brokers is one security.
 * `(ticker, MIC)` stays the fallback and the alias layer, and a missing ISIN or
 * a distinct share class keeps its own key until identity is established.
 *
 * No clock and no I/O here. Callers pass the rows they have and `asOf` dates.
 */

const ISIN_PATTERN = /^[A-Z]{2}[A-Z0-9]{9}[0-9]$/;
const MIC_PATTERN = /^[A-Z0-9]{4}$/;

/** Legacy MIC spellings Sure canonicalises on lookup (`security.rb:12-16`). */
const MIC_ALIASES: Readonly<Record<string, string>> = {
  WAR: "XWAR",
  WSE: "XWAR",
  LON: "XLON",
  LSE: "XLON",
  PAR: "XPAR",
  AMS: "XAMS",
  ETR: "XETR",
  FRA: "XFRA",
  MIL: "XMIL",
  MAD: "XMAD",
  SWX: "XSWX",
  ZRH: "XSWX",
  NYS: "XNYS",
  NYQ: "XNYS",
  NMS: "XNAS",
  NAS: "XNAS",
};

/** How long a provisional close is re-fetched before it is accepted as final
 *  (`security/price/importer.rb:329-343`). */
export const PROVISIONAL_REFETCH_DAYS = 7;

export type InstrumentKey = string;

/** `isin:US02079K3059`, `sym:AAPL@XNAS`, or `sym:AAPL` when no MIC is known. */
export function canonicalMic(mic: string | null | undefined): string | null {
  const normalized = mic?.trim().toUpperCase() ?? "";
  if (!normalized) return null;
  const aliased = MIC_ALIASES[normalized] ?? normalized;
  return MIC_PATTERN.test(aliased) ? aliased : null;
}

/** ISO 6166 check: 12 characters, a country prefix and a Luhn check digit over
 *  the letter-expanded NSIN. A malformed ISIN is not an identity. */
export function isValidIsin(value: string | null | undefined): boolean {
  const isin = value?.trim().toUpperCase() ?? "";
  if (!ISIN_PATTERN.test(isin)) return false;
  let digits = "";
  for (const character of isin) {
    if (character >= "0" && character <= "9") digits += character;
    else digits += String(character.charCodeAt(0) - 55);
  }
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    let digit = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

export function normalizeIsin(value: string | null | undefined): string | null {
  const isin = value?.trim().toUpperCase() ?? "";
  return isValidIsin(isin) ? isin : null;
}

function normalizeTicker(value: string | null | undefined): string {
  return value?.trim().toUpperCase() ?? "";
}

/** The canonical key for one instrument. ISIN first: two brokers reporting the
 *  same ISIN resolve to the same key whatever ticker they print. Without a
 *  valid ISIN, the `(ticker, MIC)` pair is the identity, and a bare ticker is
 *  the last resort — two venues quoting one ticker must stay apart. */
export function instrumentKey(input: {
  isin?: string | null;
  ticker?: string | null;
  symbol?: string | null;
  mic?: string | null;
}): InstrumentKey | null {
  const isin = normalizeIsin(input.isin);
  if (isin) return `isin:${isin}`;
  const ticker = normalizeTicker(input.ticker ?? input.symbol);
  if (!ticker) return null;
  const mic = canonicalMic(input.mic);
  return mic ? `sym:${ticker}@${mic}` : `sym:${ticker}`;
}

/** The alias keys one instrument answers to. `(ticker, MIC)` is a broker
 *  spelling of the same security, not a second one. */
export function instrumentAliases(input: {
  isin?: string | null;
  ticker?: string | null;
  symbol?: string | null;
  mic?: string | null;
}): InstrumentKey[] {
  const keys: InstrumentKey[] = [];
  const canonical = instrumentKey(input);
  if (canonical) keys.push(canonical);
  const isin = normalizeIsin(input.isin);
  const ticker = normalizeTicker(input.ticker ?? input.symbol);
  const mic = canonicalMic(input.mic);
  if (isin && ticker) {
    keys.push(mic ? `sym:${ticker}@${mic}` : `sym:${ticker}`);
  }
  return [...new Set(keys)];
}

/** One broker's spelling of an instrument. `ticker` defaults to `symbol`. */
export type SecurityAlias = {
  symbol: string;
  isin?: string;
  ticker?: string;
  mic?: string;
  broker?: string;
};

export type SecurityIdentity = {
  key: InstrumentKey;
  isin: string | null;
  ticker: string;
  mic: string | null;
  /** Every broker symbol that resolves to this identity. */
  aliases: string[];
  brokers: string[];
};

export type ResolvedSecurities = {
  identities: SecurityIdentity[];
  /** Broker symbol (uppercased) to canonical key. An ambiguous symbol is not
   *  in here: a ticker reused by two different instruments must not be
   *  silently folded into one. */
  bySymbol: Record<string, InstrumentKey>;
  /** Symbols that resolve to more than one identity, so a caller can ask
   *  instead of guessing. */
  ambiguousSymbols: string[];
};

/** Group the rows a broker snapshot carries into canonical identities.
 *
 *  Rows with the same valid ISIN are one security even across brokers. Rows
 *  without an ISIN group by `(ticker, MIC)`; two share classes (distinct ISINs,
 *  same ticker) stay apart. A symbol that points at two identities is reported
 *  as ambiguous and left out of `bySymbol`. */
export function resolveSecurityIdentities(rows: readonly SecurityAlias[]): ResolvedSecurities {
  type Bucket = {
    key: InstrumentKey;
    isin: string | null;
    ticker: string;
    mic: string | null;
    aliases: Set<string>;
    brokers: Set<string>;
    symbols: Set<string>;
  };
  const buckets = new Map<InstrumentKey, Bucket>();
  for (const row of rows) {
    const symbol = normalizeTicker(row.symbol);
    if (!symbol) continue;
    const key = instrumentKey({
      isin: row.isin,
      ticker: row.ticker ?? row.symbol,
      mic: row.mic,
    });
    if (!key) continue;
    const existing = buckets.get(key);
    const bucket: Bucket = existing ?? {
      key,
      isin: normalizeIsin(row.isin),
      ticker: normalizeTicker(row.ticker ?? row.symbol),
      mic: canonicalMic(row.mic),
      aliases: new Set<string>(),
      brokers: new Set<string>(),
      symbols: new Set<string>(),
    };
    bucket.aliases.add(symbol);
    bucket.symbols.add(symbol);
    if (row.broker) bucket.brokers.add(row.broker);
    if (!existing) buckets.set(key, bucket);
  }

  const identities: SecurityIdentity[] = [...buckets.values()].map((bucket) => ({
    key: bucket.key,
    isin: bucket.isin,
    ticker: bucket.ticker,
    mic: bucket.mic,
    aliases: [...bucket.aliases].sort(),
    brokers: [...bucket.brokers].sort(),
  }));

  const keysBySymbol = new Map<string, Set<InstrumentKey>>();
  for (const identity of identities) {
    for (const symbol of identity.aliases) {
      const keys = keysBySymbol.get(symbol) ?? new Set<InstrumentKey>();
      keys.add(identity.key);
      keysBySymbol.set(symbol, keys);
    }
  }
  const bySymbol: Record<string, InstrumentKey> = {};
  const ambiguousSymbols: string[] = [];
  for (const [symbol, keys] of keysBySymbol) {
    if (keys.size === 1) bySymbol[symbol] = [...keys][0]!;
    else ambiguousSymbols.push(symbol);
  }
  return {
    identities: identities.sort((left, right) => left.key.localeCompare(right.key)),
    bySymbol,
    ambiguousSymbols: ambiguousSymbols.sort(),
  };
}

/** The canonical key a broker symbol belongs to, or null when the snapshot
 *  says nothing about it. */
export function instrumentKeyForSymbol(
  resolved: Pick<ResolvedSecurities, "bySymbol">,
  symbol: string,
): InstrumentKey | null {
  return resolved.bySymbol[normalizeTicker(symbol)] ?? null;
}

/* ---------------------------------------------------------------------------
 * Thesis migration (ADR 0007's symbol keys → canonical keys)
 * ------------------------------------------------------------------------- */

/** A stored thesis, reduced to what the migration must compare. `fingerprint`
 *  is a stable hash of the encrypted body plus the status: two theses with the
 *  same fingerprint are the same claim, so folding them into one key loses
 *  nothing. Different fingerprints are two claims, and the migration never
 *  chooses between them. */
export type ThesisForMigration = {
  symbol: string;
  status: "active" | "dormant";
  fingerprint: string;
};

export type ThesisMigrationAssignment = {
  symbol: string;
  instrumentKey: InstrumentKey | null;
};

export type ThesisMigrationPlan = {
  /** Every thesis's canonical key, or null when the snapshot cannot place it. */
  assignments: ThesisMigrationAssignment[];
  /** Groups whose theses are identical: one row keeps the key, the rest fold
   *  into it. Nothing is lost, so this merge is safe. */
  merges: Array<{
    instrumentKey: InstrumentKey;
    keptSymbol: string;
    mergedSymbols: string[];
  }>;
  /** Groups whose confirmed theses disagree. Every row keeps its own text and
   *  status and the group is surfaced for the owner to resolve; the migration
   *  never silently merges these. */
  reviews: Array<{
    instrumentKey: InstrumentKey;
    symbols: string[];
    reason: "conflicting-theses";
  }>;
};

/** Plan the move from broker-symbol thesis keys to canonical instrument keys.
 *
 *  Identical theses (same body, same status) for one instrument become one key.
 *  Conflicting theses stay separate and are listed for review. A thesis whose
 *  symbol the snapshot cannot place keeps a null key and is left alone. */
export function planThesisMigration(
  theses: readonly ThesisForMigration[],
  resolved: Pick<ResolvedSecurities, "bySymbol">,
): ThesisMigrationPlan {
  const groups = new Map<InstrumentKey, ThesisForMigration[]>();
  const assignments: ThesisMigrationAssignment[] = [];
  for (const thesis of theses) {
    const key = instrumentKeyForSymbol(resolved, thesis.symbol);
    assignments.push({ symbol: thesis.symbol, instrumentKey: key });
    if (!key) continue;
    groups.set(key, [...(groups.get(key) ?? []), thesis]);
  }

  const merges: ThesisMigrationPlan["merges"] = [];
  const reviews: ThesisMigrationPlan["reviews"] = [];
  for (const [instrumentKey, group] of groups) {
    const symbols = group.map((thesis) => normalizeTicker(thesis.symbol)).sort();
    if (symbols.length < 2) continue;
    const claims = new Set(group.map((thesis) => `${thesis.status}\u0000${thesis.fingerprint}`));
    if (claims.size === 1) {
      merges.push({
        instrumentKey,
        keptSymbol: symbols[0]!,
        mergedSymbols: symbols.slice(1),
      });
    } else {
      reviews.push({ instrumentKey, symbols, reason: "conflicting-theses" });
    }
  }
  return {
    assignments: assignments.sort((left, right) => left.symbol.localeCompare(right.symbol)),
    merges: merges.sort((left, right) => left.instrumentKey.localeCompare(right.instrumentKey)),
    reviews: reviews.sort((left, right) => left.instrumentKey.localeCompare(right.instrumentKey)),
  };
}

/* ---------------------------------------------------------------------------
 * Provider affinity, provisional window, listing-start clamp
 * ------------------------------------------------------------------------- */

/** The security's assigned price provider is the only one allowed to answer.
 *  When it is unavailable the symbol is skipped with a reason, never handed to
 *  a different provider (`security/provided.rb:178-199`). */
export type ProviderAffinityDecision = { skip: false } | { skip: true; reason: string };

export function providerAffinity(
  assignedProvider: string | null | undefined,
  availableSourceKeys: readonly string[],
): ProviderAffinityDecision {
  const assigned = assignedProvider?.trim();
  if (!assigned) return { skip: false };
  if (availableSourceKeys.includes(assigned)) return { skip: false };
  return {
    skip: true,
    reason: `Assigned price provider ${assigned} is unavailable; skipped instead of replanning`,
  };
}

function dayDistance(from: string, to: string): number | null {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return (end - start) / 86_400_000;
}

/** A provisional close is re-fetched until its window closes. Returns the date
 *  the refetch must start from, or null when nothing is provisional. A row
 *  older than the window is final and is not fetched again. */
export function provisionalRefetchFrom(
  provisionalThrough: string | null | undefined,
  today: string,
): string | null {
  if (!provisionalThrough) return null;
  const age = dayDistance(provisionalThrough, today);
  if (age === null || age < 0 || age > PROVISIONAL_REFETCH_DAYS) return null;
  return provisionalThrough;
}

/** A provider cannot price a listing before it existed. Clamping the request to
 *  the persisted listing start is what stops an IPO-era backfill from asking
 *  for years of nothing on every sync. */
export function clampToListingStart(
  from: string | undefined,
  listingStart: string | null | undefined,
): string | undefined {
  if (!listingStart) return from;
  if (from === undefined) return listingStart;
  return from < listingStart ? listingStart : from;
}
