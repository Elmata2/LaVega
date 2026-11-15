/**
 * Ported from Sure (we-promise/sure) commit 562fe09 — AGPL-3.0 — independently
 * reimplemented for LaVega; changed 2026-11-10.
 *
 * Sure source: `app/models/transaction/label_normalizer.rb` and
 * `app/models/transaction/label_normalizer/dictionary.rb` — AGPL-3.0. No Ruby
 * is copied; the deterministic descriptor pipeline and the regional
 * rail/date marker packs are reimplemented for LaVega's counterparty strings.
 *
 * WHY. One biller does not write itself the same way twice. A bank prepends the
 * rail ("BEA, BETAALPAS", "SEPA INCASSO", "POS"), embeds the operation date, the
 * card's last four, a terminal id and a reference number. "BEA, BETAALPAS
 * 02/09 ALBERT HEIJN 4821" and "ALBERT HEIJN" are one merchant, and today every
 * grouping downstream (subscriptions, forecast, cross-scope streams) has to
 * reconstruct that on its own, if at all. This module removes what the bank
 * added and returns the merchant a human would name, plus the rail and the
 * operation date as separate facts — never as one string.
 *
 * Sure stores outflow POSITIVE (`app/models/entry.rb:325-327`). This module
 * never reads `Tx.amount`: it normalizes a descriptor string, so LaVega's
 * negative-outflow `Tx` convention (ADR 0011) is untouched at this boundary.
 *
 * Casing is deliberately preserved. Bank labels are often upper case and
 * titlecasing mangles acronyms (ING, NS, KPN, HEMA, IKEA, BV).
 *
 * Regional packs: Sure ships nine (fr, en_US, en_GB, en_CA, de, es, it, nl, pt).
 * LaVega ships the three that meet its data: NL, DE and EN (en_US + en_GB — the
 * split matters, because en_US writes the month first and the other two day
 * first). Every pack is always active, exactly like Sure: the bank's label
 * says which bank wrote it, not the reader's locale.
 */
import { merchantKey } from "./subscriptions.js";

/** The payment rail a bank names on the row. Same vocabulary as Sure, minus
 *  the packs LaVega does not ship. */
export type LabelRail =
  | "fee"
  | "loan_payment"
  | "refund"
  | "withdrawal"
  | "cheque"
  | "card"
  | "direct_debit"
  | "transfer";

export type LabelDateOrder = "dmy" | "mdy";

/** What `normalizeLabel` returns: three FACTS, no sentence. `name` is the
 *  cleaned descriptor (casing kept), `rail`/`operationDate` are what the bank
 *  said in passing and are `null` when the label did not say. */
export type NormalizedLabel = {
  name: string;
  /** False when the descriptor carried no merchant name at all — only a card
   *  number, a reference or rail boilerplate. `name` then keeps the original
   *  text (an empty name is worse than an ugly one) and the canonical key is
   *  "", so a caller suppresses the row instead of grouping junk. */
  hasName: boolean;
  rail: LabelRail | null;
  /** The date the OPERATION happened (the card was used, the direct debit was
   *  collected), not the settlement date `Tx.date` carries. ISO YYYY-MM-DD.
   *  `null` when the label carried no date or the date did not resolve to a
   *  real calendar day — unknown is not guessed (ADR 0011 §8). */
  operationDate: string | null;
};

/** A canonical merchant: one key, one display name, the spellings that map to
 *  it. Rules, subscriptions, forecast and reports can then group on `key`
 *  instead of on the raw descriptor. Stored additively as `VaultData.merchants`. */
export type Merchant = {
  /** The canonical key. Same shape `merchantKey` returns, so an unregistered
   *  merchant and a registered one share one key space. */
  key: string;
  /** The name a human would use, e.g. "Albert Heijn". Free text, used for
   *  display; matching happens on the aliases. */
  name: string;
  /** Raw spellings that resolve here: "BEA, BETAALPAS ALBERT HEIJN",
   *  "ALBERT HEIJN 4821", "AH". Matched whole-token, longest alias first. */
  aliases: string[];
};

export type MerchantMatch = {
  key: string;
  name: string;
  /** The descriptor after normalization, so a caller can show what it matched
   *  without re-parsing. */
  label: NormalizedLabel;
  /** The registry entry that matched, or `null` when the key came from the
   *  fallback token rules. */
  merchant: Merchant | null;
};

