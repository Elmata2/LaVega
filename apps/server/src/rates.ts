/* Rente-service. GET /api/rates serves this. It scrapes the public NL savings
 * comparison table at geld.nl (public, generic data — no user data is involved)
 * and maps it to a RateBenchmark[], including action rates + the standard rate
 * that applies after the promo. Results are cached in-memory (6h) so we don't
 * hammer the source; on any failure it serves the last good result, else a
 * bundled static snapshot. A real per-source fetcher can extend/replace
 * scrapeGeldNl without changing the route or the client contract. */

export type RateBenchmark = {
  bank: string;
  product: string;
  ratePct: number;
  freeWithdrawal: boolean;
  standardRatePct?: number;
  promoNote?: string;
};
export type RatesPayload = { asOf: string; rates: RateBenchmark[] };

const SOURCE_URL = "https://www.geld.nl/sparen/spaarrente/overzicht";
const TTL_MS = 6 * 60 * 60 * 1000;

// Parse a Dutch-formatted number ("3,10" / "1.234,56") to a JS number, or null.
function num(s: string | null): number | null {
  if (!s) return null;
  const n = parseFloat(s.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
}
function attr(row: string, key: string): string | null {
  const m = row.match(new RegExp("data-" + key + '=("[^"]*"|[^\\s>]*)'));
  return m ? m[1].replace(/^"|"$/g, "").trim() : null;
}

/** Scrape geld.nl's savings table. Returns null on any failure so the caller
 *  falls back. Each result row carries machine-generated data-* attributes
 *  (data-aanbiedernaam / data-rente / data-rentenominaal / data-spaartype /
 *  data-actierente*). We keep only freely-withdrawable "Spaarrekening" rows. */
export async function scrapeGeldNl(): Promise<RatesPayload | null> {
  try {
    const res = await fetch(SOURCE_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (LaVega rate fetcher)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const rows = html.match(/class=tableresults__result[^>]*>/g) ?? [];
    const rates: RateBenchmark[] = [];
    for (const row of rows) {
      if ((attr(row, "spaartype") ?? "").toLowerCase() !== "spaarrekening") continue;
      const bank = attr(row, "aanbiedernaam");
      const ratePct = num(attr(row, "rente"));
      if (!bank || ratePct === null) continue;
      const standardRatePct = num(attr(row, "rentenominaal")) ?? undefined;
      const dgs = attr(row, "depositogarantiestelsel");
      const maanden = attr(row, "actierentelooptijdinmaanden");
      let promoNote: string | undefined;
      if (standardRatePct !== undefined && ratePct > standardRatePct + 0.001) {
        const std = standardRatePct.toFixed(2).replace(".", ",");
        promoNote = maanden ? `Actierente ${maanden} mnd, daarna ${std}%` : `Actierente, daarna ${std}%`;
      }
      const product = (attr(row, "productnaam") || "Spaarrekening") + (dgs ? ` · DGS ${dgs}` : "");
      rates.push({ bank, product, ratePct, freeWithdrawal: true, standardRatePct, promoNote });
    }
    if (rates.length < 5) return null; // parse likely broke → fall back
    // Dedupe by bank (keep the highest rate), sort by rate desc.
    const byBank = new Map<string, RateBenchmark>();
    for (const r of rates) {
      const e = byBank.get(r.bank);
      if (!e || r.ratePct > e.ratePct) byBank.set(r.bank, r);
    }
    const list = [...byBank.values()].sort((a, b) => b.ratePct - a.ratePct);
    return { asOf: new Date().toISOString().slice(0, 10), rates: list };
  } catch {
    return null;
  }
}

/* Static fallback (verified geld.nl, Aug 2026) — used only when a live scrape
 * and the in-memory cache are both unavailable. */
const STATIC: RatesPayload = {
  asOf: "2026-08-03",
  rates: [
    { bank: "Bigbank", product: "Flexibel Sparen", ratePct: 3.1, standardRatePct: 2.1, promoNote: "Actierente 6 mnd, daarna 2,10%", freeWithdrawal: true },
    { bank: "bunq", product: "Spaarrekening", ratePct: 3.01, standardRatePct: 1.5, promoNote: "Actierente t/m 01-01-2027, daarna 1,50%", freeWithdrawal: true },
    { bank: "Santander Consumer Bank", product: "Spaarrekening", ratePct: 3.01, standardRatePct: 2.1, promoNote: "Actierente 6 mnd, daarna 2,10%", freeWithdrawal: true },
    { bank: "Trade Republic", product: "Cash", ratePct: 3.0, standardRatePct: 2.25, promoNote: "Introrente, daarna 2,25%", freeWithdrawal: true },
    { bank: "Klarna", product: "Spaarrekening", ratePct: 1.95, freeWithdrawal: true },
    { bank: "NIBC", product: "Spaarrekening", ratePct: 1.44, freeWithdrawal: true },
    { bank: "Rabobank", product: "Spaarrekening", ratePct: 1.4, freeWithdrawal: true },
    { bank: "ABN AMRO", product: "Spaarrekening", ratePct: 1.25, freeWithdrawal: true },
    { bank: "ING", product: "Oranje Spaarrekening", ratePct: 1.25, freeWithdrawal: true },
  ],
};

let cache: { payload: RatesPayload; at: number } | null = null;

/** Current benchmark: fresh cache → live scrape → last good cache → static. */
export async function getRates(): Promise<RatesPayload> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.payload;
  const live = await scrapeGeldNl();
  if (live) {
    cache = { payload: live, at: Date.now() };
    return live;
  }
  if (cache) return cache.payload; // stale but real, better than static
  return STATIC;
}
