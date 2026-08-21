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

/** A figure whose own conditions say it is not a savings rate at all. The
 *  extractor writes this in so many words for Wise Rente and N26's flexible cash
 *  fund: both are money-market funds, "an investment that carries a risk of
 *  capital loss", quoted net of a management fee and settling in up to two days.
 *  Ranked beside deposits they would advise moving cash out of a guaranteed
 *  account into one that can lose it, on the strength of the word "rate". */
const NOT_A_SAVINGS_RATE = /not a savings rate|not a deposit|geen spaarrente/i;

/** The figure ITSELF is a teaser and the standing rate was not established. The
 *  extractor says so in the imperative when it means it ("NOT THE STANDING RATE —
 *  do not serve 3% bare"), which is a far safer signal than the mere presence of
 *  the words "nieuwe klanten": half the rows mention a promo while holding the
 *  standard rate, and Santander's conditions do both in one sentence. */
const NOT_THE_STANDING_RATE = /not the standing rate|do not serve [^ ]+ bare/i;

/** The extractor's own normalised promo sentence: "Actierente 3,01% gedurende 6
 *  maanden, daarna 1,51%." Five savings rows carry it and in all five the figure
 *  after "daarna" is the figure in the field, which is what makes the split safe
 *  to do mechanically — the sentence and the value agree about which is which.
 *
 *  Deliberately anchored on that whole shape rather than on the word "actierente"
 *  alone. Nexent's conditions contain "De actierente van 2,75% ... geldt volgens
 *  de tabel voor de Welkom Spaarrekening, NIET voor de Nexent Bank Spaarrekening"
 *  — a sentence about a different product, which the old note regex printed as
 *  this product's promo. */
const PROMO_SENTENCE = /Actierente\s+([\d]+(?:[.,]\d+)?)\s*%[^.]*?\bdaarna\s+([\d]+(?:[.,]\d+)?)\s*%[^.]*\./i;

const asPct = (s: string): number => Number(s.replace(",", "."));

/** Covered savings rates from the catalogue, as benchmarks the app can rank.
 *
 *  `freeWithdrawal` is true only when the conditions do NOT say otherwise: the
 *  extractor records "Niet vrij opneembaar" or "Opnamevoorwaarden niet vermeld"
 *  when it knows or cannot tell, and an unknown must not win a comparison the
 *  saver may not qualify for.
 *
 *  PROMOS ARE CARRIED, NOT HIDDEN (app review, 20 Aug, item 9). A promo is real
 *  money for the months it runs and a trap after them, so a row says both things
 *  at once: `ratePct` is what you could get today, `standardRatePct` what you
 *  keep, and `promo` marks which of the two the headline is. Where the source
 *  flags its own figure as a teaser without settling the standing rate, the kept
 *  rate stays UNKNOWN — the row can be shown but not ranked. */
export function savingsBenchmarks(entries: readonly CatalogueEntryLike[]): RateBenchmark[] {
  const out: RateBenchmark[] = [];
  for (const e of entries) {
    const v = e.fields?.interestPct;
    if (!isCovered(v) || !v) continue;
    if (!e.issuer) continue;
    const bank = issuerToBank(e.issuer);
    if (!bank) continue;
    const c = v.conditions ?? "";
    // SHOWN, FLAGGED, NEVER RANKED. These were skipped outright; he asked for them
    // to appear "but with an asterisk", which is the better answer — a 2,32% money
    // market fund is a real option a saver may want, and hiding it is its own kind
    // of dishonesty. What it must never be is the automatic recommendation.
    const capitalAtRisk = NOT_A_SAVINGS_RATE.test(c);
    const restricted = /niet vrij opneembaar|opnamevoorwaarden niet vermeld|opzegtermijn/i.test(c);

    // Three shapes, in order of how much the source settled.
    const sentence = c.match(PROMO_SENTENCE);
    const splits = sentence !== null && Math.abs(asPct(sentence[2]) - v.value) < 0.005;
    const teaser = NOT_THE_STANDING_RATE.test(c);
    const rate = splits ? asPct(sentence![1]) : v.value;
    const promoNote = splits
      ? sentence![0].trim()
      : teaser
        ? "Actietarief voor nieuwe klanten; de standaardrente staat niet in de bron."
        : undefined;

    out.push({
      bank,
      // DE ID GAAT MEE, en dat is de hele koppeling waar de kostenkant op hangt.
      // Een benchmark wordt hier van een catalogusrij GEMAAKT, dus op dit punt is
      // bekend welke rij het is; twee regels verderop is die wetenschap weg en
      // resteren twee vrij geschreven strings (bank + product) die drie bronnen
      // op drie manieren spellen. Zonder dit veld kon `analyzeInterest` de prijs
      // van de rekening waar het advies heen wijst nergens aan ophangen — en de
      // koppeling later terugrekenen uit die twee strings is precies het soort
      // gok dat een VERKEERDE prijs oplevert, en een verkeerde prijs rekent door.
      productId: e.id,
      product: productWithoutBank(e.product, bank),
      ratePct: rate,
      freeWithdrawal: !restricted,
      ...(splits ? { standardRatePct: v.value } : {}),
      ...(splits || teaser ? { promo: true } : {}),
      ...(promoNote ? { promoNote } : {}),
      ...(v.conditions ? { conditions: v.conditions } : {}),
      ...(capitalAtRisk ? { capitalAtRisk: true } : {}),
      sourceUrl: v.sourceUrl,
      asOf: v.checkedAt,
    });
  }
  return out;
}

