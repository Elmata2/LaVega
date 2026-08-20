/* CONVERSION ROUTES: ONE ROW PER BANK, RANKED OVER THE WHOLE CATALOGUE.
 *
 * Two complaints from the 20 August review, and they share one answer.
 *
 *  - "Just show one ING, because since we're converting it doesn't matter, just
 *    show the banks once." Valuta listed a row per PRODUCT, so ING arrived three
 *    times (betaalpas, creditcard, Platinumcard) and Rabobank twice under two
 *    spellings ("Rabo GoldCard" is issued by ICS, "Rabobank betaalpas" by
 *    Rabobank). Ranking cards is right for "which card do I pay with abroad" —
 *    `travel.ts` keeps doing that — and wrong for "where do I convert €1.000",
 *    where the product is a detail and the bank is the answer.
 *  - "When I transfer a thousand euros to USD it should choose the best account
 *    or bank, and if the user wants to change they can choose through all the
 *    banks available and the fee difference." So the ranking runs over the
 *    catalogue's 73 covered surcharges, not only the cards he holds.
 *
 * WHAT COLLAPSING MAY NOT DO, because a merge is where figures go missing:
 *  1. Never silently drop a bank. A bank he holds appears even with no figure at
 *     all — as UNKNOWN, which is not 0% (`pct: null`).
 *  2. Never hide which product earns the rate. A collapsed row always names the
 *     product its figure belongs to; "ING is 0%" is only true of the Platinumcard.
 *  3. Never let his own product be overstated. When he holds the bank, the row is
 *     priced on HIS product where we can identify it (`mine: true`) and the
 *     cheaper product at the same bank is named beside it rather than swapped in.
 *  4. Never rank a bank he does not hold as if he could use it (`held`), because
 *     recommending a transfer he cannot make is advice that fails on contact.
 *
 * ONE MEANING PER COLUMN. `pct` is always the foreign-currency surcharge
 * (koersopslag) as the provider's own tariff document states it. The travel
 * agent also learns `convertFeePct` — an in-app conversion fee — and it is
 * deliberately NOT folded in here: a column whose meaning changes per row cannot
 * be ranked honestly, and every tariff document we read states the koersopslag.
 *
 * Pure: catalogue entries, accounts and facts in, rows out. No clock, no I/O.
 */
import type { Account } from "./model.js";
import { isCovered } from "./catalog.js";
import { issuerToBank, type CatalogueEntryLike } from "./catalogRates.js";
import { factNumber, factEntry, type FactSource, type LearnedFact } from "./facts.js";
import { TRAVEL_AGENT, isSpendable, productOf, providerOf } from "./travel.js";

/** Words that name the KIND of card. A trailing run of these (with its tier
 *  words) is packaging, not the bank. */
const TYPE_WORDS = new Set([
  "card", "cards", "kaart", "creditcard", "credit", "betaalpas", "pas", "prepaid",
  "debit", "visa", "mastercard", "maestro", "platinumcard", "goldcard",
]);

/** Words that name the TIER of a card. Stripped only in the company of a type
 *  word — "Flying Blue" is half a brand, "American Express Blue Card" is a tier. */
const TIER_WORDS = new Set([
  "classic", "silver", "gold", "platinum", "black", "panda", "world", "business",
  "corporate", "entry", "green", "blue", "standard", "plus", "premium", "metal",
  "smart", "go", "free", "core", "elite", "pro", "basic", "private", "max", "extra", "more",
]);

/** The few brands whose own product name does not carry them. Kept deliberately
 *  short: a table like this rots, so it holds only names where the alternative is
 *  a row he would not recognise as a bank. "212 Card" is the case that forced it
 *  — he calls it Trading 212 (review item 8), and a row labelled "212" is not a
 *  bank anyone can act on. */
const BRAND_ALIASES: Record<string, string> = {
  "212": "Trading 212",
  amex: "American Express",
};

/** Bank keys that mean the same bank under two names people actually type.
 *  Same discipline as BRAND_ALIASES: only where normalisation cannot get there. */
const KEY_ALIASES: Record<string, string> = {
  amex: "americanexpress",
  t212: "trading212",
  "212": "trading212",
  abn: "abnamro",
};

const wordOf = (s: string): string => s.toLowerCase().replace(/[^a-z0-9.]/g, "");

/** The bank a card belongs to, as the owner would name it.
 *
 *  Reads the PRODUCT name first and the issuer only as a fallback, because the
 *  issuer is the legal entity and not the bank he thinks he is dealing with: ICS
 *  issues "ING creditcard", and grouping on the issuer would file his ING card
 *  under "International Card Services". */
