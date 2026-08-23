/* READING A SAVINGS RATE OUT OF THE BANK'S OWN DOCUMENT.
 *
 * The card side of the catalogue asks one question — what is the surcharge on a
 * foreign-currency payment. Savings asks a different one, and it is harder in a
 * specific way: a savings rate is almost never one number.
 *
 *   ABN Direct Sparen  1,25% to EUR 500.000, 1,45% to EUR 1.000.000, 0,00% above
 *   bunq Spaarrekening 3,01% actierente until 01-01-2027, then 1,50%
 *
 * DECIDED (2026-08-19): `interestPct` carries the STANDARD rate — what a saver
 * keeps once the promotion ends and at the band most balances sit in — and the
 * promo and the bands go into `conditions` as the document's own words. The promo
 * rate is returned separately so the app can show "3,01% now, 1,50% after" without
 * ranking a six-month teaser above a permanently better account.
 *
 * That is the conservative direction and it matches how the card side already
 * treats bunq: its FX figure is the 3% charged ABOVE the free allowance, not the
 * 0% inside it.
 *
 * Same discipline as the FX extractor, for the same reasons: the quote must be
 * verbatim in the text we supplied, the rate must appear inside the quote, and a
 * document scoped to one account cannot speak for the others.
 */
import { normalizeQuote, percentagesIn } from "./catalogExtract.js";

export type InterestRequest = { product: string; sourceUrl: string; text: string };

export type ExtractedRate = {
  /** The standard rate: what the saver keeps long-term. */
  standardPct: number;
  /** The promotional rate, when the document states one, else null. */
  promoPct: number | null;
  /** When the promotion ends, in the document's own words, else null. */
  promoUntil: string | null;
  /** Bands, promo terms and withdrawal restrictions, in the document's words. */
  conditions: string | null;
  conditionsKnown: boolean;
  /** Can the saver withdraw without notice or penalty? Unknown stays null. */
  freeWithdrawal: boolean | null;
  quote: string;
  /** The account this document is scoped to, or null for the whole range. */
  documentScope: string | null;
};

export function buildInterestPrompt(req: InterestRequest): { system: string; user: string } {
  const system = [
    "You read a savings rate out of a bank's own document and record it exactly as",
    "that document states it. You are not estimating and not comparing providers.",
    "",
    "WHAT IS BEING BUILT. A catalogue of Dutch savings products where every figure",
    "carries its value, its source, the date the SOURCE states, and the conditions",
    "it depends on. A figure missing any of those is refused rather than shown, so a",
    "careful 'I could not settle this' is a useful answer and a confident guess is",
    "the one thing that does real damage.",
    "",
    "THE RULE THAT MATTERS MOST HERE. A savings rate is usually several numbers, and",
    "which one you report changes what the app recommends:",
    "  - standardPct is the rate the saver KEEPS: after any promotion ends, at the",
    "    band most balances fall in (the FIRST band, unless the document says the",
    "    lower bands earn less). bunq's standardPct is 1,50%, not its 3,01%",
    "    actierente. ABN Direct Sparen's is 1,25%, its first band, not the 1,45% that",
    "    starts above half a million euro.",
    "  - promoPct is the temporary rate, when there is one, with promoUntil naming",
    "    when it ends in the document's own words.",
    "Reporting a promo as the standard rate ranks a six-month teaser above a",
    "permanently better account, and the saver who follows it is worse off in month",
    "seven. That is the failure this split exists to prevent.",
  ].join("\n");

  const user = [
    `PRODUCT: ${req.product}`,
    `SOURCE: ${req.sourceUrl}`,
    "",
    "Record the rate for THAT product, and only if this document states one for it.",
    "If the document covers savings but never prices this product, do not call the",
    "tool at all — a neighbouring account's rate is not this one's.",
    "",
    "1. standardPct — the rate kept long-term, per annum, as a number: 1.25 for",
    "   \"1,25%\". Never the promo, never a band that only applies above a threshold",
    "   most savers never reach.",
    "",
    "2. promoPct and promoUntil — the temporary rate and when it ends, or null. Copy",
    "   the end date in the document's words (\"t/m 01-01-2027\", \"6 maanden\").",
    "",
    "3. conditions — the bands, the promo terms, notice periods and withdrawal",
    "   restrictions, in the document's own words. Write them out; a saver needs to",
    "   know the 1,45% starts at EUR 500.000 and that the top band pays nothing.",
    "   Use null ONLY for a genuinely flat, unconditional, freely withdrawable rate.",
    "",
    "4. conditionsKnown — false when the document does not let you settle what the",
    "   rate depends on. False is a correct answer; never true to look decisive.",
    "",
    "5. freeWithdrawal — true when the saver can withdraw without notice or penalty,",
    "   false when a notice period or fee applies, null when the document is silent.",
    "   Silence is null, not true.",
    "",
    "6. quote — the sentence or table row you read standardPct from, copied from the",
    "   text below exactly. It is checked against that text and a quote that is not",
    "   in it is thrown away, so copy rather than paraphrase.",
    "",
    "7. documentScope — the account this document is scoped to, verbatim from its",
    "   header (\"Naam van de rekening: BasisPakket Betalen\"), or null when it covers",
    "   the whole range. A document pricing one account says nothing about another.",
    "",
    "DOCUMENT TEXT:",
    req.text,
  ].join("\n");

  return { system, user };
}