/* ─────────────────────────────────────────── what the whole market offers

 * The travel and cashback agents rank what the user HOLDS. That answers "which of
 * my cards should I pay with", which is the right question at a checkout and the
 * wrong one when deciding what to open. The catalogue knows 55 card surcharges and
 * 16 savings rates, so it can answer the second question too — but only from
 * figures that are COVERED, since recommending a switch on a rate whose conditions
 * nobody established is exactly the advice this project refuses to give.
 */

export type MarketOption = {
  productId: string;
  product: string;
  bank: string;
  /** The figure, in percent. Lower is better for a fee, higher for a rate. */
  value: number;
  conditions: string | null;
  sourceUrl: string;
  /** The date the SOURCE states, so a saver can see a figure is a year old. */
  asOf: string;
};

function toOption(e: CatalogueEntryLike, v: CatalogValue): MarketOption {
  const bank = e.issuer ? issuerToBank(e.issuer) : "";
  return {
    productId: e.id,
    product: e.product,
    bank,
    value: v.value,
    conditions: v.conditions,
    sourceUrl: v.sourceUrl,
    asOf: v.checkedAt,
  };
}

/** Every covered foreign-currency surcharge, cheapest first.
 *
 *  Ties keep catalogue order rather than being broken arbitrarily, so the list is
 *  stable between renders and between deploys — a recommendation that reshuffles
 *  on reload reads as noise. */
export function marketFxOptions(entries: readonly CatalogueEntryLike[]): MarketOption[] {
  const out: MarketOption[] = [];
  for (const e of entries) {
    const v = e.fields?.fxFeePct;
    if (!isCovered(v) || !v) continue;
    out.push(toOption(e, v));
  }
  return out.sort((a, b) => a.value - b.value);
}

/** Every covered savings rate, best first. */
export function marketSavingsOptions(entries: readonly CatalogueEntryLike[]): MarketOption[] {
  const out: MarketOption[] = [];
  for (const e of entries) {
    const v = e.fields?.interestPct;
    if (!isCovered(v) || !v) continue;
    out.push(toOption(e, v));
  }
  return out.sort((a, b) => b.value - a.value);
}

/** What the user is leaving on the table by not switching, for a given spend.
 *
 *  Returns null when the market's best is not actually better, so the UI shows
 *  nothing rather than a zero-euro "saving" — and null when the user's own figure
 *  is unknown, because a saving computed against an unknown is a guess dressed as
 *  a number. */
export function fxSwitchGain(
  heldPct: number | null,
  best: MarketOption | undefined,
  spendCents: number,
): { best: MarketOption; savingCents: number } | null {
  if (heldPct === null || !best) return null;
  const delta = heldPct - best.value;
  if (delta <= 0) return null;
  const savingCents = Math.round((spendCents * delta) / 100);
  if (savingCents <= 0) return null;
  return { best, savingCents };
}