export function fxBrandOf(product: string, issuer?: string): string {
  const fallback = () => (issuer ? issuerToBank(issuer) : "");
  // Everything after a spaced dash is a variant name ("Crypto.com Prepaid Card —
  // Private (Obsidian)"), and a parenthesis is always a gloss.
  const head = String(product ?? "")
    .split(/\s+[—–-]\s+/)[0]
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = head.split(" ").filter(Boolean);
  if (words.length === 0) return fallback();

  // The longest trailing run of type/tier words, kept only if it actually names
  // a card kind — otherwise "Flying Blue" loses its Blue.
  let cut = words.length;
  let sawType = false;
  for (let i = words.length - 1; i >= 0; i--) {
    const w = wordOf(words[i]);
    if (TYPE_WORDS.has(w)) { sawType = true; cut = i; continue; }
    if (TIER_WORDS.has(w)) { cut = i; continue; }
    break;
  }
  const kept = sawType ? words.slice(0, cut) : words;
  // Stripping everything would leave no brand at all ("Creditcard"): the issuer
  // is then the only thing left that names a bank.
  if (kept.length === 0) return fallback();
  const brand = kept.join(" ");
  return BRAND_ALIASES[wordOf(brand)] ?? brand;
}

/** One bank, one key, whatever it is called. "Rabo" and "Rabobank", "ASN" and
 *  "ASN Bank" are the same bank; the trailing "Bank" is dropped only when a name
 *  survives it, so "N26 Bank" keys as "n26" and plain "Bank" keys as itself. */
