import { CATEGORY_OPTIONS } from "./categorize.js";
import type { LearnedFact } from "./facts.js";
import { norm } from "./hash.js";

/* ── THE AGENT / SUBJECT / KEY NAMESPACE ───────────────────────────────────
 *
 * `LearnedFact` is deliberately three flat strings (agent, subject, key), which
 * means anything at all could be written into the vault and later handed to a
 * model. This file is the registry that says what each agent is ALLOWED to
 * learn, so "what LaVega knows" stays a small, inspectable, personal-data-free
 * set instead of a junk drawer.
 *
 *  agent        | subject                        | key                    | value
 *  -------------+--------------------------------+------------------------+-------------------------
 *  travel       | a product/brand name, e.g.     | fxFeePct               | percentage 0..100
 *               | "ING betaalpas"                | cashbackPct            | percentage 0..100
 *               |                                | pointsPerEuro          | percentage 0..100
 *               |                                | transferFreeViaIdeal   | "0" | "1"
 *  categorize   | a category from CATEGORY_      | corrigeerNaar          | a category
 *               | OPTIONS, e.g. "Overboekingen"  |                        |
 *  facturen     | an invoice FIELD name:         | voorkeur               | short text, e.g.
 *               | dueDate/currency/direction/    |                        | "issueDate+30", "EUR"
 *               | vatAmount                      |                        |
 *  chat         | "antwoord"                     | lengte | toon | detail | short text, e.g. "kort"
 *  belasting    | a tax figure LaVega needs:      | kolom                  | the column header in the
 *               | period/revenue/expenses/profit/ |                        | owner's own spreadsheet,
 *               | vatCharged/vatPaid              |                        | e.g. "Omzet excl. btw"
 *
 * Two properties fall out of this table, and both are enforced below:
 *
 *  1. NO COUNTERPARTIES. Only `travel` has a free-text subject, and there it is
 *     a public brand, shape-checked like the travel redaction boundary does.
 *     Every other agent's subject comes from a closed vocabulary, so a merchant
 *     or a client name has nowhere to live. Merchant-level learning already has
 *     a home that never leaves the device — the `rules` in the vault — and it
 *     stays there.
 *  2. NO BALANCES OR AMOUNTS. Numeric values are bounded percentages, textual
 *     values are short and scanned for IBANs, account numbers and money
 *     notation. A balance cannot be stored as a fact even by accident. The
 *     `belasting` namespace stores where a figure LIVES in the owner's sheet
 *     (a column header), never the figure — the numbers themselves stay in the
 *     vault, and no tax agent call carries them.
 *
 * `note` is the one free-text field, and it is scanned for identifiers only —
 * a note is a public caveat off a tariff page ("gratis tot €500 per maand") and
 * amounts there are the provider's, not the owner's. Notes are NEVER rendered
 * into a prompt (see `factBriefing`); they stay on the device for the UI. */

export const AGENTS = {
  travel: "travel",
  categorize: "categorize",
  facturen: "facturen",
  chat: "chat",
  belasting: "belasting",
} as const;

/** The tax figures LaVega can take from a spreadsheet the owner already keeps
 *  (see `taxSheet.ts`). A closed vocabulary on purpose: it is the subject list
 *  of the `belasting` namespace, so a column mapping can only ever be about one
 *  of these six figures. */
export const TAX_SHEET_FIELDS = ["period", "revenue", "expenses", "profit", "vatCharged", "vatPaid"] as const;
export type TaxSheetField = (typeof TAX_SHEET_FIELDS)[number];

export type AgentId = (typeof AGENTS)[keyof typeof AGENTS];

/** How a value is validated. `percentage` is a bounded number (so a balance can
 *  never masquerade as one), `flag` is "0"/"1", `category` must be one of
 *  LaVega's categories, `text` is a short scanned string. */
export type FactValueKind = "percentage" | "flag" | "category" | "text" | "column";

/** How a subject is validated: a public brand name, a LaVega category, or a
 *  fixed list of allowed subjects. */
export type SubjectKind = "brand" | "category" | readonly string[];

export type FactKeySpec = { key: string; kind: FactValueKind; what: string };

export type AgentSpec = {
  agent: AgentId;
  what: string;
  subject: SubjectKind;
  subjectWhat: string;
  keys: readonly FactKeySpec[];
};