/* ── Rails ───────────────────────────────────────────────────────────────────
 * Tried in this order regardless of the order a pack lists them, because the
 * order encodes real ambiguities (Sure `dictionary.rb:19-24`):
 *   fee before withdrawal, or "ATM FEE" reads as cash taken out at a merchant
 *     called FEE.
 *   loan_payment before refund, or "LOAN REPAYMENT" reads as money coming back
 *     rather than an instalment going out.
 *   refund before card/direct_debit, or "ANNULERING CB FNAC" keeps the rail it
 *     reverses and groups away from the purchase it reverses. */
const RAIL_ORDER: readonly LabelRail[] = [
  "fee",
  "loan_payment",
  "refund",
  "withdrawal",
  "cheque",
  "card",
  "direct_debit",
  "transfer",
];

/** Rails that a refund label can nest; the prefix loop stops at the first
 *  match, so the nested marker has to be removed separately. */
const NESTED_RAILS: readonly LabelRail[] = ["card", "direct_debit"];

type PackToken = string | RegExp;

type LabelPack = {
  region: string;
  dateOrder: LabelDateOrder;
  rails: Partial<Record<LabelRail, readonly PackToken[]>>;
};

const NL_PACK: LabelPack = {
  region: "nl",
  dateOrder: "dmy",
  rails: {
    card: [
      "BETALING MET KREDIETKAART",
      "BETAALAUTOMAATTRANSACTIE",
      "BETALING MET DEBETKAART",
      "BETAALPASTRANSACTIE",
      "AANKOOP BANCONTACT",
      "BETALING BANCONTACT",
      "BETAALAUTOMAAT",
      "BEA, BETAALPAS",
      "BEA, APPLE PAY",
      "BEA, GOOGLE PAY",
    ],
    direct_debit: [
      "SEPA INCASSO ALGEMEEN DOORLOPEND",
      "SEPA INCASSO ALGEMEEN EENMALIG",
      "EUROPESE DOMICILIERING",
      "EUROPESE DOMICILIËRING",
      "SEPA INCASSO DOORLOPEND",
      "SEPA INCASSO EENMALIG",
      "DOORLOPENDE MACHTIGING",
      "SEPA DOMICILIERING",
      "SEPA DOMICILIËRING",
      "EUROPESE INCASSO",
      "SEPA INCASSO",
    ],
    transfer: [
      "SEPA PERIODIEKE OVERBOEKING",
      "PERIODIEKE OVERSCHRIJVING",
      "EUROPESE OVERSCHRIJVING",
      "INSTANTOVERSCHRIJVING",
      "SEPA SPOEDOVERBOEKING",
      "PERIODIEKE OVERBOEKING",
      "SEPA OVERBOEKING",
      "OVERSCHRIJVING",
      "OVERBOEKING",
      "SEPA IDEAL",
    ],
    withdrawal: [
      "GELDOPNEMING VIA AUTOMAAT",
      "GELDAFHALING BANCONTACT",
      "CONTANTE OPNAME",
      "GEA, BETAALPAS",
      "GELDAUTOMAAT",
      "GELDOPNEMING",
      "GELDAFHALING",
      "GELDOPNAME",
      "KASOPNAME",
    ],
    cheque: ["CIRCULAIRE CHEQUE", "BANKCHEQUE"],
    fee: [
      "BETAALPAKKET KOSTEN",
      "KOSTEN BETAALPAKKET",
      "TRANSACTIEKOSTEN",
      "BEHEERKOSTEN",
      "MAANDKOSTEN",
      "BANKKOSTEN",
      "DEBETRENTE",
    ],
    loan_payment: [
      "AFLOSSING HYPOTHEEK",
      "HYPOTHEEKTERMIJN",
      "AFLOSSING KREDIET",
      "AFLOSSING LENING",
      "AFLOSSING",
    ],
    refund: [
      "SEPA INCASSO TERUGBOEKING",
      "SEPA TERUGBOEKING",
      "TERUGSTORTING",
      "TERUGBOEKING",
      "STORNERING",
    ],
  },
};

