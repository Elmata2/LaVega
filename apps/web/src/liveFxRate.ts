import { DateTime } from "effect";
import { parseFxRatePayload } from "@lavega/core";
import { API_BASE } from "./api.js";

/* DE ENE PLEK DIE /api/fx/rate OPHAALT.
 *
 * Valuta toont de hele koerstabel; het Travel-blok wil er één koers uit halen
 * voor een land dat de kluis niet kent. Beide gebruiken deze functie, zodat er
 * één verzoek en één vorm van falen is.
 *
 * Wat het verzoek meedraagt: niets. Geen valutacode, geen land, geen lichaam, geen
 * cookie-optie. De server levert de HELE tabel (public route, geen sessie nodig),
 * dus wat er het scherm uit gehaald wordt, verlaat de browser nooit. */

/** The raw answer, or null when the server refused (401, 5xx). Rejects when the
 *  network itself failed, which Valuta tells apart from a refusal. */
export function fetchFxRatePayload(): Promise<unknown | null> {
  return fetch(`${API_BASE}/api/fx/rate`).then((r) => (r.ok ? r.json() : null));
}

/** ECB reference rates only (units per euro) and the ECB layer's own date. */
export type LiveEcb = { rates: Record<string, number>; date: string };

/** The ECB-origin rates out of a `/api/fx/rate` answer, or null.
 *
 *  Rates from the aggregator layer are left out ON PURPOSE: using them requires
 *  a visible credit (see AGGREGATOR_CREDIT in Valuta.tsx) and the Travel block
 *  carries none. A bundled snapshot ("bundel") is no live rate either. Anything
 *  without a readable origin or date is not used: a rate that cannot say where it
 *  is from cannot be shown with a source. */
export function ecbRatesFrom(raw: unknown): LiveEcb | null {
  const parsed = parseFxRatePayload(raw);
  if (!parsed || !raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const origins = o.origins as Record<string, unknown> | undefined;
  const ecb = (o.layers as { ecb?: { status?: unknown; date?: unknown } } | undefined)?.ecb;
  if (!origins || !ecb) return null;
  if (ecb.status !== "live" && ecb.status !== "geheugen") return null;
  if (typeof ecb.date !== "string" || ecb.date === "") return null;
  const rates: Record<string, number> = {};
  for (const [code, rate] of Object.entries(parsed.rates))
    if (origins[code] === "ecb") rates[code] = rate;
  return Object.keys(rates).length === 0 ? null : { rates, date: ecb.date };
}

/* One request per session. A success is kept. A failure is tried once more at
 * the next ask (the block asks when the destination changes), never in a loop.
 * After that the block no longer stays in euro until a reload: a further attempt
 * is allowed on the next ask once RETRY_AFTER_MS has passed since the last
 * failure. Asking is always a user action, so there is no timer and no loop. */
export const RETRY_AFTER_MS = 60_000;
const nowMs = () => DateTime.toEpochMillis(DateTime.nowUnsafe());
let cached: LiveEcb | null = null;
let inflight: Promise<LiveEcb | null> | null = null;
let attempts = 0;
let lastFailureAt = 0;

export function getLiveEcb(now: number = nowMs()): Promise<LiveEcb | null> {
  if (cached) return Promise.resolve(cached);
  if (inflight) return inflight;
  if (attempts >= 2 && now - lastFailureAt < RETRY_AFTER_MS) return Promise.resolve(null);
  attempts += 1;
  inflight = fetchFxRatePayload()
    .then((raw) => {
      cached = ecbRatesFrom(raw);
      if (!cached) lastFailureAt = now;
      return cached;
    })
    .catch(() => {
      lastFailureAt = now;
      return null;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function resetLiveFxForTests(): void {
  cached = null;
  inflight = null;
  attempts = 0;
  lastFailureAt = 0;
}
