/* FX history service. GET /api/fx/history serves this: historical daily EUR
 * exchange rates from the ECB, so the web app can convert a foreign-currency
 * balance or transaction to euro on the day it happened.
 *
 * One source only, unlike fx.ts's two layers — a historical series has no
 * "aggregator" fallback worth reconciling against, and a gap on a weekend is
 * expected (the ECB does not publish Saturday/Sunday rates), not a failure.
 *
 * Cached per currency, not per (currency, from): a cache miss always fetches
 * the full 5-year-capped range, so one fetch serves every `from` a caller asks
 * for that currency over the next 24h. The response is filtered to the
 * caller's `from` after the cache lookup, not before.
 */

const ECB_HISTORY_URL = (currency: string, startPeriod: string): string =>
  `https://data-api.ecb.europa.eu/service/data/EXR/D.${currency}.EUR.SP00.A?startPeriod=${startPeriod}&format=csvdata`;

const ECB_TIMEOUT_MS = 8000;
const HISTORY_TTL_MS = 24 * 60 * 60 * 1000;
const HISTORY_CAP_YEARS = 5;

export type FxHistoryResponse = {
  base: "EUR";
  currency: string;
  rates: Record<string, number>;
};

/** `today - HISTORY_CAP_YEARS`, as YYYY-MM-DD. Both the floor a `from` clamps
 *  up to and the `startPeriod` a cache miss fetches from. */
function capFloorIso(now: Date): string {
  const floor = new Date(
    Date.UTC(now.getUTCFullYear() - HISTORY_CAP_YEARS, now.getUTCMonth(), now.getUTCDate()),
  );
  return floor.toISOString().slice(0, 10);
}

/** Strict YYYY-MM-DD. Rejects what `new Date(str)` would otherwise silently
 *  roll over (2026-13-40 has no business becoming 2027-02-09). */
function parseIsoDate(raw: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return null;
  return raw;
}

export function validateCurrency(raw: string | undefined): string | null {
  if (!raw) return null;
  const upper = raw.toUpperCase();
  return /^[A-Z]{3}$/.test(upper) ? upper : null;
}

/** Validated, and clamped to the 5-year cap floor rather than rejected — an
 *  old `from` is still a valid request, just one that can't reach further back
 *  than the range this service keeps. */
export function validateFromDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const iso = parseIsoDate(raw);
  if (!iso) return null;
  const floor = capFloorIso(new Date());
  return iso < floor ? floor : iso;
}

/** Minimal RFC4180 line splitter — the ECB CSV quotes TITLE_COMPL because it
 *  contains a comma, so a plain `split(",")` would misalign every column after
 *  it. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(field);
      field = "";
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
}

/** Columns by name, per the ECB's own header row — not by position, which the
 *  SDMX csvdata format does not promise to keep stable. */
function parseEcbHistoryCsv(csv: string): Record<string, number> {
  const lines = csv.split(/\r?\n/).filter((line) => line.length > 0);
  const rates: Record<string, number> = {};
  if (lines.length === 0) return rates;
  const header = parseCsvLine(lines[0]);
  const timeIdx = header.indexOf("TIME_PERIOD");
  const valueIdx = header.indexOf("OBS_VALUE");
  if (timeIdx === -1 || valueIdx === -1) return rates;
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const date = cols[timeIdx];
    const value = Number(cols[valueIdx]);
    if (!date || !Number.isFinite(value) || value <= 0) continue;
    rates[date] = value;
  }
  return rates;
}

/** null on anything that is not a clean CSV 200 — a 404 (unknown currency,
 *  JSON body) and a WAF-blocked 400 (HTML body) are both "no data", never
 *  something to parse as if it were the CSV. */
async function fetchEcbHistory(
  currency: string,
  startPeriod: string,
): Promise<Record<string, number> | null> {
  try {
    const res = await fetch(ECB_HISTORY_URL(currency, startPeriod), {
      signal: AbortSignal.timeout(ECB_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.startsWith("text/csv")) return null;
    return parseEcbHistoryCsv(await res.text());
  } catch {
    return null;
  }
}

const historyCache = new Map<string, { rates: Record<string, number>; fetchedAt: number }>();

/** `currency` and `from` are assumed already validated by the caller
 *  (`validateCurrency`/`validateFromDate`) — this is the pure fetch/cache
 *  layer, not the HTTP boundary. Returns null when ECB could not be read;
 *  that failure is deliberately not cached, so the next request retries live. */
export async function getFxHistory(
  currency: string,
  from: string,
): Promise<FxHistoryResponse | null> {
  const floor = capFloorIso(new Date());
  const cached = historyCache.get(currency);
  const fresh = cached !== undefined && Date.now() - cached.fetchedAt < HISTORY_TTL_MS;

  let rates: Record<string, number>;
  if (fresh) {
    rates = cached.rates;
  } else {
    const fetched = await fetchEcbHistory(currency, floor);
    if (!fetched) return null;
    rates = fetched;
    historyCache.set(currency, { rates, fetchedAt: Date.now() });
  }

  const filtered: Record<string, number> = {};
  for (const [date, value] of Object.entries(rates)) {
    if (date >= from) filtered[date] = value;
  }
  return { base: "EUR", currency, rates: filtered };
}

/** Alleen voor tests: gooit het geheugen van dit proces weg. */
export function __resetFxHistoryCacheForTests(): void {
  historyCache.clear();
}