/** AN AMBIGUOUS PRODUCT IS NOT AN UNKNOWN WHEN EVERY CANDIDATE AGREES.
 *
 *  An import names his Amex account "American Express / activity", and the
 *  catalogue holds thirteen Amex products. The travel agent therefore asked which
 *  card he has — a fair question, and it turned out not to matter: all thirteen
 *  charge 2,5% on a foreign-currency payment, from the consumer agreement, the
 *  Business Card agreement and the Corporate terms alike. Asking a question whose
 *  answer cannot change the number is a worse experience than answering it.
 *
 *  It stays strict about WHEN it may answer: every covered candidate must agree
 *  exactly, and there must be at least two of them (one product is not a
 *  consensus, it is just that product). Where they differ — as they will for
 *  cashback, where an Amex Gold and a Business Entry are nothing alike — this
 *  returns null and the question is the right thing to ask.
 */
export function issuerConsensus(
  entries: readonly CatalogueEntryLike[],
  issuerSubstring: string,
  field: "fxFeePct" | "interestPct" | "cashbackPct" | "pointsPerEuro",
): { value: number; from: number; asOf: string; sourceUrl: string } | null {
  const needle = issuerSubstring.trim().toLowerCase();
  if (!needle) return null;
  const hits: CatalogValue[] = [];
  for (const e of entries) {
    const hay = `${e.issuer ?? ""} ${e.product}`.toLowerCase();
    if (!hay.includes(needle)) continue;
    const v = e.fields?.[field];
    if (isCovered(v) && v) hits.push(v);
  }
  if (hits.length < 2) return null;
  const first = hits[0].value;
  if (!hits.every((h) => Math.abs(h.value - first) < 1e-9)) return null;
  // Report the OLDEST date among the agreeing figures. They agree on the number;
  // they do not agree on how recently anyone checked, and the weakest link is what
  // the reader should be told.
  const oldest = hits.reduce((a, b) => (a.checkedAt <= b.checkedAt ? a : b));
  return { value: first, from: hits.length, asOf: oldest.checkedAt, sourceUrl: oldest.sourceUrl };
}

/** THE BEST CARD YOU COULD OPEN, for spending rather than for a trip.
 *
 *  Valuta already ranks every bank rather than only his, and the travel agent
 *  already offers what he could switch to. Optimalisatie was the one left asking
 *  only "which of your accounts is best" — a fair question, and not the one that
 *  finds the four percent he was looking for when he said a Trading 212 at 1,5%
 *  cashback and 3,5% savings beats an ING at 0% and 1,5%.
 *
 *  Ranked on what the card RETURNS on a domestic purchase: cashback earned minus
 *  nothing, because a domestic payment carries no FX surcharge. Cards whose
 *  cashback we cannot prove are absent rather than assumed to pay nothing —
 *  "unknown is never zero" applies hardest here, where a zero would rank a good
 *  card last.
 */
export type SpendOffer = {
  productId: string;
  product: string;
  bank: string;
  cashbackPct: number;
  conditions: string | null;
  sourceUrl: string;
  asOf: string;
};

export function marketCashbackOptions(entries: readonly CatalogueEntryLike[]): SpendOffer[] {
  const out: SpendOffer[] = [];
  for (const e of entries) {
    const v = e.fields?.cashbackPct;
    if (!isCovered(v) || !v) continue;
    // A card that pays nothing is a fact worth keeping — it is what lets the app
    // say "your pas earns nothing here" with a source — but it is not an OFFER,
    // and listing it under "what you could open" would be noise.
    if (v.value <= 0) continue;
    const bank = e.issuer ? issuerToBank(e.issuer) : "";
    out.push({
      productId: e.id,
      product: e.product,
      bank,
      cashbackPct: v.value,
      conditions: v.conditions,
      sourceUrl: v.sourceUrl,
      asOf: v.checkedAt,
    });
  }
  return out.sort((a, b) => b.cashbackPct - a.cashbackPct);
}

/** What a year of this spend would earn on the best card he does NOT have, over
 *  what he earns today. Returns null when his own rate is unknown — a saving
 *  measured against an unknown is a guess wearing a number's clothes — and null
 *  when nothing beats what he already earns. */
export function cashbackSwitchGain(
  heldPct: number | null,
  best: SpendOffer | undefined,
  yearlySpendCents: number,
): { best: SpendOffer; extraPerYearCents: number } | null {
  if (heldPct === null || !best) return null;
  const delta = best.cashbackPct - heldPct;
  if (delta <= 0) return null;
  const extraPerYearCents = Math.round((yearlySpendCents * delta) / 100);
  if (extraPerYearCents <= 0) return null;
  return { best, extraPerYearCents };
}
