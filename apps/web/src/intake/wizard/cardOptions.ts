import catalogue from "../../../../../docs/catalog/catalog.json";

type Entry = { id: string; product: string; kind: string };

const entries = (catalogue as { entries: Entry[] }).entries ?? [];

/** The id stored when the card is not in the catalogue. */
export const OTHER_CARD = "other";

/** Which catalogue kind a picker lists: credit cards or debit cards (betaalpassen). */
export type CardKind = "credit" | "debit";

const CATALOGUE_KIND: Record<CardKind, string> = { credit: "creditcard", debit: "betaalpas" };

export type DebitBrand =
  | "ing"
  | "abn"
  | "rabo"
  | "sns-asn-regio"
  | "triodos"
  | "knab"
  | "bunq"
  | "revolut"
  | "n26"
  | "wise"
  | "openbank"
  | "trade-republic"
  | "crypto"
  | "other-brand";

type CreditBrand =
  | "amex"
  | "ics"
  | "ing"
  | "abn"
  | "rabo"
  | "anwb"
  | "bunq"
  | "knab"
  | "sns-asn-regio"
  | "nexo";

export type CardBrand = CreditBrand | DebitBrand;

/** Id prefix to brand, first match wins. Display order is BRAND_ORDER. */
const BRAND_PREFIXES: readonly (readonly [CardBrand, readonly string[]])[] = [
  ["amex", ["american-express-", "flying-blue-american-express-", "klm-american-express-"]],
  ["ics", ["ics-"]],
  ["ing", ["ing-"]],
  ["abn", ["abn-amro-"]],
  ["rabo", ["rabo-", "rabobank-"]],
  ["anwb", ["anwb-"]],
  ["bunq", ["bunq-"]],
  ["knab", ["knab-"]],
  ["sns-asn-regio", ["sns-", "asn-", "regiobank-"]],
  ["nexo", ["nexo-"]],
];

/** Debit brands by id prefix, in display order. */
const DEBIT_PREFIXES: readonly (readonly [DebitBrand, readonly string[]])[] = [
  ["ing", ["ing-"]],
  ["abn", ["abn-amro-"]],
  ["rabo", ["rabobank-"]],
  ["sns-asn-regio", ["sns-", "asn-", "regiobank-"]],
  ["triodos", ["triodos-"]],
  ["knab", ["knab-"]],
  ["bunq", ["bunq-"]],
  ["revolut", ["revolut-"]],
  ["n26", ["n26-"]],
  ["wise", ["wise-"]],
  ["openbank", ["openbank-"]],
  ["trade-republic", ["trade-republic-"]],
  ["crypto", ["bybit-", "krak-", "plutus-"]],
];

const PREFIXES: Record<CardKind, readonly (readonly [CardBrand, readonly string[]])[]> = {
  credit: BRAND_PREFIXES,
  debit: DEBIT_PREFIXES,
};

export const brandOrder = (kind: CardKind = "credit"): readonly CardBrand[] => [
  ...PREFIXES[kind].map(([b]) => b),
  "other-brand",
];
export const BRAND_ORDER: readonly CardBrand[] = brandOrder("credit");

const BRAND_LABELS: Record<CreditBrand, string> = {
  amex: "American Express",
  ics: "ICS (Visa / Mastercard)",
  ing: "ING",
  abn: "ABN AMRO",
  rabo: "Rabobank",
  anwb: "ANWB",
  bunq: "bunq",
  knab: "Knab",
  "sns-asn-regio": "SNS / ASN / RegioBank",
  nexo: "Nexo",
};

export const brandOf = (id: string, kind: CardKind = "credit"): CardBrand =>
  PREFIXES[kind].find(([, ps]) => ps.some((p) => id.startsWith(p)))?.[0] ?? "other-brand";

/** Case-blind and locale-free, so the order is the same on every device. */
export const byName = (a: string, b: string): number => {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : 0;
};

/** Lowercase, accents and punctuation gone, single spaces: both sides of a search. */
export const normalise = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Names people use that the product label does not contain. Curated by card,
 *  never read from the catalogue's issuer text (Amex's says "NOT ICS"). */
const ICS_ISSUED =
  /^(ics-|anwb-|ing-creditcard$|ing-platinumcard$|abn-amro-|rabo|sns-|asn-|regiobank-)/;
function aliasesOf(e: Entry): string {
  const out: string[] = [];
  if (e.kind === CATALOGUE_KIND.debit) return "pinpas";
  if (/american express/i.test(e.product)) out.push("amex");
  if (/flying blue/i.test(e.product)) out.push("klm air france");
  if (ICS_ISSUED.test(e.id)) out.push("ics");
  if (e.id === "bunq-creditcard") out.push("mastercard");
  return out.join(" ");
}

export type Card = { id: string; label: string };

const cardsOf = (kind: CardKind): readonly (Card & { search: string })[] =>
  entries
    .filter((e) => e.kind === CATALOGUE_KIND[kind])
    .map((e) => ({
      id: e.id,
      label: e.product,
      search: normalise(`${e.product} ${aliasesOf(e)}`),
    }))
    .sort((a, b) => byName(a.label, b.label));

const CARDS_BY_KIND: Record<CardKind, readonly (Card & { search: string })[]> = {
  credit: cardsOf("credit"),
  debit: cardsOf("debit"),
};
const CARDS = CARDS_BY_KIND.credit;

/** The catalogue cards a typed query finds, in list order; "another card" is
 *  not among them (the picker always shows it). */
export const matchCards = (query: string, kind: CardKind = "credit"): Card[] => {
  const needle = normalise(query);
  return CARDS_BY_KIND[kind].filter((c) => needle === "" || c.search.includes(needle)).map(
    ({ id, label }) => ({ id, label }),
  );
};

export type CardGroup = { brand: CardBrand; label: string; cards: Card[] };

/** The catalogue cards by brand in display order, each sorted by label; empty
 *  brands are left out. `extra` cards (stated ids the catalogue lacks) join "other". */
export const cardGroups = (
  otherLabel: string,
  extra: readonly Card[] = [],
  kind: CardKind = "credit",
  /** Debit brand names (copy); credit names live in BRAND_LABELS. */
  debitLabels?: Record<Exclude<DebitBrand, "other-brand">, string>,
): CardGroup[] => {
  const all: Card[] = [...CARDS_BY_KIND[kind].map(({ id, label }) => ({ id, label })), ...extra];
  const nameOf = (brand: Exclude<CardBrand, "other-brand">): string =>
    kind === "debit"
      ? (debitLabels?.[brand as Exclude<DebitBrand, "other-brand">] ?? brand)
      : BRAND_LABELS[brand as CreditBrand];
  return brandOrder(kind).map((brand) => ({
    brand,
    label: brand === "other-brand" ? otherLabel : nameOf(brand),
    cards: all
      .filter((c) => brandOf(c.id, kind) === brand)
      .sort((a, b) => byName(a.label, b.label)),
  })).filter((g) => g.cards.length > 0);
};

/** The credit cards of the catalogue, sorted by product, then the
 *  "another card" choice (its label is copy, so the caller passes it). */
export const cardOptions = (otherLabel: string): { id: string; label: string }[] => [
  ...CARDS.map(({ id, label }) => ({ id, label })),
  { id: OTHER_CARD, label: otherLabel },
];

/** A stated card id as a name; an id the catalogue no longer holds shows as is. */
export const cardLabel = (id: string, otherLabel: string, kind: CardKind = "credit"): string =>
  id === OTHER_CARD ? otherLabel : (CARDS_BY_KIND[kind].find((c) => c.id === id)?.label ?? id);