export const INTEREST_TOOL: { name: string; description: string; input_schema: object } = {
  name: "record_savings_rate",
  description:
    "Record the interest rate ONE named savings product pays, splitting the standard rate from any promotional rate, together with the bands and restrictions it depends on and the sentence it was read from. Call this only when the document states a rate for that exact product.",
  input_schema: {
    type: "object",
    properties: {
      standardPct: {
        type: "number",
        description:
          "The rate the saver keeps long-term, per annum, as a number (1.25 for 1,25%). After any promotion ends, at the band most balances fall in. NOT the actierente and NOT a band that only applies above a high threshold.",
      },
      promoPct: {
        type: ["number", "null"],
        description: "The temporary promotional rate if the document states one, else null.",
      },
      promoUntil: {
        type: ["string", "null"],
        description: "When the promotion ends, in the document's own words (\"t/m 01-01-2027\", \"6 maanden\"), else null.",
      },
      conditions: {
        type: ["string", "null"],
        description:
          "The bands, promo terms, notice periods and withdrawal restrictions, in the document's own words. null ONLY for a genuinely flat, unconditional, freely withdrawable rate.",
      },
      conditionsKnown: {
        type: "boolean",
        description: "false when the document does not let you settle what the rate depends on. Never true merely to look decisive.",
      },
      freeWithdrawal: {
        type: ["boolean", "null"],
        description: "true if withdrawable without notice or penalty, false if a notice period or fee applies, null if the document is silent. Silence is null.",
      },
      quote: {
        type: "string",
        description: "The sentence or table row standardPct was read from, copied verbatim from the supplied text.",
      },
      documentScope: {
        type: ["string", "null"],
        description: "The account this document is scoped to, verbatim from its header, or null when it covers the provider's whole range.",
      },
    },
    required: ["standardPct", "promoPct", "promoUntil", "conditions", "conditionsKnown", "freeWithdrawal", "quote", "documentScope"],
  },
};

function asRate(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  // A savings rate outside this range is a misread — a balance, a fee, a year.
  if (v < 0 || v > 25) return null;
  return v;
}

export function parseInterestReply(raw: unknown, req: InterestRequest): ExtractedRate | null {
  const r = (raw && typeof raw === "object" && "input" in raw ? (raw as { input: unknown }).input : raw) as
    | Record<string, unknown>
    | null;
  if (!r || typeof r !== "object" || Array.isArray(r)) return null;

  const standardPct = asRate(r.standardPct);
  if (standardPct === null) return null;

  const quote = typeof r.quote === "string" ? r.quote : "";
  if (!quote.trim()) return null;
  // THE ANTI-HALLUCINATION CHECK, unchanged in spirit from the FX side: a rate the
  // document does not contain cannot have been extracted from it.
  if (!normalizeQuote(req.text).includes(normalizeQuote(quote))) return null;
  // ...and the rate must sit inside the sentence claimed as its source, so a
  // neighbouring row's number cannot be imported onto a correct quote.
  if (!percentagesIn(quote).some((p) => Math.abs(p - standardPct) < 1e-9)) return null;

  const conditions = typeof r.conditions === "string" && r.conditions.trim() ? r.conditions.trim() : null;
  const documentScope =
    typeof r.documentScope === "string" && r.documentScope.trim() ? r.documentScope.trim() : null;

  let conditionsKnown = r.conditionsKnown === true && (conditions !== null);
  // A SCOPED DOCUMENT CANNOT DECLARE A FLAT RATE, for the same reason it cannot on
  // the card side: the scope is itself a condition, so a null alongside one is a
  // contradiction rather than a finding.
  if (conditions === null && documentScope !== null) conditionsKnown = false;
  // A promo with no conditions text is unsettled by construction: the saver needs
  // to know the rate changes, and "null conditions" says it does not.
  if (conditions === null && asRate(r.promoPct) !== null) conditionsKnown = false;
  // A flat rate CAN be genuinely unconditional, so an unscoped, promo-free reply
  // that claims so is allowed through.
  if (conditions === null && documentScope === null && asRate(r.promoPct) === null && r.conditionsKnown === true) {
    conditionsKnown = true;
  }

  return {
    standardPct,
    promoPct: asRate(r.promoPct),
    promoUntil: typeof r.promoUntil === "string" && r.promoUntil.trim() ? r.promoUntil.trim() : null,
    conditions,
    conditionsKnown,
    freeWithdrawal: typeof r.freeWithdrawal === "boolean" ? r.freeWithdrawal : null,
    quote,
    documentScope,
  };
}