const DE_PACK: LabelPack = {
  region: "de",
  dateOrder: "dmy",
  rails: {
    card: [
      "KARTENZAHLUNG/-ABRECHNUNG",
      "KREDITKARTENABRECHNUNG",
      "MAESTRO KARTENZAHLUNG",
      "DEBITKARTENZAHLUNG",
      "KREDITKARTENUMSATZ",
      "KARTENZAHLUNG ONLINE",
      "SEPA-ELV-LASTSCHRIFT",
      "KAUF/DIENSTLEISTUNG",
      "KARTENABRECHNUNG",
      "KARTENVERFUEGUNG",
      "KARTENVERFÜGUNG",
      "GIROCARD-ZAHLUNG",
      "KARTENZAHLUNG",
      "TWINT ZAHLUNG",
      "POS-ZAHLUNG",
      "TWINT KAUF",
      "GIROCARD",
    ],
    direct_debit: [
      "SEPA-FIRMENLASTSCHRIFT",
      "SEPA FIRMENLASTSCHRIFT",
      "SEPA-BASISLASTSCHRIFT",
      "SEPA BASISLASTSCHRIFT",
      "EINZUGSERMAECHTIGUNG",
      "EINZUGSERMÄCHTIGUNG",
      "LASTSCHRIFTEINZUG",
      "ABBUCHUNGSAUFTRAG",
      "FIRMENLASTSCHRIFT",
      "EINMALLASTSCHRIFT",
      "SEPA-LASTSCHRIFT",
      "SEPA LASTSCHRIFT",
      "FOLGELASTSCHRIFT",
      "BASISLASTSCHRIFT",
      "ERSTLASTSCHRIFT",
      "LASTSCHRIFT",
      "ABBUCHUNG",
      "LASTSCHR.",
      "LSV+",
    ],
    transfer: [
      "UEBERWEISUNGSGUTSCHRIFT",
      "ÜBERWEISUNGSGUTSCHRIFT",
      "GUTSCHRIFT UEBERWEISUNG",
      "GUTSCHRIFT ÜBERWEISUNG",
      "ECHTZEIT-UEBERWEISUNG",
      "ECHTZEIT-ÜBERWEISUNG",
      "EINZELUEBERWEISUNG",
      "EINZELÜBERWEISUNG",
      "SAMMELUEBERWEISUNG",
      "SAMMELÜBERWEISUNG",
      "ONLINE-UEBERWEISUNG",
      "ONLINE-ÜBERWEISUNG",
      "SEPA-UEBERWEISUNG",
      "SEPA UEBERWEISUNG",
      "SEPA-ÜBERWEISUNG",
      "SEPA ÜBERWEISUNG",
      "LOHN/GEHALT/RENTE",
      "DAUERAUFTRAG",
      "UEBERWEISUNG",
      "ÜBERWEISUNG",
      "GEHALT/RENTE",
      "UMBUCHUNG",
      "UEBERTRAG",
      "ÜBERTRAG",
    ],
    withdrawal: [
      "BARGELDBEZUG AM BANCOMAT",
      "AUSZAHLUNG GELDAUTOMAT",
      "SB-BARGELDBEHEBUNG",
      "BARGELDAUSZAHLUNG",
      "BANKOMATBEHEBUNG",
      "BARGELDBEHEBUNG",
      "BARAUSZAHLUNG",
      "BARGELDBEZUG",
      "GELDAUTOMAT",
      "GELDBEZUG",
      "ABHEBUNG",
    ],
    cheque: [
      "VERRECHNUNGSSCHECK",
      "SCHECKEINREICHUNG",
      "SCHECKEINLOESUNG",
      "SCHECKEINLÖSUNG",
      "SCHECK",
    ],
    fee: [
      "KONTOFUEHRUNGSGEBUEHR",
      "KONTOFÜHRUNGSGEBÜHR",
      "KONTOFUEHRUNGSENTGELT",
      "KONTOFÜHRUNGSENTGELT",
      "RECHNUNGSABSCHLUSS",
      "ENTGELTABRECHNUNG",
      "ENTGELTABSCHLUSS",
      "SOLLZINSEN",
      "GEBUEHREN",
      "GEBÜHREN",
      "ENTGELTE",
      "GEBUEHR",
      "GEBÜHR",
      "ENTGELT",
      "SPESEN",
    ],
    loan_payment: [
      "DARLEHENSTILGUNG",
      "HYPOTHEKARZINSEN",
      "DARLEHENSZINSEN",
      "RATENZAHLUNG",
      "DARLEHENSRATE",
      "KREDITRATE",
      "ANNUITAET",
      "ANNUITÄT",
      "TILGUNG",
    ],
    refund: [
      "GUTSCHRIFT KARTENZAHLUNG",
      "WIEDERGUTSCHRIFT",
      "RUECKUEBERWEISUNG",
      "RÜCKÜBERWEISUNG",
      "RUECKERSTATTUNG",
      "RÜCKERSTATTUNG",
      "RUECKLASTSCHRIFT",
      "RÜCKLASTSCHRIFT",
      "STORNIERUNG",
      "RUECKBUCHUNG",
      "RÜCKBUCHUNG",
      "ERSTATTUNG",
      "RETOURE",
      "STORNO",
    ],
  },
};

