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
 * WAT DE RANGSCHIKKING TOT 21 AUGUSTUS NEGEERDE: WAT DE REKENING KOST.
 *
 * Dit scherm was de vierde plek met een aanbeveling en de laatste die alleen aan
 * de opslag rekende. Op een conversie van € 1.000 scheelt 1,4% tegen 0% veertien
 * euro — en een kaart die daarvoor € 16,90 per maand vraagt is niet veertien euro
 * goedkoper maar bijna drie euro DUURDER. Zolang alleen het percentage in de
 * volgorde zat, stond die kaart bovenaan met "€ 14,00 minder" ernaast: een getal
 * dat klopt over de helft van de rekening waar de lezer niet naar kon kijken.
 *
 * Dat is precies het geval waarvoor `netBenefit.ts` bestaat, en het is er ook het
 * zuiverste geval van. Een conversie is EENMALIG en een maandprijs is
 * TERUGKEREND, dus ze mogen niet van elkaar af zonder periode; de horizon staat
 * in `FX_CONVERSION_HORIZON_MONTHS` en het antwoord draagt hem terug mee in
 * `holdingBasis`, zodat het scherm hem kan noemen en de lezer ons kan nakijken.
 *
 * De drie toestanden komen ook hier uit het TYPE en niet uit een boolean ernaast:
 * `FxRouteDelta` en `FxRouteSwitch.net` hebben allebei een variant zonder
 * nettobedrag voor de rijen waarvan we de prijs niet kennen. Onbekend is geen nul
 * — het is ook geen reden om de rij te verzwijgen, dus hij komt bruto door met de
 * reden erbij, en het woord "netto" valt daar niet.
 *
 * EN EEN BANK DIE HIJ AL HEEFT KOST HEM NIETS EXTRA: die prijs loopt toch al, of
 * hij er nu doorheen wisselt of niet. `marginalHoldingCost` maakt daar een
 * BEKENDE nul van, en dat is wat de gelijkspelregel onderaan overeind houdt (zie
 * `rankFxRoutes`) in plaats van hem te breken.
 *
 * Pure: catalogue entries, accounts and facts in, rows out. No clock, no I/O.
 */
import type { Account } from "./model.js";
import { isCovered } from "./catalog.js";
import { productFeesById } from "./accountCosts.js";
import { issuerToBank, type CatalogueEntryLike } from "./catalogRates.js";
import { factNumber, factEntry, type FactSource, type LearnedFact } from "./facts.js";
import {
  holdingCostOfProduct,
  marginalHoldingCost,
  netBenefit,
  type HoldingCost,
  type HoldingCostUnknownReason,
  type NetBasis,
  type NetBenefit,
} from "./netBenefit.js";
import { TRAVEL_AGENT, isSpendable, productOf, providerOf } from "./travel.js";

/** OVER HOEVEEL MAANDEN EEN CONVERSIE DE PRODUCTPRIJS DRAAGT: nul, en dat is geen
 *  typefout maar het hele punt.
 *
 *  Een reis duurt weken, een conversie duurt een moment. De eerlijke horizon van
 *  "zet vandaag € 1.000 om" is dus nul maanden — en juist dan doet de ONDERGRENS
 *  van `netBenefit` zijn werk: er wordt één hele factureringsperiode gerekend,
 *  want je kunt geen rekening voor een dag openen. Nul doorgeven in plaats van
 *  één is wat `basis.flooredToMinimum` op true zet, en dát is het verschil tussen
 *  een scherm dat "over 1 maand" zegt en een scherm dat er ook bij zegt waarom.
 *
 *  Toen hier eerst één stond, was de rekensom identiek en de zin verdwenen: het
 *  bedrag klopte, maar de lezer kon nergens zien dat een conversie van vijf
 *  seconden een hele maand kaart kost. Dezelfde fout die netBenefit.ts in zijn
 *  eigen kop beschrijft, een laag hoger. */
