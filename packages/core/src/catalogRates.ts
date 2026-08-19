/* THE CATALOGUE AS A RATE SOURCE THE APP CAN USE.
 *
 * The savings half of the catalogue holds interest rates read from each bank's own
 * document, each carrying the URL it came from and the date that document states.
 * The app already knows how to rank `RateBenchmark`s, so the job here is a
 * translation, not a new mechanism — and it is deliberately pure so the same
 * function serves the web bundle, a test and a script.
 *
 * WHAT IT REFUSES TO PASS ON, and why each matters:
 *   - a figure that is not COVERED. An uncovered rate is one whose conditions were
 *     never settled; showing it in a comparison would rank a bank on a number we
 *     could not qualify, which is the whole failure the catalogue exists to avoid.
 *   - a rate with no issuer. `mergeRateSources` keys on bank and product, so an
 *     entry with no bank cannot be reconciled with the comparison scrape and would
 *     appear as a second, nameless row for a bank already listed.
 */
import type { CatalogValue } from "./catalog.js";
import { isCovered } from "./catalog.js";
import type { RateBenchmark } from "./interest.js";

export type CatalogueEntryLike = {
  id: string;
  product: string;
  issuer?: string;
  kind?: string;
  fields?: { interestPct?: CatalogValue; [k: string]: CatalogValue | undefined };
};

/** Strip the legal-form noise an issuer field carries ("ABN AMRO Bank N.V. —
 *  Dutch DGS") down to the name a saver would recognise, which is also the name
 *  the comparison scrape uses. */
export function issuerToBank(issuer: string): string {
  return issuer
    .split(/[—–(;]/)[0]
    // Trailing legal form only. `\b` cannot follow "N.V." — a period is not a word
    // character — so these are anchored to the end instead, which is where they
    // sit anyway.
    .replace(/\s+(N\.?V\.?|B\.?V\.?|S\.?A\.?|A\.?S\.?|U\.?A\.?|AG|SA|AB|AS|UAB|GmbH|Ltd\.?|Limited|PLC|SE)\s*$/i, "")
    // NOT the word "Bank". "Triodos Bank" and "DHB Bank" are how the comparison
    // table names them and how a saver would recognise them; stripping it would
    // turn a correct match into a mismatch for the sake of one that already works.
    .replace(/\s+/g, " ")
    .trim();
}

/** Drop the bank's own name from the front of a product name, so "ABN AMRO Direct
 *  Sparen" pairs with bank "ABN AMRO" and product "Direct Sparen" — the shape the
 *  existing table uses, and the shape mergeRateSources keys on. */
export function productWithoutBank(product: string, bank: string): string {
  const p = product.trim();
  // Try the whole bank name first, then progressively shorter leading runs of it:
  // the issuer may be "ABN AMRO Bank" while the product reads "ABN AMRO Direct
  // Sparen", so an exact prefix test alone leaves the bank's name in the product
  // and the row reads "ABN AMRO Bank — ABN AMRO Direct Sparen".
  const words = bank.split(/\s+/).filter(Boolean);
  for (let n = words.length; n > 0; n--) {
    const prefix = words.slice(0, n).join(" ");
    // The prefix must end on a word boundary. Without this, bank "Open Bank" ate
    // the "Open" out of product "Openbank Welkom Spaarrekening" and the row read
    // "Open Bank — bank Welkom Spaarrekening".
    const next = p.charAt(prefix.length);
    const boundary = next === "" || /[\s-–—]/.test(next);
    if (p.toLowerCase().startsWith(prefix.toLowerCase()) && p.length > prefix.length && boundary) {
      const rest = p.slice(prefix.length).replace(/^[\s-–—]+/, "").trim();
      if (rest) return rest;
    }
  }
  return p;
}

/** Covered savings rates from the catalogue, as benchmarks the app can rank.
 *
 *  `freeWithdrawal` is true only when the conditions do NOT say otherwise: the
 *  extractor records "Niet vrij opneembaar" or "Opnamevoorwaarden niet vermeld"
 *  when it knows or cannot tell, and an unknown must not win a comparison the
 *  saver may not qualify for. */
export function savingsBenchmarks(entries: readonly CatalogueEntryLike[]): RateBenchmark[] {
  const out: RateBenchmark[] = [];
  for (const e of entries) {
    const v = e.fields?.interestPct;
    if (!isCovered(v) || !v) continue;
    if (!e.issuer) continue;
    const bank = issuerToBank(e.issuer);
    if (!bank) continue;
    const c = v.conditions ?? "";
    const restricted = /niet vrij opneembaar|opnamevoorwaarden niet vermeld|opzegtermijn/i.test(c);
    const promo = /actierente/i.test(c) ? c.match(/Actierente[^.]*\./i)?.[0] : undefined;
    out.push({
      bank,
      product: productWithoutBank(e.product, bank),
      ratePct: v.value,
      freeWithdrawal: !restricted,
      ...(promo ? { promoNote: promo } : {}),
      ...(v.conditions ? { conditions: v.conditions } : {}),
      sourceUrl: v.sourceUrl,
      asOf: v.checkedAt,
    });
  }
  return out;
}