const EN_US_PACK: LabelPack = {
  region: "us",
  dateOrder: "mdy",
  rails: {
    card: [
      "RECURRING PAYMENT AUTHORIZED ON",
      "PURCHASE AUTHORIZED ON",
      "RECURRING CARD PURCHASE",
      "POINT OF SALE PURCHASE",
      "CARD PURCHASE WITH PIN",
      "DEBIT CARD PURCHASE",
      "RETAIL PURCHASE",
      "CHECKCARD",
      "CHKCARD",
      "POS PURCHASE",
      "POS DEBIT",
      "PIN PURCHASE",
    ],
    direct_debit: [
      "PREAUTHORIZED PAYMENT",
      "PREAUTHORIZED DEBIT",
      "AUTOMATIC PAYMENT",
      "ACH WITHDRAWAL",
      "ACH DEBIT",
    ],
    transfer: [
      "ONLINE BANKING TRANSFER",
      "EXTERNAL TRANSFER",
      "INTERNET TRANSFER",
      "PAYROLL DEPOSIT",
      "ONLINE TRANSFER",
      "DIRECT DEPOSIT",
      "MOBILE DEPOSIT",
      "WIRE TRANSFER",
      "INCOMING WIRE",
      "OUTGOING WIRE",
      "ZELLE PAYMENT",
      "ZELLE",
      "TRANSFER",
    ],
    withdrawal: [
      "ATM WITHDRAWAL AUTHORIZED ON",
      "ATM CASH WITHDRAWAL",
      "CASH WITHDRAWAL",
      "ATM WITHDRAWAL",
      "ATM WITHDRWL",
      "ATM DEBIT",
      "ATM CASH",
    ],
    cheque: [
      "MOBILE CHECK DEPOSIT",
      "RETURNED CHECK",
      "CHECK DEPOSIT",
      "CHECK NUMBER",
      "CHECK PAID",
      "CHECK NO",
      /CHECK\b(?=[\s:.#-]*(?:\d|$))/,
    ],
    fee: [
      "INTERNATIONAL TRANSACTION FEE",
      "NON-SUFFICIENT FUNDS FEE",
      "MONTHLY MAINTENANCE FEE",
      "FOREIGN TRANSACTION FEE",
      "INSUFFICIENT FUNDS FEE",
      "RETURNED PAYMENT FEE",
      "MONTHLY SERVICE FEE",
      "RETURNED ITEM FEE",
      "LATE PAYMENT FEE",
      "CASH ADVANCE FEE",
      "ATM OPERATOR FEE",
      "INTEREST CHARGED",
      "SERVICE CHARGE",
      "INTEREST CHARGE",
      "OVERDRAFT FEE",
      "ANNUAL FEE",
      "LATE FEE",
      "NSF FEE",
      "ATM FEE",
    ],
    loan_payment: [
      "PERSONAL LOAN PAYMENT",
      "STUDENT LOAN PAYMENT",
      "INSTALLMENT PAYMENT",
      "AUTO LOAN PAYMENT",
      "MORTGAGE PAYMENT",
      "LOAN PAYMENT",
      "MORTGAGE PMT",
      "LOAN PMT",
    ],
    refund: [
      "REFUND PURCHASE AUTHORIZED ON",
      "PURCHASE RETURN AUTHORIZED ON",
      "PURCHASE RETURN",
      "MERCHANT REFUND",
      "MERCHANT CREDIT",
      "CARD REFUND",
      "CHARGEBACK",
      "REVERSAL",
      "REFUND",
    ],
  },
};

const EN_GB_PACK: LabelPack = {
  region: "gb",
  dateOrder: "dmy",
  rails: {
    card: [
      "VISA DEBIT PURCHASE",
      "CONTACTLESS PAYMENT",
      "VISA PURCHASE",
      "CARD PURCHASE",
      "CARD PAYMENT",
      "POS",
    ],
    direct_debit: ["DIRECT DEBIT PAYMENT", "DIRECT DEBIT", "D/D"],
    transfer: [
      "FASTER PAYMENTS RECEIPT",
      "BANK GIRO CREDIT",
      "FASTER PAYMENT",
      "STANDING ORDER",
      "BILL PAYMENT",
      "DIRECT CREDIT",
      "BACS",
      "S/O",
    ],
    withdrawal: ["CASH WITHDRAWAL"],
    cheque: ["CHEQUE DEPOSIT", "CHEQUE PAID", "CHEQUE NO"],
    fee: [
      "NON-STERLING TRANSACTION FEE",
      "UNARRANGED OVERDRAFT FEE",
      "ARRANGED OVERDRAFT FEE",
      "PAPER STATEMENT FEE",
      "MONTHLY ACCOUNT FEE",
      "OVERDRAFT INTEREST",
      "BANK CHARGE",
      "ACCOUNT FEE",
    ],
    loan_payment: ["MORTGAGE REPAYMENT", "LOAN INSTALMENT", "LOAN REPAYMENT"],
    refund: ["CREDIT VOUCHER"],
  },
};

/** Every pack is active (Sure `dictionary.rb:11-13`). Order matters only for
 *  duplicate markers: the first pack that declares a token owns its date order. */
const PACKS: readonly LabelPack[] = [NL_PACK, DE_PACK, EN_US_PACK, EN_GB_PACK];

const MDY_REGIONS = new Set(["US", "CA", "PH"]);

/** Date order fallback when no marker matched; a marker's own pack wins
 *  (Sure `label_normalizer.rb:183-185`). */
function dateOrderForRegion(region: string | null | undefined): LabelDateOrder {
  return region && MDY_REGIONS.has(region.trim().toUpperCase()) ? "mdy" : "dmy";
}

/* ── Marker compilation ───────────────────────────────────────────────────── */
/** What may sit between a consumed marker and the merchant. A connector must be
 *  followed by whitespace: a bare `AT\b` turns "Card Payment AT&T" into a
 *  merchant called "T". `DI`/`DA` are deliberately absent (Sure `:439-446`). */
const CONNECTORS: readonly string[] = [
  "EN\\s+FAVEUR\\s+DE",
  "A\\s+FAVORE\\s+DI",
  "A\\s+FAVOR\\s+DE",
  "FROM",
  "VOOR",
  "NAAR",
  "PARA",
  "VIA",
  "VON",
  "TO",
  "AT",
  "FOR",
  "DE",
];
const TRAILER = `[\\s:.,#\\-]*(?:(?:${CONNECTORS.join("|")})\\s+)?`;

function compileMarker(token: PackToken): RegExp {
  if (token instanceof RegExp) return new RegExp(`^(?:${token.source})${TRAILER}`, "i");
  // Whole words only, with flexible whitespace; a trailing `\b` only when the
  // token ends in a word character ("LASTSCHR." and "LSV+" would never match
  // otherwise).
  const body = token
    .split(/\s+/)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  const boundary = /\w$/.test(token) ? "\\b" : "";
  return new RegExp(`^(?:${body})${boundary}${TRAILER}`, "i");
}

type CompiledMarker = { rail: LabelRail; dateOrder: LabelDateOrder; pattern: RegExp };

/** Rails in priority order; within a rail, longest marker first so "COMPRA COM
 *  CARTAO" is tried before "COMPRA". Duplicates are dropped keeping the first
 *  pack's date order (Sure `tokens_for`/`specificity`). */
function buildMarkers(): CompiledMarker[] {
  const markers: CompiledMarker[] = [];
  for (const rail of RAIL_ORDER) {
    const seen = new Set<string>();
    const tokens: Array<{ token: PackToken; dateOrder: LabelDateOrder }> = [];
    for (const pack of PACKS) {
      for (const token of pack.rails[rail] ?? []) {
        const id = token instanceof RegExp ? token.source : token;
        if (seen.has(id)) continue;
        seen.add(id);
        tokens.push({ token, dateOrder: pack.dateOrder });
      }
    }
    tokens.sort((a, b) => specificity(b.token) - specificity(a.token));
    for (const { token, dateOrder } of tokens) {
      markers.push({ rail, dateOrder, pattern: compileMarker(token) });
    }
  }
  return markers;
}

function specificity(token: PackToken): number {
  return token instanceof RegExp ? token.source.length : token.length;
}

const MARKERS: readonly CompiledMarker[] = buildMarkers();

/* ── Noise ────────────────────────────────────────────────────────────────── */
/** Payment aggregators put the real merchant after a star; the aggregator names
 *  the rail, not the payee (Sure `label_normalizer.rb:56-60`). */
const AGGREGATOR =
  /^(?:PAYPAL|PP|SUMUP|SQC?|STRIPE|IZETTLE|ZETTLE|LYDIA|MOLLIE|ADYEN|GOCARDLESS|TST|CLV|WPY|UBER|GOOGLE|EB|IC|SP|DD)\s*\*\s*/i;

/** Everything from these markers onward is the payment system talking to
 *  itself; truncation is safe because they trail the counterparty (Sure
 *  `label_normalizer.rb:89-94`). `KENMERK` is LaVega's addition: Dutch bank
 *  exports write it where Sure's packs stop, and leaving it in keeps the
 *  reference number in the name. */
const TRUNCATORS: readonly RegExp[] = [
  /\b(?:EREF|KREF|MREF|CRED|DEBT|RREF|BREF)\+/i,
  /\bKENMERK\b/i,
  /\b(?:DES|INDN|CO\s+ID|ORIG\s+ID|DESC\s+DATE|SEC)\s*:/i,
  /\b(?:MANDATSREFERENZ|GL(?:AE|Ä)UBIGER-?ID|INCASSANT\s*ID|MACHTIGING\s*ID)\b/i,
];

/** Terminal id or card last-four sitting between the marker and the merchant
 *  ("POS 5250 27DEC24 TESCO"). Only stripped at the very front, and only once a
 *  marker was consumed: a global short-digit strip would eat the store number
 *  in "TESCO STORE 3243" (Sure `:126-138`). */
const TERMINAL_ID = /^\d{2,6}\b[\s:.,#-]*/;

/** Masked card numbers, references, auth codes, terminal ids and contract
 *  numbers. Global, because they can appear more than once (Sure `:108-124`). */
const NOISE: readonly RegExp[] = [
  /\b(?:CARTE|CB|CARD|KARTE|KARTENNUMMER|KAARTNR|PASVOLGNR|TARJETA)\s*(?:N[O°R]?\.?\s*)?\*?\d{4,}\b/gi,
  /\bCARD\s+ENDING(?:\s+IN)?\s*\*?\d{4}\b/gi,
  /\bCKCD(?:\s*[X\d]{4}){1,4}/gi,
  /\b[X*]{4,}\d{0,4}\b/g,
  /\b(?:REF|REFERENCE|MDT|MANDAT|MANDATE|NUM)\b\.?\s*[:#]?\s*[A-Z0-9-]{4,}\b/gi,
  /\b(?:GAA?\s*NR|N[O°R]|NR)\.?\s*[:#]?\s*\d{4,}\b/gi,
  /\b(?:AUTH|AUTHORISATION|AUTHORIZATION)\s*(?:CODE|NO)?\.?\s*[:#]?\s*[A-Z0-9]{4,}\b/gi,
  /\b(?:TERM|TERMINAL|TID|MID|TRACE|SEQ|TXN|TRN)\s*(?:ID|NO|N[O°])?\.?\s*[:#]?\s*[A-Z0-9-]{4,}\b/gi,
  /\b\d{6,}\b/g,
  /\b(?:RECURRING|PENDING)\s*$/gi,
  /\b(?:PPD|CCD|IAT|ARC|BOC|RCK)\s*$/gi,
];

/** DD/MM, DD/MM/YY, DD/MM/YYYY and the dotted/dashed variants. Which number is
 *  the day depends on the pack that wrote the label (Sure `:69-72`). */
const SLASHED_DATE = /\b(?:(?:DU|ON)\s+)?(\d{2})[/.-](\d{2})(?:[/.-](\d{2,4}))?\b/i;
/** Only read after an explicit DU: a bare six-digit run is far more often a
 *  card or contract number than a date (Sure `:74-76`). */
const COMPACT_DATE = /\bDU\s+(\d{2})(\d{2})(\d{2})\b/i;
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
/** "27DEC24", "02 SEP", "ON 03 SEP 24". English month abbreviations only; the
 *  negative lookahead keeps DEC out of "3 DECADES" and MAR out of "5 MARCH ST"
 *  (Sure `:83-89`). */
const ALPHA_DATE =
  /\b(?:ON\s+)?(\d{1,2})[\s-]?(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)(?![A-Z])[\s-]?(\d{2,4})?\b/i;

/* ── Date resolution ──────────────────────────────────────────────────────── */
function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function isoDate(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** A calendar day only, or `null` when the three numbers do not name one
 *  (31 February). `Date.UTC` rolls overflow over, so the components are read
 *  back to catch it. */
function safeDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const t = new Date(Date.UTC(year, month - 1, day));
  if (t.getUTCFullYear() !== year || t.getUTCMonth() !== month - 1 || t.getUTCDate() !== day) {
    return null;
  }
  return isoDate(year, month, day);
}

function resolveDayAndMonth(
  first: string,
  second: string,
  order: LabelDateOrder,
): [string, string] {
  const a = Number(first);
  const b = Number(second);
  // A value above 12 settles the question on its own, whatever the region says.
  if (a > 12) return [first, second];
  if (b > 12) return [second, first];
  return order === "mdy" ? [second, first] : [first, second];
}

/** A label written DD/MM with no year sits a few days before the entry date, so
 *  the entry's year is right except across a New Year boundary, where the label
 *  belongs to the previous year (Sure `:205-231`). `on` is the entry date; no
 *  `on` means the year is unknown and the date is not guessed. */
function buildDate(
  dayText: string,
  monthText: string,
  yearText: string | undefined,
  on: string | null,
): string | null {
  const day = Number(dayText);
  const month = Number(monthText);
  if (yearText) {
    const fullYear = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText);
    return safeDate(fullYear, month, day);
  }
  if (!on || on.length < 10) return null;
  const year = Number(on.slice(0, 4));
  if (!Number.isInteger(year)) return null;
  const candidate = safeDate(year, month, day);
  if (candidate === null) return null;
  if (candidate > on) {
    // The label is a few days before the entry only when the calendar says so;
    // only then does it belong to the previous year.
    const previous = safeDate(year - 1, month, day);
    return previous;
  }
  return candidate;
}

function extractOperationDate(
  working: string,
  on: string | null,
  order: LabelDateOrder,
): { operationDate: string | null; rest: string } {
  const compact = COMPACT_DATE.exec(working);
  if (compact) {
    return {
      operationDate: buildDate(compact[1], compact[2], compact[3], on),
      rest: working.replace(COMPACT_DATE, " "),
    };
  }
  const alpha = ALPHA_DATE.exec(working);
  if (alpha) {
    const month = MONTHS.indexOf(alpha[2].toUpperCase()) + 1;
    return {
      operationDate: buildDate(alpha[1], String(month), alpha[3], on),
      rest: working.replace(ALPHA_DATE, " "),
    };
  }
  const slashed = SLASHED_DATE.exec(working);
  if (slashed) {
    const [day, month] = resolveDayAndMonth(slashed[1], slashed[2], order);
    return {
      operationDate: buildDate(day, month, slashed[3], on),
      rest: working.replace(SLASHED_DATE, " "),
    };
  }
  return { operationDate: null, rest: working };
}

/* ── Pipeline ─────────────────────────────────────────────────────────────── */
function truncateAtReference(working: string): string {
  let out = working;
  for (const pattern of TRUNCATORS) {
    const match = pattern.exec(out);
    if (match && match.index > 0) out = out.slice(0, match.index);
  }
  return out;
}

function tidy(value: string): string {
  return value
    .replace(/\*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/[^\p{L}\p{N}]+$/u, "")
    .trim();
}

/** Turn a raw bank descriptor into the merchant name plus the facts the bank
 *  embedded. Pure and deterministic: no clock (pass `on`), no locale, no I/O.
 *  `region` is only a fallback for the day/month order when no marker matched. */
export function normalizeLabel(
  raw: string,
  options: { on?: string | null; region?: string | null } = {},
): NormalizedLabel {
  const original = (raw ?? "").trim();
  let working = original;
  let rail: LabelRail | null = null;
  let dateOrder: LabelDateOrder | null = null;

  for (const marker of MARKERS) {
    if (!marker.pattern.test(working)) continue;
    working = working.replace(marker.pattern, "");
    rail = marker.rail;
    dateOrder = marker.dateOrder;
    break;
  }

  // A refund nests the rail it reverses; the prefix loop stopped at "refund",
  // so the nested marker has to go or it splits the refund from its purchase.
  if (rail === "refund") {
    for (const marker of MARKERS) {
      if (!NESTED_RAILS.includes(marker.rail)) continue;
      if (!marker.pattern.test(working)) continue;
      working = working.replace(marker.pattern, "");
      break;
    }
  }

  working = truncateAtReference(working);
  const { operationDate, rest } = extractOperationDate(
    working,
    options.on ?? null,
    dateOrder ?? dateOrderForRegion(options.region),
  );
  working = rest;

  // Only after a consumed marker: a bare "5250 TESCO" is not the same label.
  if (rail !== null) working = working.replace(TERMINAL_ID, "");

  if (AGGREGATOR.test(working)) {
    working = working.replace(AGGREGATOR, "");
    rail ??= "card";
  }

  for (const pattern of NOISE) working = working.replace(pattern, " ");

  const cleaned = tidy(working);
  // A label that is nothing but noise (a cheque number, a bare reference) keeps
  // its original text: an empty name is worse than an ugly one.
  const hasName = cleaned.length >= 2;
  return { name: hasName ? cleaned : original, hasName, rail, operationDate };
}

/* ── Merchant registry ────────────────────────────────────────────────────── */
/** Lowercased, accent-stripped, punctuation-collapsed form used only for
 *  matching. Display text is never rewritten. */
function comparisonForm(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Whole-token containment, so alias "ah" does not match "ahold". */
function containsTokens(haystack: string, needle: string): boolean {
  return haystack.length > 0 && ` ${haystack} `.includes(` ${needle} `);
}

/** The canonical key for a descriptor, resolved through the owner's merchant
 *  registry first and the token rules second. Both paths land in the same key
 *  space as `merchantKey`, so a registered merchant and an unregistered one can
 *  meet in one group.
 *
 *  `registry` is `VaultData.merchants`; empty means "no aliases learned yet" and
 *  the fallback still works. An empty result means the descriptor carries no
 *  name at all — callers suppress the row rather than group it under "". */
export function resolveMerchant(
  descriptor: string,
  registry: readonly Merchant[] = [],
  options: { on?: string | null; region?: string | null } = {},
): MerchantMatch {
  const label = normalizeLabel(descriptor, options);
  const forms = [...new Set([comparisonForm(label.name), comparisonForm(descriptor)])].filter(
    (form) => form.length > 0,
  );

  let best: { merchant: Merchant; aliasLength: number } | null = null;
  for (const merchant of registry) {
    if (!merchant.key) continue;
    for (const alias of merchant.aliases) {
      const aliasForm = comparisonForm(alias);
      if (!aliasForm) continue;
      if (!forms.some((form) => containsTokens(form, aliasForm))) continue;
      const beats =
        best === null ||
        aliasForm.length > best.aliasLength ||
        (aliasForm.length === best.aliasLength && merchant.key < best.merchant.key);
      if (beats) best = { merchant, aliasLength: aliasForm.length };
    }
  }

  if (best) {
    return { key: best.merchant.key, name: best.merchant.name, label, merchant: best.merchant };
  }
  // No name in the descriptor means no key: grouping reference-only rows under
  // their rail token would invent a merchant.
  const key = label.hasName ? merchantKey(label.name) : "";
  return { key, name: label.name, label, merchant: null };
}

/** Convenience for callers that only need the key (rules, grouping, dedupe). */
export function canonicalMerchantKey(
  descriptor: string,
  registry: readonly Merchant[] = [],
  options: { on?: string | null; region?: string | null } = {},
): string {
  return resolveMerchant(descriptor, registry, options).key;
}