export const FX_CONVERSION_HORIZON_MONTHS = 0;

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
  /** De catalogusrij waar dit tarief vandaan komt, of null voor een figuur uit de
   *  kluis. De id is wat de PRIJS van dit product vindt (`productFeesById`); een
   *  productnaam is daar niet genoeg voor, want de prijs staat vaak op de rij van
   *  het pakket en niet op die van de kaart. */
  productId: string | null;
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
  /** One Dutch line saying where the figure comes from and what it does not say.
   *  Over de KOERSOPSLAG, en alleen daarover — wat het product kost om te hebben
   *  staat in `holdingCost` en wordt door het scherm met dezelfde woorden gerend
   *  als op Overzicht. Twee zinnen die hetzelfde zeggen in andere woorden zijn
   *  een fout op zichzelf, dus deze zin blijft van één ding. */
  why: string;
  /** WAT DIT PRODUCT KOST OM TE HEBBEN, marginaal.
   *
   *  Een BEKENDE nul zodra hij de bank al heeft: die prijs loopt toch al door, dus
   *  hij is geen gevolg van deze conversie. Zie `marginalHoldingCost` — dat is de
   *  val waar dit veld voor bestaat, en het is ook wat de gelijkspelregel in de
   *  sortering veilig maakt. */
  holdingCost: HoldingCost;
  /** Over welke periode `totalCostCents` de productprijs telt, en of daarvoor een
   *  hele factureringsperiode is gerekend. Null als er geen prijs bekend is: dan
   *  is er ook geen periode om te noemen, en een periode zonder bedrag suggereert
   *  een bedrag. */
  holdingBasis: NetBasis | null;
  /** De koersopslag op het bedrag waarmee gerangschikt is, in EUROCENTEN. Null
   *  als er geen tarief is — nooit 0. */
  conversionCostCents: number | null;
  /** Wat deze route deze conversie kost: de opslag hierboven plus de productprijs
   *  over `FX_CONVERSION_HORIZON_MONTHS`. Dit is waarop gerangschikt wordt, want
   *  het is de enige noemer waarop een percentage en een maandprijs samen kunnen
   *  komen. Null als er geen tarief is. */
  totalCostCents: number | null;
  /** false als de productprijs onbekend is. `totalCostCents` is dan alleen de
   *  opslag en dus een ONDERGRENS van wat deze route kost — geen volledig bedrag,
   *  en zeker geen bewijs dat de rekening gratis is. */
  totalCostKnown: boolean;
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

/** Every bank you could convert through, cheapest first, one row each.
 *
 *  HET BEDRAG IS VERPLICHT, en dat is een besluit en geen omissie. Een percentage
 *  en een maandprijs kunnen alleen bij elkaar komen op een bedrag; zonder bedrag
 *  valt er geen volgorde te maken die de kosten van de rekening meeneemt, en de
 *  vorige versie liet dat merken door ze weg te laten. Een standaardbedrag
 *  verzinnen zou erger zijn: dan rangschikt het scherm op een som die niemand
 *  gevraagd heeft.
 *
 *  EN HET BEDRAG IS IN EURO'S, wat de reden is dat het veld zo heet.
 *  Koersopslag is een PERCENTAGE en past zich aan elke valuta aan; een
 *  productprijs is een BEDRAG uit een Nederlands tarievendocument en staat in
 *  euro's. Wie duizend dollar omzet en daar € 16,90 kaartkosten bij optelt, telt
 *  twee valuta's bij elkaar op en noemt de uitkomst een totaal — dezelfde soort
 *  fout als maand tegen jaar, alleen minder zichtbaar omdat er geen factor twaalf
 *  uit komt maar een factor die per dag verandert. De aanroeper rekent het bedrag
 *  dus eerst naar euro's om (hij heeft de middenkoers al op het scherm) en krijgt
 *  alles in eurocenten terug. Andersom kan niet: de kaartprijs naar dollars
 *  omrekenen zou een bedrag verzinnen dat in geen enkel document staat. */
