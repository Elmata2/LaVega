/* THE CONFIRM STEP: a closed question about a figure the catalogue already holds.
 *
 * The open question ("what is this product's surcharge on this page?") must
 * establish a figure AND its conditions from nothing, and measured on 2026-11-22
 * it often declined although the page still carried the stored number. Re-checking
 * a figure we hold is an easier and safer job: the model only says whether the
 * document still states it. A `changed` answer is never published from here; the
 * open question is the only way a value enters the catalogue.
 */
import { unwrapSourceUrl, type CatalogValue } from "@lavega/core";
import type { ToolSpec } from "./mistralClient.js";
import { normalizeQuote } from "./catalogExtract.js";

export type ConfirmRequest = {
  product: string;
  field: "fxFeePct" | "interestPct";
  storedValue: number;
  storedConditions: string | null;
  text: string;
};

export type ConfirmReply =
  | { status: "still_stated"; quote: string }
  | { status: "changed"; quote: string; newValue: number }
  | { status: "not_on_page" };

export const CONFIRM_TOOL: ToolSpec = {
  name: "confirm_figure",
  description:
    "Say whether the document still states the stored figure for this product (or the product family it belongs to), with the sentence it was read from. Use not_on_page when the document does not show it.",
  input_schema: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["still_stated", "changed", "not_on_page"],
        description:
          "still_stated: the document states the stored figure as the one that applies to this product or its family. changed: the document states a DIFFERENT figure for it. not_on_page: the document does not show the figure, or shows it only for a clearly different product.",
      },
      quote: {
        type: "string",
        description:
          "Verbatim sentence or table row from the document that shows the figure. Required for still_stated and changed. Copy it exactly; do not paraphrase.",
      },
      newValue: {
        type: "number",
        description: "Only for changed: the figure the document states instead, in percent.",
      },
    },
    required: ["status"],
  },
};

const MAX_CONDITIONS_CHARS = 240;

/** Cut at a word boundary so a long stored text does not invite the model to copy it. */
function shortConditions(text: string): string {
  if (text.length <= MAX_CONDITIONS_CHARS) return text;
  const head = text.slice(0, MAX_CONDITIONS_CHARS);
  const cut = head.slice(0, Math.max(head.lastIndexOf(" "), 1)).trimEnd();
  return `${cut}…`;
}

const fmt = (n: number) => String(n).replace(".", ",");

export function buildConfirmPrompt(req: ConfirmRequest): { system: string; user: string } {
  const what =
    req.field === "fxFeePct"
      ? "the surcharge charged on a foreign-currency payment (koersopslag, wisselkoersopslag, valutakoersopslag), as a percentage"
      : "the savings interest rate, as a percentage";
  const system = [
    "You re-check ONE figure we already hold about ONE money product against ONE document.",
    `The figure is ${what}.`,
    "",
    `Answer by calling the ${CONFIRM_TOOL.name} tool.`,
    "",
    "The question is closed: does THIS document still state the stored figure as the one",
    "that applies to this product, or to the product family it belongs to?",
    "",
    "- The document may be a general one that covers the product without naming it: a",
    "  cardholder agreement for all consumer cards of an issuer, or a general tariff sheet of",
    "  a bank. Such a document counts when its figure applies to this product or to the family",
    "  the product belongs to.",
    "- Answer still_stated only when you can quote a sentence or table row that shows the",
    "  stored figure, and the quote must contain the number itself (a zero must be quoted too,",
    "  as '0%', 'gratis', 'geen kosten' or similar, and the quote must say what it is free for:",
    "  foreign currency or exchange for a surcharge, interest for a savings rate).",
    "- Answer changed when the document states a DIFFERENT figure for this product or its",
    "  family, and quote it. Do not guess a figure.",
    "- Answer not_on_page when the document does not show the figure, or shows it only for a",
    "  clearly different product or a different kind of transaction (cash withdrawal,",
    "  transfers). not_on_page is the right answer when you are not sure. Never stretch a",
    "  number from a neighbouring row to fit.",
    "- The quote must be copied verbatim from the document, as ONE contiguous passage copied",
    "  exactly from the page, not several passages joined.",
  ].join("\n");

  const user = [
    `Product: ${req.product}`,
    `Stored figure: ${fmt(req.storedValue)}%`,
    `Stored conditions: ${req.storedConditions ? shortConditions(req.storedConditions) : "none recorded"}`,
    "",
    "Document:",
    "<<<",
    req.text,
    ">>>",
  ].join("\n");
  return { system, user };
}

const TOPIC_WORDS: Record<ConfirmRequest["field"], readonly string[]> = {
  fxFeePct: [
    "valuta",
    "currency",
    "wissel",
    "koers",
    "foreign",
    "buitenland",
    "abroad",
    "worldwide",
    "exchange",
    "conversion",
    "fx",
    "niet-euro",
    "non-euro",
    "vreemde",
  ],
  interestPct: ["rente", "interest"],
};

const MIN_QUOTE_CHARS = 25;
/** A zero word and a topic word must stand this close, so "geen" cannot vouch for a distant sentence. */
const ZERO_SPAN_CHARS = 60;

const WORD = /[\p{L}\p{N}][\p{L}\p{N}-]*/gu;
const ZERO_TOKEN =
  /(?<![\d.,])0(?:[.,]0{1,2})?\s?%|(?<![\p{L}\p{N}])(?:geen|gratis|kosteloos|no|free|without|zonder)(?![\p{L}\p{N}])/gu;

