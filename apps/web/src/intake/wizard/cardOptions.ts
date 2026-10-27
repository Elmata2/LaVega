import catalogue from "../../../../../docs/catalog/catalog.json";

type Entry = { id: string; product: string; kind: string };

const entries = (catalogue as { entries: Entry[] }).entries ?? [];

/** The id stored when the card is not in the catalogue. */
export const OTHER_CARD = "other";

const personal = (e: Entry) =>
  e.kind === "creditcard" && !/business|corporate/i.test(e.product);

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
  if (/american express/i.test(e.product)) out.push("amex");
  if (/flying blue/i.test(e.product)) out.push("klm air france");
  if (ICS_ISSUED.test(e.id)) out.push("ics");
  if (e.id === "bunq-creditcard") out.push("mastercard");
  return out.join(" ");
}

type Card = { id: string; label: string };

const CARDS: readonly (Card & { search: string })[] = entries
  .filter(personal)
  .map((e) => ({
    id: e.id,
    label: e.product,
    search: normalise(`${e.product} ${aliasesOf(e)}`),
  }))
  .sort((a, b) => byName(a.label, b.label));

/** The catalogue cards a typed query finds, in list order; "another card" is
 *  not among them (the picker always shows it). */
export const matchCards = (query: string): Card[] => {
  const needle = normalise(query);
  return CARDS.filter((c) => needle === "" || c.search.includes(needle)).map(
    ({ id, label }) => ({ id, label }),
  );
};

/** The personal credit cards of the catalogue, sorted by product, then the
 *  "another card" choice (its label is copy, so the caller passes it). */
export const cardOptions = (otherLabel: string): { id: string; label: string }[] => [
  ...CARDS.map(({ id, label }) => ({ id, label })),
  { id: OTHER_CARD, label: otherLabel },
];

/** A stated card id as a name; an id the catalogue no longer holds shows as is. */
export const cardLabel = (id: string, otherLabel: string): string =>
  id === OTHER_CARD ? otherLabel : (CARDS.find((c) => c.id === id)?.label ?? id);