export function rankFxRoutes(input: {
  accounts: readonly Account[];
  facts: readonly LearnedFact[];
  entries: readonly CatalogueEntryLike[];
  /** Wat er wordt omgezet, in EURO'S. Zie hierboven waarom niet in de verstuurde
   *  valuta. */
  amountEur: number;
}): FxRouteOption[] {
  const { accounts, facts, entries } = input;
  // Een leeg of onzinnig invoerveld is geen bedrag. Dat telt als nul in plaats van
  // als NaN de rangschikking in te sturen: bij nul euro overzetten kost de opslag
  // niets en blijft alleen over wat een rekening kost om te openen — wat het
  // juiste antwoord is op die vraag, en niet een lijst in willekeurige volgorde.
  const amountEur = Number.isFinite(input.amountEur) && input.amountEur > 0 ? input.amountEur : 0;
  // Wat elk catalogusproduct kost om te hebben. Gedeeld met de reisagent via
  // accountCosts.ts en hier NIET nagebouwd: de koppeling tussen een kaartrij en de
  // pakketrij waar haar prijs op staat (de € 16,90 van N26 Metal staat op
  // `n26-metal`, niet op `n26-metal-betaalpas`) is subtiel genoeg dat een tweede
  // kopie uit elkaar loopt — en dan zegt Overzicht € 16,90 waar Valuta "onbekend"
  // zegt over hetzelfde product.
  const fees = productFeesById(entries);

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
      productId: e.id,
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
        // Een figuur uit de kluis hangt aan een product van HEM, niet aan een
        // catalogusrij. Er is dus geen id om een prijs mee op te zoeken — en er
        // hoeft er ook geen te zijn: bij een bank die hij heeft zijn de marginale
        // kosten nul, wat de rij hieronder als BEKENDE nul invult.
        productId: null,
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

    // WAT DEZE ROUTE KOST OM TE OPENEN, marginaal. Bij een bank die hij heeft is
    // dat een BEKENDE nul — die prijs loopt toch al door — en bij een bank die hij
    // moet openen de prijs van het product waar dit tarief bij hoort. Staat die
    // prijs nergens, dan blijft hij onbekend en wordt hij hieronder als zodanig
    // gedragen, niet als nul.
    const isHeld = held !== undefined;
    const holdingCost = marginalHoldingCost(
      holdingCostOfProduct(chosen?.productId ? fees.get(chosen.productId) : null),
      isHeld,
    );
    // Nul voordeel: hier wordt niets vergeleken, alleen de PRIJS van dit product
    // over de horizon uitgerekend. Langs `netBenefit` en niet met de hand, zodat de
    // horizonregel (naar boven afronden, ondergrens één hele periode) op één plek
    // staat en dit scherm er geen tweede van maakt — dezelfde route die
    // `marketCardOffers` neemt, en om dezelfde reden.
    const over = netBenefit({
      benefit: { kind: "one-off", cents: 0 },
      cost: holdingCost,
      horizonMonths: FX_CONVERSION_HORIZON_MONTHS,
    });
    // Onbekende kosten tellen als NIETS IN DIT GETAL — niet omdat ze nul zijn, maar
    // omdat er niets is om op te tellen. Daarom reist `totalCostKnown` mee: dit
    // bedrag is dan een ondergrens. Ze op oneindig zetten zou de andere fout maken
    // en driekwart van de catalogus onderaan gooien, inclusief de 0%-kaarten die de
    // vergelijking de moeite waard maken.
    const holdingCents = over.kind === "gross-cost-unknown" ? 0 : over.costCents;
    const conversionCostCents = chosen ? Math.round((chosen.pct / 100) * amountEur * 100) : null;

    const base: Omit<FxRouteOption, "why"> = {
      bank: g.bank,
      key: g.key,
      pct: chosen?.pct ?? null,
      product: chosen?.product ?? null,
      mine: chosen?.mine ?? false,
      kind: chosen?.kind ?? null,
      held: isHeld,
      heldProducts: held ? [...held[1].products] : [],
      cheaperAtSameBank: cheaper,
      uniformAcrossBank: uniform,
      collapsed: fromCatalogue.length,
      origin: chosen?.origin ?? null,
      asOf: chosen?.asOf ?? null,
      sourceUrl: chosen?.sourceUrl ?? null,
      conditions: chosen?.conditions ?? null,
      holdingCost,
      holdingBasis: over.kind === "gross-cost-unknown" ? null : over.basis,
      conversionCostCents,
      totalCostCents: conversionCostCents === null ? null : conversionCostCents + holdingCents,
      totalCostKnown: holdingCost.kind === "known",
    };
    return { ...base, why: whyLine(base) };
  });

  return rows.sort((a, b) => {
    // 1. GEEN TARIEF IS GEEN GOEDKOPE ROUTE. Onbekend gaat onderaan; het is een
    //    risico, niet een aanbieding.
    if ((a.totalCostCents === null) !== (b.totalCostCents === null)) return a.totalCostCents === null ? 1 : -1;
    // 2. HET GOEDKOOPST OVER DE HELE CONVERSIE: de opslag op dit bedrag plus wat de
    //    rekening kost om te openen. Op de opslag alleen won een kaart van 0% met
    //    € 16,90 per maand van een kaart van 1,4% die hij al heeft, terwijl die
    //    eerste hem bijna drie euro kost.
    if (a.totalCostCents !== null && b.totalCostCents !== null && a.totalCostCents !== b.totalCostCents) {
      return a.totalCostCents - b.totalCostCents;
    }
    // 3. WAT WE KUNNEN AANTONEN, boven wat we niet weten. Bij hetzelfde bedrag wint
    //    de route waarvan de prijs vaststaat: van de ander weten we alleen dat er
    //    nog iets bij kan komen.
    if (a.totalCostKnown !== b.totalCostKnown) return a.totalCostKnown ? -1 : 1;
    // 4. EEN ROUTE DIE HIJ VANDAAG KAN GEBRUIKEN. Zijn eigen gelijkspelregel, en
    //    regel 3 kan hem niet meer in de weg zitten: een bank die hij heeft kost
    //    marginaal niets en die nul is BEKEND, dus zo'n rij is nooit degene die op
    //    regel 3 zakt. Zouden de kosten ook bij zijn eigen banken meegeteld worden,
    //    dan vochten die twee regels wél — en dan stuurde de app hem een rekening
    //    openen om kosten te ontlopen die hij toch al maakt.
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

/* ─────────────────────────────────────────── wat een andere route zou schelen */

/** WAT EEN ALTERNATIEF MEER KOST DAN DE GEKOZEN ROUTE, in EUROCENTEN. Positief is
 *  duurder, negatief is goedkoper.
 *
 *  Drie toestanden, uit het TYPE en niet uit een vlag ernaast — hetzelfde besluit
 *  als in netBenefit.ts, want het is hetzelfde probleem:
 *
 *   · `net` — van beide routes weten we wat de rekening kost, dus het verschil is
 *     het HELE verschil: opslag plus wat er aan maand- of jaarprijs bij komt.
 *   · `gross-cost-unknown` — van minstens één van de twee kennen we die prijs niet.
 *     Dan is het verschil alleen dat in KOERSOPSLAG, met de reden erbij, en het
 *     woord netto valt er niet. Bruto is hier geen bovengrens maar een ONDERGRENS
 *     van wat het gaat kosten: de onbekende prijs kan er alleen bij komen.
 *   · `unknown` — aan minstens één kant is er geen tarief. Een verschil tegen een
 *     onbekende is een gok met een euroteken ervoor.
 *
 *  Er gaat GEEN bedrag in: beide rijen zijn door dezelfde `rankFxRoutes`-aanroep
 *  op hetzelfde bedrag geprijsd. Dat is met opzet — een verschil uitrekenen op een
 *  ander bedrag dan waarop de lijst gerangschikt is, geeft een rij die lager staat
 *  met een lager bedrag ernaast, en dat leest als een fout in de app. */
export type FxRouteDelta =
  | { kind: "net"; cents: number }
  | { kind: "gross-cost-unknown"; cents: number; reason: HoldingCostUnknownReason }
  | { kind: "unknown" };

export function fxRouteDelta(option: FxRouteOption, base: FxRouteOption | null): FxRouteDelta {
  if (base === null) return { kind: "unknown" };
  // Welke van de twee het gat heeft doet er voor de UITKOMST niet toe — één
  // onbekende prijs maakt het totaal aan die kant onvolledig — maar wel voor de
  // MELDING: "geen bron noemt de prijs" en "de prijs geldt bovenop een ander
  // product" vragen iets anders van de lezer.
  const gap =
    option.holdingCost.kind === "unknown"
      ? option.holdingCost
      : base.holdingCost.kind === "unknown"
        ? base.holdingCost
        : null;
  if (gap === null) {
    const mine = option.totalCostCents;
    const theirs = base.totalCostCents;
    return mine === null || theirs === null ? { kind: "unknown" } : { kind: "net", cents: mine - theirs };
  }
  const mine = option.conversionCostCents;
  const theirs = base.conversionCostCents;
  return mine === null || theirs === null
    ? { kind: "unknown" }
    : { kind: "gross-cost-unknown", cents: mine - theirs, reason: gap.reason };
}

/** WAT OVERSTAPPEN OPLEVERT, met de prijs van de rekening erin verrekend.
 *
 *  Hetzelfde antwoord als `offerSwitchGain` voor kaarten geeft, en met opzet
 *  dezelfde vorm: `savingCents` blijft BRUTO — het verschil in koersopslag, want
 *  dat is wat een percentage zegt — en `net` draagt de drie toestanden. De twee
 *  naast elkaar in plaats van één samengevoegd getal, omdat een rekening met
 *  onbekende prijs geen netto HEEFT en een brutobedrag dat "netto" heet precies de
 *  fout is die netBenefit.ts bestaat om te voorkomen.
 *
 *  Het alternatief is de EERSTE andere rij, en dat is geen willekeurige keuze: de
 *  lijst staat al op totale kosten gesorteerd, dus de eerste die niet de gekozen
 *  route is, is de beste die er is. Een alternatief dat alleen op de opslag wint
 *  komt zo nooit meer bovendrijven — dat is namelijk exact de kaart waar deze hele
 *  ronde over gaat.
 *
 *  Null als er niets te melden valt: geen route, geen tarief, of geen lagere
 *  opslag. Een "voordeel" van nul of minder is geen bericht maar ruis — en let op
 *  dat null iets ANDERS is dan een netto dat op nul uitkomt: dat laatste komt er
 *  wél doorheen, met `kind: "no-recommendation"`, want dat is juist het geval dat
 *  hij wil kunnen zien in plaats van zelf uitrekenen. */
export type FxRouteSwitch = {
  option: FxRouteOption;
  /** Wat je op dit bedrag minder aan KOERSOPSLAG betaalt, in centen. Bruto. */
  savingCents: number;
  /** Datzelfde voordeel met de prijs van de rekening ertegenover, over
   *  `FX_CONVERSION_HORIZON_MONTHS` — dus met de ondergrens van één hele
   *  factureringsperiode erin, en de periode zit in `net.basis`. */
  net: NetBenefit;
};

export function fxRouteSwitch(base: FxRouteOption | null, options: readonly FxRouteOption[]): FxRouteSwitch | null {
  if (base === null || base.conversionCostCents === null) return null;
  const option = options.find((o) => o.key !== base.key && o.conversionCostCents !== null);
  if (!option || option.conversionCostCents === null) return null;
  const savingCents = base.conversionCostCents - option.conversionCostCents;
  if (savingCents <= 0) return null;
  return {
    option,
    savingCents,
    net: netBenefit({
      benefit: { kind: "one-off", cents: savingCents },
      cost: option.holdingCost,
      horizonMonths: FX_CONVERSION_HORIZON_MONTHS,
    }),
  };
}