export function fxBankKey(name: string): string {
  const flat = String(name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const stripped = flat.endsWith("bank") && flat.length - 4 >= 3 ? flat.slice(0, -4) : flat;
  return KEY_ALIASES[stripped] ?? stripped;
}

/** Same bank under two spellings. Key equality first; a prefix only counts from
 *  four characters up, so a three-letter bank ("ING", "ICS", "SNS") can never be
 *  swallowed by a longer name that merely starts the same way. */
function sameBank(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && long.startsWith(short);
}

type Candidate = {
  pct: number;
  product: string;
  brand: string;
  origin: "user" | "agent" | "catalog";
  asOf: string | null;
  sourceUrl: string | null;
  conditions: string | null;
  /** A product he actually holds — his real cost, not the shelf's best. */
  mine: boolean;
  /** The catalogue's own product class ("betaalpas", "creditcard", "prepaid",
   *  "crypto"), or null for a figure that came from the vault. */
  kind: string | null;
  /** Only catalogue rows count as "collapsed products" in the row's tally. */
  fromCatalogue: boolean;
};

export type FxRouteOption = {
  /** The bank, ONCE. */
  bank: string;
  /** Stable identity for selection and for matching his own accounts. */
  key: string;
  /** The koersopslag in percent, or null when we cannot establish it. Null is
   *  never rendered as 0 and never ranked as if it were. */
  pct: number | null;
  /** The product `pct` belongs to. A rate without its product is not actionable. */
  product: string | null;
  /** True when `pct` is the figure for a product he holds. */
  mine: boolean;
  /** True when he holds an account at this bank at all. */
  held: boolean;
  /** What kind of product the figure belongs to. Carried because the cheapest
   *  rows in the real catalogue are crypto and prepaid cards, not bank accounts:
   *  they are ranked on the same evidence as everything else, but a screen that
   *  puts one first without saying what it is has answered a question he did not
   *  ask. Deciding whether to hold one is his call, and he can only make it if
   *  the row admits what it is. */
  kind: string | null;
  /** His own accounts' product names at this bank, for the copy that names them. */
  heldProducts: string[];
  /** A cheaper product at the SAME bank than the one he holds. */
  cheaperAtSameBank: { product: string; pct: number } | null;
  /** Every catalogue product at this bank charges the same — so the figure holds
   *  whichever of them he has, and the row needs no "which product is yours"
   *  caveat. True only with more than one product to agree. */
  uniformAcrossBank: boolean;
  /** How many catalogue products folded into this row. */
  collapsed: number;
  origin: "user" | "agent" | "catalog" | null;
  asOf: string | null;
  sourceUrl: string | null;
  conditions: string | null;
  /** One Dutch line saying where the figure comes from and what it does not say. */
  why: string;
};

const pctText = (n: number): string => `${n.toFixed(2).replace(/0+$/, "").replace(/[.,]$/, "").replace(".", ",")}%`;

/** Which candidate speaks for the bank.
 *
 *  A figure for a product he HOLDS wins first: it is his actual cost, and the
 *  shelf's cheapest product is not something he owns. Within that, the order is
 *  the project's precedence rule — what he entered himself outranks every agent,
 *  and a covered catalogue figure (value, source, date AND conditions) outranks a
 *  learned agent fact, which may have come from a comparison table. */
function rank(c: Candidate): number {
  const base = c.mine ? 0 : 10;
  const bySource = c.origin === "user" ? 0 : c.origin === "catalog" ? 1 : 2;
  return base + bySource;
}

function pickCandidate(group: Candidate[]): Candidate | null {
  if (group.length === 0) return null;
  return [...group].sort((a, b) => {
    const d = rank(a) - rank(b);
    if (d !== 0) return d;
    // Same standing: the cheaper figure, then the more recent, then by name so
    // the list cannot reshuffle between renders.
    if (a.pct !== b.pct) return a.pct - b.pct;
    if ((a.asOf ?? "") !== (b.asOf ?? "")) return (b.asOf ?? "").localeCompare(a.asOf ?? "");
    return a.product.localeCompare(b.product);
  })[0];
}

function whyLine(o: Omit<FxRouteOption, "why">): string {
  if (o.pct === null) {
    return o.held
      ? "Voorwaarden van deze bank nog onbekend — en onbekend is geen 0%."
      : "Geen tarief dat LaVega kan onderbouwen.";
  }
  const head = `${pctText(o.pct)} koersopslag op ${o.product}`;
  if (o.mine) {
    return o.cheaperAtSameBank
      ? `${head} — bij dezelfde bank rekent ${o.cheaperAtSameBank.product} ${pctText(o.cheaperAtSameBank.pct)}.`
      : `${head}.`;
  }
  // Every product at this bank agrees, so naming one of them would suggest the
  // figure depends on which — it does not.
  if (o.uniformAcrossBank) {
    const all = `${pctText(o.pct)} koersopslag — hetzelfde bij alle ${o.collapsed} ${o.bank}-producten die LaVega kent`;
    return o.held ? `${all}.` : `${all}. Deze bank heb je niet.`;
  }
  if (o.held) return `${head} — of jouw pakket bij deze bank hetzelfde rekent, weet LaVega niet.`;
  return `${head} — deze bank heb je niet.`;
}

/** Every bank you could convert through, cheapest first, one row each. */
export function rankFxRoutes(input: {
  accounts: readonly Account[];
  facts: readonly LearnedFact[];
  entries: readonly CatalogueEntryLike[];
}): FxRouteOption[] {
  const { accounts, facts, entries } = input;

  // His own payment products, keyed by bank. Savings and investment accounts are
  // not conversion routes on their own — `isSpendable` is the same filter the
  // travel ranking uses, and skipping it would let a Spaarrekening inherit its
  // bank's card terms.
  const heldByKey = new Map<string, { bank: string; products: string[] }>();
  for (const a of accounts) {
    if (!isSpendable(a)) continue;
    const bank = providerOf(a);
    const key = fxBankKey(bank);
    const entry = heldByKey.get(key) ?? { bank, products: [] };
    // The fuller spelling is the one a person recognises ("Rabobank", not "Rabo").
    if (bank.length > entry.bank.length) entry.bank = bank;
    const product = productOf(a);
    if (product && !entry.products.includes(product)) entry.products.push(product);
    heldByKey.set(key, entry);
  }
  const myProducts = new Set([...heldByKey.values()].flatMap((h) => h.products.map((p) => p.toLowerCase())));

  const candidates: Candidate[] = [];

  for (const e of entries) {
    const v = e.fields?.fxFeePct;
    if (!isCovered(v) || !v) continue; // an uncovered figure is refused, not shown
    const brand = fxBrandOf(e.product, e.issuer);
    if (!brand) continue;
    candidates.push({
      pct: v.value,
      product: e.product,
      brand,
      origin: "catalog",
      asOf: v.checkedAt,
      sourceUrl: v.sourceUrl,
      conditions: v.conditions,
      mine: myProducts.has(e.product.toLowerCase()),
      kind: e.kind ?? null,
      fromCatalogue: true,
    });
  }

  // What the vault knows about his own cards — including the corrections he made
  // himself, which outrank everything the catalogue says about the same product.
  for (const h of heldByKey.values()) {
    for (const product of h.products) {
      const pct = factNumber(facts, TRAVEL_AGENT, product, "fxFeePct");
      if (pct === null) continue;
      const entry = factEntry(facts, TRAVEL_AGENT, product, "fxFeePct");
      const source: FactSource = entry?.source === "user" ? "user" : "agent";
      candidates.push({
        pct,
        product,
        brand: h.bank,
        origin: source,
        asOf: entry?.updatedAt ?? null,
        sourceUrl: null,
        conditions: entry?.note ?? null,
        mine: true,
        kind: null,
        fromCatalogue: false,
      });
    }
  }

  // Group by bank. Held banks seed the groups so a bank he holds is present even
  // when nothing at all is known about it.
  const groups: { key: string; bank: string; items: Candidate[] }[] = [];
  const findGroup = (key: string) => groups.find((g) => sameBank(g.key, key));

  for (const [key, h] of heldByKey) {
    if (!findGroup(key)) groups.push({ key, bank: h.bank, items: [] });
  }
  for (const c of candidates) {
    const key = fxBankKey(c.brand);
    const g = findGroup(key);
    if (g) {
      g.items.push(c);
      if (c.brand.length > g.bank.length) g.bank = c.brand;
    } else {
      groups.push({ key, bank: c.brand, items: [c] });
    }
  }

  const rows = groups.map((g): FxRouteOption => {
    const held = [...heldByKey.entries()].find(([k]) => sameBank(k, g.key));
    const chosen = pickCandidate(g.items);
    const cheapest = g.items.reduce<Candidate | null>((best, c) => (best === null || c.pct < best.pct ? c : best), null);
    const cheaper =
      chosen && cheapest && chosen.mine && cheapest.pct < chosen.pct - 0.0001
        ? { product: cheapest.product, pct: cheapest.pct }
        : null;
    const fromCatalogue = g.items.filter((c) => c.fromCatalogue);
    const uniform =
      fromCatalogue.length > 1 && fromCatalogue.every((c) => Math.abs(c.pct - fromCatalogue[0].pct) < 0.0001);
    const base: Omit<FxRouteOption, "why"> = {
      bank: g.bank,
      key: g.key,
      pct: chosen?.pct ?? null,
      product: chosen?.product ?? null,
      mine: chosen?.mine ?? false,
      kind: chosen?.kind ?? null,
      held: held !== undefined,
      heldProducts: held ? [...held[1].products] : [],
      cheaperAtSameBank: cheaper,
      uniformAcrossBank: uniform,
      collapsed: fromCatalogue.length,
      origin: chosen?.origin ?? null,
      asOf: chosen?.asOf ?? null,
      sourceUrl: chosen?.sourceUrl ?? null,
      conditions: chosen?.conditions ?? null,
    };
    return { ...base, why: whyLine(base) };
  });

  return rows.sort((a, b) => {
    // Unknown never outranks a figure: it is a risk, not a cheap route.
    if ((a.pct === null) !== (b.pct === null)) return a.pct === null ? 1 : -1;
    if (a.pct !== null && b.pct !== null && a.pct !== b.pct) return a.pct - b.pct;
    // Same price: a route he can actually use beats one he would have to open.
    if (a.held !== b.held) return a.held ? -1 : 1;
    return a.bank.localeCompare(b.bank);
  });
}

/** The route to price the transfer with unless he picks another.
 *
 *  Deliberately NOT the market's best: defaulting to a bank he does not hold puts
 *  a number on the screen for a transfer he cannot make. The cheaper stranger is
 *  still listed, still priced against this one, one click away.
 *
 *  And deliberately not simply the cheapest bank he holds. Among his own banks the
 *  order is how sure we are the figure is HIS: a figure for a product he holds
 *  first, then a bank where every known product charges the same (so which one he
 *  has cannot change the answer), and only then a bank where the cheapest figure
 *  belongs to a package he may not be on. bunq is the case that decides it — bunq
 *  Free charges 3% and bunq Core 0,5%, so leading with 0,5% because he "has bunq"
 *  would understate a transfer by six times. */
export function fxRouteDefault(options: readonly FxRouteOption[]): FxRouteOption | null {
  const usable = options.filter((o) => o.held && o.pct !== null);
  return (
    usable.find((o) => o.mine) ??
    usable.find((o) => o.uniformAcrossBank) ??
    usable[0] ??
    null
  );
}

/** What an alternative costs against the chosen route, in the currency being
 *  sent. Negative means it saves that much. Null when either side is unknown — a
 *  difference against an unknown is a guess with a euro sign on it. */
export function fxExtraCost(
  option: FxRouteOption,
  base: FxRouteOption | null,
  amount: number,
): number | null {
  if (!base || option.pct === null || base.pct === null) return null;
  return Math.round(((option.pct - base.pct) / 100) * amount * 100) / 100;
}
