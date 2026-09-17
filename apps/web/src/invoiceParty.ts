/* WHO IS WHO ON AN INVOICE — DECIDED HERE, NOT BY THE MODEL.
 *
 * The extraction agent used to answer two questions it structurally could not:
 * `counterparty` ("the other party") and `direction` ("out when the user must
 * pay"). Both are defined relative to the owner, and the agent is deliberately
 * never told who the owner is — prompts/facturen-extract.md says so out loud,
 * and settings.ts's getOwnerName repeats it: "the redaction boundary exists so
 * a model never learns who the owner is".
 *
 * So it guessed, and it guessed the same way every time. Measured 17 Sep on
 * mistral-small AND mistral-medium, both models, two invoices:
 *
 *   invoice he SENT to a client   → direction "out", counterparty = HIS OWN BV
 *   invoice he RECEIVED from KPN  → direction "out", counterparty = KPN
 *
 * Right for a purchase invoice, wrong for every sales invoice — and wrong in
 * the expensive direction, because Facturen renders `direction === "in" ?
 * amount : -amount`, so his revenue was booking as cost.
 *
 * The agent now returns what is PRINTED (seller, buyer, payee IBAN) and this
 * file decides the rest against data that never leaves the browser. No identity
 * crosses the boundary, and the answer stops being a guess.
 */

export type ExtractedParties = {
  /** Who issued the invoice and is owed the money, as printed. */
  seller: string;
  /** Who must pay it, as printed. */
  buyer: string;
  /** The IBAN the invoice says to pay INTO, when it prints one. */
  payeeIban?: string;
};

/** What the owner's own vault knows, and the model never sees. */
export type OwnIdentity = {
  /** IBANs of his own accounts. */
  ibans: readonly string[];
  /** His entity labels ("Steunenberg Holding", "BV1"). */
  entityNames: readonly string[];
};

/* A KIND, not a sentence and not a bare boolean.
 *
 * "unknown" is a real answer here, not a failure to produce one. The screen is
 * confirm-first, and this file follows the rule the currency field already
 * sets in Facturen.tsx: "No currency read = no currency. Blanking it is
 * deliberate... instead of inheriting the EUR that happened to be standing in
 * the field." A direction nobody could determine is the same case — asking him
 * beats defaulting to the answer that was wrong half the time. */
export type PartyResolution = {
  kind: "sales" | "purchase" | "unknown";
  /** The OTHER party, as far as we can tell. Never the owner's own name. */
  counterparty: string;
  /** What settled it, so the screen can say why rather than assert. */
  because: "payee-iban" | "seller-is-own-entity" | "buyer-is-own-entity" | "no-match";
};

/** Comparable form of an IBAN: no spaces, no punctuation, upper case. */
function normIban(s: string): string {
  return s.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}

/* Comparable form of a company name. Legal-form suffixes are dropped because
 * an invoice and a vault label rarely agree on them: "Steunenberg Holding
 * B.V." on the document, "Steunenberg Holding" in the app. */
const LEGAL_FORMS = /\b(b\.?v\.?|n\.?v\.?|v\.?o\.?f\.?|c\.?v\.?|gmbh|ltd|inc|sarl|sa|ug)\b/g;
function normName(s: string): string {
  return (
    s
      .toLowerCase()
      /* Fold diacritics before stripping punctuation, so a label typed without
       * accents still matches the name OCR read off the page with them. */
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(LEGAL_FORMS, " ")
      .replace(/[^a-z0-9]+/g, " ")
      .trim()
  );
}

/* CONTAINMENT NEEDS TWO WORDS, NOT FOUR CHARACTERS.
 *
 * The first version allowed substring matching from four characters up, which
 * stops "BV1" but not a single generic word. Entity labels are free text the
 * owner types at onboarding, and "Holding" or "Werk" is exactly what a DGA
 * types. Found in review and reproduced: with the label "Holding", an invoice
 * between two strangers — "Zonnepanelen Leverancier B.V." billing "Van der Berg
 * Holding B.V." — resolved to `purchase`, because "holding" sits inside "van
 * der berg holding". A confident direction and counterparty on a document that
 * has nothing to do with him: the same wrong-column failure this file exists to
 * close, re-entering through the name path instead of the model.
 *
 * So a one-word name must match exactly. Containment is for the case it was
 * added for — "Steunenberg Holding" against "Steunenberg Holding B.V." — where
 * the shorter side is specific enough that a collision is not plausible. When
 * the names really are the same and short, exact equality still catches it, and
 * the payee IBAN (checked first) is the precise route regardless. */
function namesMatch(a: string, b: string): boolean {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const shorter = x.length <= y.length ? x : y;
  const longer = shorter === x ? y : x;
  if (shorter.split(" ").length < 2) return false;
  return longer.includes(shorter);
}

/**
 * Decide the direction and the counterparty from what the document printed and
 * what the vault knows.
 *
 * The payee IBAN is checked first and on purpose: it is the one field on an
 * invoice that is unambiguous. A name can be abbreviated, translated, or
 * carry a trading name; "pay into this account" is the account or it is not.
 */
export function resolveInvoiceParties(
  parties: ExtractedParties,
  own: OwnIdentity,
): PartyResolution {
  const { seller, buyer, payeeIban } = parties;

  if (payeeIban) {
    const wanted = normIban(payeeIban);
    if (wanted && own.ibans.some((i) => normIban(i) === wanted))
      return { kind: "sales", counterparty: buyer, because: "payee-iban" };
  }

  const sellerIsOwn = own.entityNames.some((e) => namesMatch(seller, e));
  const buyerIsOwn = own.entityNames.some((e) => namesMatch(buyer, e));

  /* Both sides matching means an invoice between two of his OWN entities, or a
   * label loose enough to match anything. Either way this function cannot say
   * which way the money goes, and guessing between two of his own BVs is how a
   * transfer becomes revenue. */
  if (sellerIsOwn && !buyerIsOwn)
    return { kind: "sales", counterparty: buyer, because: "seller-is-own-entity" };
  if (buyerIsOwn && !sellerIsOwn)
    return { kind: "purchase", counterparty: seller, because: "buyer-is-own-entity" };

  /* No match. The counterparty falls back to the SELLER because that is the
   * more useful half to prefill — most documents a person uploads are bills
   * they received — but the direction stays unset, so nothing books until he
   * says which way it goes. */
  return { kind: "unknown", counterparty: seller, because: "no-match" };
}