export const AGENT_SPECS: readonly AgentSpec[] = [
  {
    agent: AGENTS.travel,
    what: "Terms of the payment products the owner holds, used to rank how to pay abroad.",
    subject: "brand",
    subjectWhat: "A public product name, e.g. 'ING betaalpas' or 'Trading 212 creditcard'.",
    keys: [
      { key: "fxFeePct", kind: "percentage", what: "Surcharge on a foreign-currency transaction, on top of the mid-market rate." },
      { key: "cashbackPct", kind: "percentage", what: "Cashback actually paid on ordinary card spending." },
      { key: "pointsPerEuro", kind: "percentage", what: "Reward points earned per euro spent." },
      { key: "transferFreeViaIdeal", kind: "flag", what: "1 when the account can be topped up for free via iDEAL." },
    ],
  },
  {
    agent: AGENTS.categorize,
    what: "How the owner keeps re-filing what the categorizer suggests — category level only, never a merchant.",
    subject: "category",
    subjectWhat: "The category the agent suggested, from CATEGORY_OPTIONS.",
    keys: [
      { key: "corrigeerNaar", kind: "category", what: "The category the owner keeps moving it to instead." },
    ],
  },
  {
    agent: AGENTS.facturen,
    what: "How the owner keeps correcting the invoice extractor, per invoice FIELD (never per counterparty).",
    subject: ["dueDate", "currency", "direction", "vatAmount"],
    subjectWhat: "The invoice field being corrected.",
    keys: [
      { key: "voorkeur", kind: "text", what: "What to do with that field by default, e.g. 'issueDate+30' or 'EUR'." },
    ],
  },
  {
    agent: AGENTS.chat,
    what: "How the owner wants the assistant to answer.",
    subject: ["antwoord"],
    subjectWhat: "Always 'antwoord' — chat learns about its own replies, never about the owner's money.",
    keys: [
      { key: "lengte", kind: "text", what: "Preferred answer length, e.g. 'kort'." },
      { key: "toon", kind: "text", what: "Preferred tone, e.g. 'zakelijk'." },
      { key: "detail", kind: "text", what: "How much reasoning to show, e.g. 'alleen conclusie'." },
    ],
  },
  {
    agent: AGENTS.belasting,
    what: "How the owner's own bookkeeping spreadsheet is laid out, so the next import of the same sheet is one click.",
    subject: TAX_SHEET_FIELDS,
    subjectWhat: "The tax figure being mapped.",
    keys: [
      { key: "kolom", kind: "column", what: "The header of the column in the owner's sheet that holds it." },
    ],
  },
];

const SPEC_BY_AGENT = new Map(AGENT_SPECS.map((s) => [s.agent as string, s]));

export const MAX_SUBJECT = 60;
export const MAX_KEY = 40;
export const MAX_VALUE = 80;
export const MAX_NOTE = 900;

/* ── The no-personal-data guard ────────────────────────────────────────────
 * Shapes that mean "this is the owner's money or the owner's bank", not a
 * public product fact. */

/** An IBAN anywhere in the string. */
const IBAN = /[A-Z]{2}\d{2}[A-Z0-9]{8,}/i;
/** A run of 4+ digits: account numbers, card numbers, "A 286-41213". Real
 *  brand names top out at three ("Trading 212", "N26", "Q8"). */
const IDENTIFIER = /\d{4}/;
/** A longer digit run — the identifier test for `note`, which legitimately
 *  mentions public thresholds like "€2000" but never an account number. */
const LONG_IDENTIFIER = /\d{5,}/;
/** A number next to a currency marker: "€ 12,50", "1234 EUR", "$40". */
const MONEY = /(?:€|\$|£|\beur\b|\busd\b|\bgbp\b)\s*-?\d|-?\d[\d.,]*\s*(?:€|\$|£|\beur\b|\busd\b|\bgbp\b)/i;
/** Thousands-separated money: "1.234,56", "12.500". */
const THOUSANDS = /\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?/;

/** Does this string carry something that can only be personal financial data —
 *  an IBAN, an account number, or a money amount? */
export function carriesPersonalData(s: string): boolean {
  return IBAN.test(s) || IDENTIFIER.test(s) || MONEY.test(s) || THOUSANDS.test(s);
}

function carriesIdentifier(s: string): boolean {
  return IBAN.test(s) || LONG_IDENTIFIER.test(s);
}

/** The same parse `factNumber` uses: a human may type "0,5%" for a correction. */
function asNumber(raw: string): number | null {
  const n = Number(raw.replace(",", ".").replace("%", "").trim());
  return Number.isFinite(n) ? n : null;
}

function subjectAllowed(spec: AgentSpec, subject: string): string | null {
  if (subject.length === 0 || subject.length > MAX_SUBJECT) return "subject leeg of te lang";
  const kind = spec.subject;
  if (kind === "brand") {
    return carriesPersonalData(subject) ? "subject lijkt op een rekeningnummer of bedrag" : null;
  }
  const allowed: readonly string[] = kind === "category" ? CATEGORY_OPTIONS : kind;
  return allowed.some((a) => norm(a) === norm(subject)) ? null : "subject valt buiten de namespace";
}