/** Start offsets of topic words. A topic word counts at the start of a word (Dutch compounds), except a
 *  word that speaks of a limit; "fx" only as a whole word. */
function topicPositions(quote: string, field: ConfirmRequest["field"]): number[] {
  const out: number[] = [];
  for (const m of quote.matchAll(WORD)) {
    const w = m[0];
    if (w.includes("limiet") || w.includes("limit")) continue;
    if (TOPIC_WORDS[field].some((t) => (t === "fx" ? w === "fx" : w.startsWith(t)))) {
      out.push(m.index ?? 0);
    }
  }
  return out;
}

function zeroStatedNearTopic(quote: string, field: ConfirmRequest["field"]): boolean {
  const topics = topicPositions(quote, field);
  if (!topics.length) return false;
  for (const m of quote.matchAll(ZERO_TOKEN)) {
    const at = m.index ?? 0;
    if (topics.some((t) => Math.abs(t - at) <= ZERO_SPAN_CHARS)) return true;
  }
  return false;
}

/** The stored number followed by a percent sign or the word, on number boundaries, and never a thousands form. */
function statesPercentage(quote: string, n: number): boolean {
  const re = /(?<![\d.,])(\d+(?:[.,]\d+)?)\s*(?:%|procent(?![\p{L}])|percent(?![\p{L}]))/gu;
  for (const m of quote.matchAll(re)) {
    const raw = m[1]!;
    if (/^\d{1,3}[.,]\d{3}$/.test(raw)) continue;
    const parsed = Number(raw.replace(",", "."));
    if (Number.isFinite(parsed) && Math.abs(parsed - n) < 1e-9) return true;
  }
  return false;
}

export type ConfirmOutcome =
  | { kind: "reply"; reply: ConfirmReply }
  | { kind: "rejected"; raw?: unknown }
  | { kind: "failed" }
  | { kind: "no-document" };

/** What the cross-check on the stored figure says about a different figure the run read. Only a
 *  clean answer lets the change go on: "gone" when the page no longer shows the stored figure
 *  (or the model itself names the found value); anything unclear is "unresolved". */
/** newValue of a structurally valid `changed` reply, quote not checked; null for anything else. */
export function readChangedValue(raw: unknown): number | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  return r.status === "changed" && typeof r.newValue === "number" && Number.isFinite(r.newValue)
    ? r.newValue
    : null;
}

const sameValue = (a: number, b: number) => Math.round(a * 1e4) === Math.round(b * 1e4);

/** True when two source URLs name the same document: archive and reader-proxy wrappers are
 *  unwrapped, then the URLs must be equal apart from a trailing slash. */
export function sameDocument(a: string, b: string): boolean {
  const bare = (u: string) => unwrapSourceUrl(u).replace(/\/+$/, "");
  return bare(a) === bare(b);
}

/** `onStoredDocument`: the answer was given on the stored figure's own document. On another
 *  document "not on the page" proves nothing about the stored figure, so only still_stated
 *  (the stored figure IS stated somewhere the run read) is a clean answer there. */
export function storedCheckOf(
  outcome: ConfirmOutcome,
  foundValue: number,
  onStoredDocument: boolean,
): "still-stated" | "gone" | "unresolved" {
  if (outcome.kind === "rejected") {
    // The found value already has its own verified quote; a second answer naming the same number
    // agrees with it, whatever its own quote looks like. Cross-check only, never the confirm step.
    const v = readChangedValue(outcome.raw);
    return onStoredDocument && v !== null && sameValue(v, foundValue) ? "gone" : "unresolved";
  }
  if (outcome.kind !== "reply") return "unresolved";
  const { reply } = outcome;
  if (reply.status === "still_stated") return "still-stated";
  if (!onStoredDocument) return "unresolved";
  if (reply.status === "not_on_page") return "gone";
  return sameValue(reply.newValue, foundValue) ? "gone" : "unresolved";
}

/** The read a still_stated confirm turns into: an uncovered read of the stored number. An archived
 *  document keeps its snapshot date, so an old snapshot cannot move confirmedAt to today. */
export function confirmRead(input: {
  storedValue: number;
  url: string;
  snapshotDate: string | null;
  today: string;
}): CatalogValue {
  return {
    value: input.storedValue,
    route: "agent",
    sourceUrl: input.url,
    checkedAt: input.snapshotDate ?? input.today,
    conditions: null,
    conditionsKnown: false,
  };
}

/** null when the reply is malformed or its quote is not in the text. */
export function parseConfirmReply(raw: unknown, req: ConfirmRequest): ConfirmReply | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.status === "not_on_page") return { status: "not_on_page" };
  if (r.status !== "still_stated" && r.status !== "changed") return null;
  if (typeof r.quote !== "string" || !r.quote.trim()) return null;
  const quote = r.quote;
  if (!normalizeQuote(req.text).includes(normalizeQuote(quote))) return null;

  if (r.status === "changed") {
    if (typeof r.newValue !== "number" || !Number.isFinite(r.newValue)) return null;
    return { status: "changed", quote, newValue: r.newValue };
  }
  const norm = normalizeQuote(quote);
  if (norm.length < MIN_QUOTE_CHARS) return null;
  const ok =
    req.storedValue === 0
      ? zeroStatedNearTopic(norm, req.field)
      : statesPercentage(norm, req.storedValue) && topicPositions(norm, req.field).length > 0;
  return ok ? { status: "still_stated", quote } : null;
}