function valueAllowed(kind: FactValueKind, value: string): string | null {
  if (value.length === 0 || value.length > MAX_VALUE) return "waarde leeg of te lang";
  if (kind === "column") {
    // A column header is a LABEL in the owner's own sheet, never a figure out
    // of it — and labels legitimately carry a year ("Omzet 2026"), which the
    // 4-digit identifier test would refuse. So a header is scanned for the
    // shapes that really do mean personal data: an IBAN, a long number run, and
    // money notation. "Omzet 2026" passes; "NL91ABNA0417164300", "12345678" and
    // "€ 1.234,56" do not.
    if (IBAN.test(value) || LONG_IDENTIFIER.test(value) || MONEY.test(value) || THOUSANDS.test(value)) {
      return "kolomnaam bevat een bedrag of rekeningnummer";
    }
    return null;
  }
  // Applies to every kind, not just free text: it is the one check that says
  // "this is money or an identifier", and no legal value of any kind — a
  // percentage, a flag, a category, a preference — ever has that shape.
  if (carriesPersonalData(value)) return "waarde bevat een bedrag of rekeningnummer";
  switch (kind) {
    case "percentage": {
      const n = asNumber(value);
      // Bounded on purpose: a percentage that must sit in 0..100 cannot carry a
      // balance, so no amount can ever be stored under a numeric key.
      if (n === null) return "waarde is geen getal";
      return n >= 0 && n <= 100 ? null : "waarde valt buiten 0..100";
    }
    case "flag":
      return value === "0" || value === "1" ? null : "waarde moet 0 of 1 zijn";
    case "category":
      return CATEGORY_OPTIONS.some((c) => norm(c) === norm(value)) ? null : "waarde is geen bestaande categorie";
    case "text":
      return null; // already scanned above; length is the only other limit
  }
}

/** Why this fact may NOT be stored, or `null` when it is fine.
 *
 *  This is the one place the namespace and the no-personal-data rule are
 *  decided; `upsertFacts` refuses anything that fails here, so an unvetted fact
 *  cannot reach the vault — and therefore cannot reach a model. */
export function checkFact(f: LearnedFact): string | null {
  const spec = SPEC_BY_AGENT.get(norm(f.agent));
  if (!spec) return "onbekende agent";

  const subjectProblem = subjectAllowed(spec, f.subject.trim());
  if (subjectProblem) return subjectProblem;

  if (f.key.length > MAX_KEY) return "key te lang";
  const keySpec = spec.keys.find((k) => norm(k.key) === norm(f.key));
  if (!keySpec) return "key valt buiten de namespace";

  const valueProblem = valueAllowed(keySpec.kind, f.value.trim());
  if (valueProblem) return valueProblem;

  if (f.note !== undefined) {
    if (f.note.length > MAX_NOTE) return "note te lang";
    if (carriesIdentifier(f.note)) return "note bevat een rekeningnummer";
  }
  return null;
}

export function isSafeFact(f: LearnedFact): boolean {
  return checkFact(f) === null;
}

export type FactRejection = { fact: LearnedFact; reason: string };

/** Split facts into the ones that may be stored and the ones that may not,
 *  with the reason — so a caller can tell the owner what was refused instead of
 *  silently losing it. */
export function validateFacts(incoming: readonly LearnedFact[]): { valid: LearnedFact[]; rejected: FactRejection[] } {
  const valid: LearnedFact[] = [];
  const rejected: FactRejection[] = [];
  for (const f of incoming) {
    const reason = checkFact(f);
    if (reason === null) valid.push(f);
    else rejected.push({ fact: f, reason });
  }
  return { valid, rejected };
}

/** Everything one agent has learned — what it reads before it answers. */
export function agentFacts(facts: readonly LearnedFact[], agent: string): LearnedFact[] {
  return facts.filter((f) => norm(f.agent) === norm(agent));
}

/** One agent's facts as prompt-ready lines: "ING betaalpas fxFeePct = 1,4
 *  (door de gebruiker)". Deliberately subject/key/value only — the `note` is
 *  free text and stays on the device, so nothing free-form is ever replayed
 *  into a model call. */
export function factBriefing(facts: readonly LearnedFact[], agent: string): string[] {
  return agentFacts(facts, agent).map(
    (f) => `${f.subject} ${f.key} = ${f.value}${f.source === "user" ? " (door de gebruiker)" : ""}`,
  );
}
