/* THE CONFIRM STEP: a closed question about a figure the catalogue already holds.
 *
 * The open question ("what is this product's surcharge on this page?") must
 * establish a figure AND its conditions from nothing, and measured on 2026-11-22
 * it often declined although the page still carried the stored number. Re-checking
 * a figure we hold is an easier and safer job: the model only says whether the
 * document still states it. A `changed` answer is never published from here; the
 * open question is the only way a value enters the catalogue.
 */
import {
  unwrapSourceUrl,
  type CatalogField,
  type CatalogValue,
  type FeePeriod,
} from "@lavega/core";
import type { ToolSpec } from "./mistralClient.js";
import { normalizeQuote } from "./catalogExtract.js";

export type ConfirmField =
  | "fxFeePct"
  | "interestPct"
  | "accountFee"
  | "pointsPerEuro"
  | "cashbackPct";

export type ConfirmRequest = {
  product: string;
  field: ConfirmField;
  storedValue: number;
  storedConditions: string | null;
  text: string;
  /** accountFee only: the unit of storedValue. */
  storedPeriod?: FeePeriod;
  /** A points or cashback 0 that rests on "no programme": the model may answer none_stated. */
  zeroByAbsence?: boolean;
  /** Names of the OTHER products whose stored figure of this field has the same source document. */
  siblings?: readonly string[];
  /** Names of the other products of the same issuer, whatever their source document. */
  others?: readonly string[];
  /** The issuer text of the product, used to find the issuer prefix of its name. */
  issuer?: string;
};

export type ConfirmReply =
  | { status: "still_stated"; quote: string }
  | { status: "changed"; quote: string; newValue: number }
  | { status: "none_stated" }
  | { status: "not_on_page" };

/** All such zeros in the catalogue rest on "no per-euro programme" or "reward is in points, not cashback". */
export function isZeroByAbsence(field: CatalogField, value: number): boolean {
  return (field === "pointsPerEuro" || field === "cashbackPct") && value === 0;
}

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

/** The tool for fee, points and cashback confirms. FX and interest keep CONFIRM_TOOL byte for byte
 *  so their reply cache keys do not move. */
export const CONFIRM_FIGURE_TOOL: ToolSpec = {
  name: "confirm_figure",
  description:
    "Say whether the document still states the stored figure for this product, with the row or sentence it was read from. Use not_on_page when the document does not show it for this product.",
  input_schema: {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["still_stated", "changed", "none_stated", "not_on_page"],
        description:
          "still_stated: the document states the stored figure for this product. changed: the document states a DIFFERENT figure for it. none_stated: only when asked whether the document states any points or cashback rate per euro, and it states none. not_on_page: the document does not show the figure, or shows it only for a different product.",
      },
      quote: {
        type: "string",
        description:
          "Verbatim sentence or table row from the document that shows the figure. Required for still_stated and changed. Copy it exactly; do not paraphrase.",
      },
      newValue: {
        type: "number",
        description:
          "Only for changed: the figure the document states instead, in the unit of the stored figure (euro in the stored period, points per euro, or percent).",
      },
    },
    required: ["status"],
  },
};

export function confirmToolFor(req: Pick<ConfirmRequest, "field">): ToolSpec {
  return req.field === "fxFeePct" || req.field === "interestPct"
    ? CONFIRM_TOOL
    : CONFIRM_FIGURE_TOOL;
}

const MAX_CONDITIONS_CHARS = 240;

/** Cut at a word boundary so a long stored text does not invite the model to copy it. */
function shortConditions(text: string): string {
  if (text.length <= MAX_CONDITIONS_CHARS) return text;
  const head = text.slice(0, MAX_CONDITIONS_CHARS);
  const cut = head.slice(0, Math.max(head.lastIndexOf(" "), 1)).trimEnd();
  return `${cut}…`;
}

const fmt = (n: number) => String(n).replace(".", ",");

const isFamilyField = (f: ConfirmField) => f === "fxFeePct" || f === "interestPct";

function figureWhat(req: ConfirmRequest): string {
  switch (req.field) {
    case "fxFeePct":
      return "the surcharge charged on a foreign-currency payment (koersopslag, wisselkoersopslag, valutakoersopslag), as a percentage";
    case "interestPct":
      return "the savings interest rate, as a percentage";
    case "accountFee":
      return "the monthly or yearly fee for holding this card or account (with the period), in euro";
    case "pointsPerEuro":
      return "the points earned per euro spent";
    case "cashbackPct":
      return "the cashback percentage on spending";
  }
}

function storedFigure(req: ConfirmRequest): string {
  switch (req.field) {
    case "accountFee":
      return `€ ${fmt(req.storedValue)} ${req.storedPeriod === "jaar" ? "per year (per jaar)" : req.storedPeriod === "maand" ? "per month (per maand)" : "(period not on file)"}`;
    case "pointsPerEuro":
      return `${fmt(req.storedValue)} points per euro`;
    default:
      return `${fmt(req.storedValue)}%`;
  }
}

export function buildConfirmPrompt(req: ConfirmRequest): { system: string; user: string } {
  const lines = [
    "You re-check ONE figure we already hold about ONE money product against ONE document.",
    `The figure is ${figureWhat(req)}.`,
    "",
    `Answer by calling the ${CONFIRM_TOOL.name} tool.`,
    "",
  ];
  if (req.zeroByAbsence) {
    lines.push(
      "The stored figure is 0 because the provider has no per-euro programme for this product.",
      "The question: does THIS document state any points or cashback rate per euro for this product?",
      "",
      "- Answer none_stated when the document states no such rate for this product. No quote is needed.",
      "- Answer changed when the document states a rate per euro for this product: quote it verbatim and give",
      "  newValue. Do not guess a rate.",
      "- Answer not_on_page when the document is not about this product, or you cannot tell.",
    );
  } else if (isFamilyField(req.field)) {
    lines.push(
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
    );
  } else {
    lines.push(
      "The question is closed: does THIS document still state the stored figure for this product?",
      "",
      "- The document may list several products or packages side by side (columns of one tariff",
      "  table). The quote must be the row or sentence for THIS product or package. not_on_page is",
      "  right when only another product's figure is shown.",
      "- Answer still_stated only when you can quote a sentence or table row that shows the",
      "  stored figure for this product, and the quote must contain the number itself.",
    );
    if (req.siblings?.length) {
      lines.push(
        `  This document is also the source of: ${req.siblings.join("; ")}.`,
        `  The quote MUST include the header or row label that names THIS product (${req.product}), and for a`,
        "  table with one amount per product the quote must include the header row with the product names",
        "  and the row with the amounts. A quote that does not name this product is rejected.",
      );
    }
    if (req.others?.length) {
      lines.push(
        `  Other products of the same issuer: ${req.others.join("; ")}. A quote that names one of them`,
        `  and not THIS product (${req.product}) is rejected.`,
      );
    }
    if (req.field === "accountFee") {
      lines.push(
        "  The quote must show the amount in euro AND the period (per month or per year) next to it.",
        "  A fee for a different period is a different figure, not a confirmation.",
      );
    } else if (req.field === "pointsPerEuro") {
      lines.push(
        "  The quote must show the number, the word for points, and 'per euro' or similar.",
        "  When the quote gives points per another euro amount ('1 punt per € 2'), the figure is the",
        "  points divided by that amount (0,5); the quote must show both numbers.",
      );
    } else {
      lines.push("  The quote must show the percentage and say it is cashback.");
    }
    lines.push(
      "- Answer changed when the document states a DIFFERENT figure for this product, and quote it.",
      "  Do not guess a figure.",
      "- Answer not_on_page when the document does not show the figure for this product. It is the",
      "  right answer when you are not sure. Never stretch a number from a neighbouring row to fit.",
    );
  }
  lines.push(
    "- The quote must be copied verbatim from the document, as ONE contiguous passage copied",
    "  exactly from the page, not several passages joined.",
  );
  const system = lines.join("\n");

  const user = [
    `Product: ${req.product}`,
    `Stored figure: ${storedFigure(req)}`,
    `Stored conditions: ${req.storedConditions ? shortConditions(req.storedConditions) : "none recorded"}`,
    "",
    "Document:",
    "<<<",
    req.text,
    ">>>",
  ].join("\n");
  return { system, user };
}

const TOPIC_WORDS: Record<"fxFeePct" | "interestPct", readonly string[]> = {
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
/** A points or cashback sentence ("Spaar 1 Mile per 1 euro") is short by nature. */
const MIN_SHORT_QUOTE_CHARS = 15;
/** A zero word and a topic word must stand this close, so "geen" cannot vouch for a distant sentence. */
const ZERO_SPAN_CHARS = 60;

const WORD = /[\p{L}\p{N}][\p{L}\p{N}-]*/gu;
const ZERO_TOKEN =
  /(?<![\d.,])0(?:[.,]0{1,2})?\s?%|(?<![\p{L}\p{N}])(?:geen|gratis|kosteloos|no|free|without|zonder)(?![\p{L}\p{N}])/gu;

/** Start offsets of topic words. A topic word counts at the start of a word (Dutch compounds), except a
 *  word that speaks of a limit; "fx" only as a whole word. */
function topicPositions(quote: string, field: "fxFeePct" | "interestPct"): number[] {
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

function zeroStatedNearTopic(quote: string, field: "fxFeePct" | "interestPct"): boolean {
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

/** newValue of a structurally valid `changed` reply, quote not checked; null for anything else. */
export function readChangedValue(raw: unknown): number | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  return r.status === "changed" && typeof r.newValue === "number" && Number.isFinite(r.newValue)
    ? r.newValue
    : null;
}

export const sameValue = (a: number, b: number) => Math.round(a * 1e4) === Math.round(b * 1e4);

/** An address as compared for "the same document": wrappers unwrapped, host in lower case, no
 *  fragment, no trailing slash on the path. The query stays: it can select a different document. */
function bareUrl(url: string): string {
  const unwrapped = unwrapSourceUrl(url).trim();
  try {
    const u = new URL(unwrapped);
    u.hash = "";
    return `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch {
    return unwrapped.replace(/\/+$/, "");
  }
}

/** True when two source URLs name the same document: archive and reader-proxy wrappers are
 *  unwrapped, then the addresses must be equal apart from host case, fragment and trailing slash. */
export function sameDocument(a: string, b: string): boolean {
  return bareUrl(a) === bareUrl(b);
}

/** What the cross-check on the stored figure says about a different figure the run read. Only a
 *  clean answer lets the change go on: "gone" when the page no longer shows the stored figure
 *  (or the model itself names the found value); anything unclear is "unresolved".
 *  `onStoredDocument`: the answer was given on the stored figure's own document. On another
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
  if (reply.status === "none_stated" || !onStoredDocument) return "unresolved";
  if (reply.status === "not_on_page") return "gone";
  return sameValue(reply.newValue, foundValue) ? "gone" : "unresolved";
}

/** The read a still_stated confirm turns into: an uncovered read of the stored number. An archived
 *  document keeps its snapshot date, so an old snapshot cannot move confirmedAt to today. */
export function confirmRead(input: {
  storedValue: number;
  /** accountFee only: the stored period, so the read equals the stored figure. */
  period?: FeePeriod;
  url: string;
  snapshotDate: string | null;
  today: string;
}): CatalogValue {
  return {
    value: input.storedValue,
    ...(input.period ? { period: input.period } : {}),
    route: "agent",
    sourceUrl: input.url,
    checkedAt: input.snapshotDate ?? input.today,
    conditions: null,
    conditionsKnown: false,
  };
}

/** The date inside an archive address, or null for a live one. */
export function snapshotDateOf(url: string): string | null {
  const m = /web\.archive\.org\/web\/(\d{4})(\d{2})(\d{2})\d{6}/.exec(url);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export type QuoteVerdict = { ok: true } | { ok: false; reason: string };

const reject = (reason: string): QuoteVerdict => ({ ok: false, reason });
const ACCEPT: QuoteVerdict = { ok: true };

type Span = { start: number; end: number };

const PERIOD_AMOUNT_SPAN = 80;
const POINTS_SPAN = 80;
const CASHBACK_SPAN = 80;

/** Gap in characters between two spans; 0 when they touch or overlap. */
const gap = (a: Span, b: Span) => Math.max(0, Math.max(a.start, b.start) - Math.min(a.end, b.end));

function spansOf(quote: string, re: RegExp): Span[] {
  const out: Span[] = [];
  for (const m of quote.matchAll(re)) {
    const start = m.index ?? 0;
    out.push({ start, end: start + m[0].length });
  }
  return out;
}

/** A written amount as a number: "4", "4,00", "4.00", "4,-", "1.200,50". Null when it is not a clean amount. */
function parseAmount(raw: string): number | null {
  const bare = raw.replace(/,-$/, "");
  if (/^\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?$/.test(bare)) {
    const m = bare.match(/^(\d{1,3}(?:[.,]\d{3})+)(?:[.,](\d{1,2}))?$/)!;
    const whole = m[1]!.replace(/[.,]/g, "");
    return Number(`${whole}.${m[2] ?? 0}`);
  }
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(bare)) return null;
  const n = Number(bare.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

const AMOUNT = String.raw`\d+(?:[.,]\d+)*(?:,-)?`;
const EURO_BEFORE = new RegExp(
  String.raw`(?:€|(?<![\p{L}])eur(?:o)?(?![\p{L}]))\s*(${AMOUNT})(?![\d])`,
  "gu",
);
const EURO_AFTER = new RegExp(
  String.raw`(?<![\d.,])(${AMOUNT})\s*(?:€|eur(?:o)?(?![\p{L}]))`,
  "gu",
);

const RANGE_BOUND_BEFORE =
  /(?<![\p{L}])(?:up\s+to|tot|maximaal|max\.?|vanaf|from|starting\s+at|as\s+low\s+as)\s*(?:(?:a\s+|een\s+)?(?:maximum|max\.?)\s+(?:of\s+|van\s+)?)?(?:(?:wel|about|ca\.?|circa)\s+)?$/u;

/** True when a ceiling or floor word ("up to", "tot", "vanaf", ...) stands directly before the span:
 *  the number is then the bound of a range, not a standing figure. */
const isRangeBound = (quote: string, span: Span) =>
  RANGE_BOUND_BEFORE.test(quote.slice(0, span.start));

const RANGE_BOUND_REASON = "the number is a range bound";

/** The spans that are no range bound; the verdict reason when spans existed but all were bounds. */
function standingSpans<S extends Span>(
  quote: string,
  spans: S[],
): { spans: S[]; reason: string | null } {
  const standing = spans.filter((sp) => !isRangeBound(quote, sp));
  return { spans: standing, reason: spans.length && !standing.length ? RANGE_BOUND_REASON : null };
}

/** Spans of every money amount in the quote that equals n: a euro sign, EUR or "euro" next to the number. */
function moneySpans(quote: string, n: number): Span[] {
  const out: Span[] = [];
  for (const re of [EURO_BEFORE, EURO_AFTER]) {
    for (const m of quote.matchAll(re)) {
      const parsed = parseAmount(m[1]!);
      if (parsed !== null && Math.abs(parsed - n) < 1e-9) {
        const start = m.index ?? 0;
        out.push({ start, end: start + m[0].length });
      }
    }
  }
  return out;
}

const PERIOD_WORDS: Record<FeePeriod, RegExp> = {
  maand:
    /(?<![\p{L}])(?:maand|maandelijkse?|maandbijdrage|mnd|month|monthly|p\/m|p\.m\.)(?![\p{L}])/gu,
  jaar: /(?<![\p{L}])(?:jaar|jaarlijkse?|jaarbijdrage|jr|year|yearly|annual(?:ly)?|p\.j\.)(?![\p{L}])/gu,
};

/** A "per <unit>" right after an amount where the unit is a time span other than a month or a year, or a
 *  count of them: the amount is not a monthly or yearly fee. */
const OTHER_UNIT_AFTER =
  /^\s{0,3}(?:per\s+|\/\s*|-\s*)(?:kwartaal|kwartalen|quarter|quarterly|week|weken|weekly|dag|dagen|day|daily|transactie|transacties|transaction|opname|opnames|withdrawal|halfjaar|half[\s-]?year|\d+\s*(?:maand|maanden|jaar|jaren|months?|years?))(?![\p{L}])/u;

/** Time units that are neither a month nor a year: an amount they decide is no monthly or yearly fee. */
const UNIT_WORDS =
  /(?<![\p{L}])(?:kwartaal|kwartalen|kwartaalbijdrage|quarter|quarterly|week|weken|weekly|wekelijks|wk|p\/w|p\.w\.|dag|dagen|day|daily|dagelijks|etmaal|transactie|transacties|transaction|halfjaar|halfjaarlijks|half[\s-]?year|opname|opnames|withdrawal)(?![\p{L}])/gu;

/** Spans of every money amount in the quote, whatever its value. */
const allMoneySpans = (quote: string): Span[] =>
  [...spansOf(quote, EURO_BEFORE), ...spansOf(quote, EURO_AFTER)].sort((x, y) => x.start - y.start);

const hasLetter = (text: string) => /\p{L}/u.test(text);

function amountPeriodVerdict(
  quote: string,
  value: number,
  period: FeePeriod | undefined,
): QuoteVerdict {
  if (!period) return reject("stored fee has no period");
  const found = standingSpans(quote, moneySpans(quote, value));
  if (found.reason) return reject(found.reason);
  const amounts = found.spans;
  if (!amounts.length) return reject("stored amount not stated as money");
  const own = spansOf(quote, PERIOD_WORDS[period]);
  const other = spansOf(quote, PERIOD_WORDS[period === "maand" ? "jaar" : "maand"]);
  type Kind = "own" | "opposite" | "unit";
  const words: (Span & { isOwn: boolean; kind: Kind })[] = [
    ...own.map((w) => ({ ...w, isOwn: true, kind: "own" as Kind })),
    ...other.map((w) => ({ ...w, isOwn: false, kind: "opposite" as Kind })),
    ...spansOf(quote, UNIT_WORDS).map((w) => ({ ...w, isOwn: false, kind: "unit" as Kind })),
  ];
  const money = allMoneySpans(quote);
  let sawOpposite = false;
  let sawHeader = false;
  for (const a of amounts) {
    // A per-phrase that directly follows the amount ("€ 48 per jaar", "€ 4,00 p/m") decides, and a
    // per-phrase of another unit ("per kwartaal") rejects the amount. Otherwise the nearest period
    // word before the amount decides, then the nearest after it; words reach back or forward only to
    // the next amount that has a word of its own between (amounts side by side share their header).
    const tail = quote.slice(a.end);
    if (OTHER_UNIT_AFTER.test(tail)) {
      sawOpposite = true;
      continue;
    }
    const direct = words.find(
      (w) =>
        w.start >= a.end && /^\s{0,3}(?:per\s+|\/\s*|-\s*)?$/.test(quote.slice(a.end, w.start)),
    );
    let from = 0;
    let lo = a.start;
    for (const m of [...money].reverse().filter((x) => x.end <= a.start)) {
      if (hasLetter(quote.slice(m.end, lo))) {
        from = m.end;
        break;
      }
      lo = m.start;
    }
    let to = Infinity;
    let hi = a.end;
    for (const m of money.filter((x) => x.start >= a.end)) {
      if (hasLetter(quote.slice(hi, m.start))) {
        to = m.start;
        break;
      }
      hi = m.end;
    }
    const before = words.filter((w) => w.start >= from && w.end <= a.start);
    const after = words.filter((w) => w.start >= a.end && w.end <= to);
    const stacked = (run: typeof words) => new Set(run.map((w) => w.kind)).size >= 2;
    let decider = direct;
    if (!decider) {
      if (stacked(before) || (!before.length && stacked(after))) {
        sawHeader = true;
        continue;
      }
      const nearBefore = before.sort((x, y) => y.end - x.end)[0];
      const nearAfter = after.sort((x, y) => x.start - y.start)[0];
      decider = nearBefore && gap(a, nearBefore) <= PERIOD_AMOUNT_SPAN ? nearBefore : nearAfter;
    }
    if (!decider || gap(a, decider) > PERIOD_AMOUNT_SPAN) continue;
    if (decider.isOwn) return ACCEPT;
    sawOpposite = true;
  }
  return reject(
    sawOpposite
      ? "the quote gives a different period"
      : sawHeader
        ? "stacked period headers do not decide the period of an amount"
        : "no period word near the amount",
  );
}

/** Spans of `number` followed by a unit regex, on number boundaries, never a thousands form. */
function numberSpans(quote: string, n: number, unit: string): Span[] {
  const re = new RegExp(String.raw`(?<![\d.,])(\d+(?:[.,]\d+)?)\s*(?:${unit})`, "gu");
  const out: Span[] = [];
  for (const m of quote.matchAll(re)) {
    const raw = m[1]!;
    if (/^\d{1,3}[.,]\d{3}$/.test(raw)) continue;
    const parsed = Number(raw.replace(",", "."));
    if (Number.isFinite(parsed) && Math.abs(parsed - n) < 1e-9) {
      const start = m.index ?? 0;
      out.push({ start, end: start + m[0].length });
    }
  }
  return out;
}

const POINTS_READING = new RegExp(
  String.raw`(?<![\d.,])(\d+(?:[.,]\d+)?)\s*(?:(?:membership\s+rewards?|rewards?|flying\s+blue|air\s+miles)\s+)?(?:punten|punt|points|point|miles|mile)(?![\p{L}])`,
  "gu",
);
const PER_SPEND_WORD =
  /(?<![\p{L}])(?:per|voor\s+(?:elke|iedere|elk)|for\s+(?:every|each))(?![\p{L}])/gu;
const EURO_FORM = String.raw`(€|eur(?:o(?:['’]s|s)?)?)`;
const SPEND_TAIL = new RegExp(
  String.raw`^\s*(?:(?:elke|iedere|ieder|elk|each|every|bestede|besteed|uitgegeven|spent)\s+)*(?:${EURO_FORM}\s*)?(\d+(?:[.,]\d+)?)?\s*(?:(?:bestede|besteed|uitgegeven|spent)\s+)?${EURO_FORM}?(?![\p{L}])`,
  "u",
);

/** A plain count: "2", "0,5". Null for a thousands form or anything else. */
function parseCount(raw: string): number | null {
  if (/^\d{1,3}[.,]\d{3}$/.test(raw)) return null;
  const n = Number(raw.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

/** Each "per euro", "per € 2", "voor elke 2 euro" of the quote with the euro amount it counts per.
 *  "per maand" or "per aankoop" is no spend phrase. */
function spendPhrases(quote: string): (Span & { spend: number })[] {
  const out: (Span & { spend: number })[] = [];
  for (const m of quote.matchAll(PER_SPEND_WORD)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const tail = SPEND_TAIL.exec(quote.slice(end, end + 40));
    if (!tail || (!tail[1] && !tail[3])) continue;
    const spend = tail[2] === undefined ? 1 : parseCount(tail[2]);
    if (spend === null || spend <= 0) continue;
    out.push({ start, end: end + tail[0].trimEnd().length, spend });
  }
  return out;
}

/** The points per euro the quote states: points divided by the euro amount they are earned per. A
 *  figure is confirmed only by the rate its own quote gives, so "1 punt per € 2" is 0.5, never 1. */
function pointsQuoteVerdict(quote: string, value: number): QuoteVerdict {
  if (value === 0) return reject("a zero points figure rests on absence and has no quote rule");
  const readings: (Span & { points: number })[] = [];
  for (const m of quote.matchAll(POINTS_READING)) {
    const points = parseCount(m[1]!);
    if (points === null) continue;
    const start = m.index ?? 0;
    readings.push({ start, end: start + m[0].length, points });
  }
  const found = standingSpans(quote, readings);
  if (found.reason) return reject(found.reason);
  if (!found.spans.length) return reject("no number next to a points word");
  const phrases = spendPhrases(quote);
  const rates = found.spans.flatMap((n) => {
    const nearest = phrases
      .filter((p) => gap(n, p) <= POINTS_SPAN)
      .sort((x, y) => gap(n, x) - gap(n, y))[0];
    return nearest ? [n.points / nearest.spend] : [];
  });
  if (!rates.length) return reject("no per-spend word near the points");
  return rates.some((r) => sameValue(r, value))
    ? ACCEPT
    : reject("the points per euro of the quote is not the stored figure");
}

const NEGATION_BEFORE = /(?<![\p{L}])(?:geen|no|zonder|without|niet|not)\s+$/u;
const FEE_WORD_AFTER =
  /^\s*(?:\(?[\p{L}-]+\)?\s+)?(?:koersopslag|opslag|rente|interest|surcharge|fee|kosten|markup|mark-up|wisselkoers\p{L}*|valutakoers\p{L}*|valutawissel\p{L}*|exchange|fx)(?![\p{L}])/u;

function cashbackQuoteVerdict(quote: string, value: number): QuoteVerdict {
  if (value === 0) return reject("a zero cashback figure rests on absence and has no quote rule");
  const found = standingSpans(quote, numberSpans(quote, value, "%"));
  if (found.reason) return reject(found.reason);
  const numbers = found.spans.filter((n) => !FEE_WORD_AFTER.test(quote.slice(n.end)));
  if (!numbers.length) {
    return reject(
      found.spans.length
        ? "the percentage is a fee or a rate, not cashback"
        : "stored percentage not stated",
    );
  }
  const words = spansOf(quote, /cashback|geld terug|(?<![\p{L}])terug(?![\p{L}])/gu).filter(
    (w) => !NEGATION_BEFORE.test(quote.slice(0, w.start)),
  );
  const percents = spansOf(quote, /(?<![\d.,])\d+(?:[.,]\d+)?\s*%/gu);
  // The stored percentage must be the one nearest to a cashback word.
  const tied = (n: Span) =>
    words.some((w) => {
      const d = gap(n, w);
      return d <= CASHBACK_SPAN && percents.every((o) => gap(o, w) >= d);
    });
  return numbers.some(tied) ? ACCEPT : reject("no cashback word tied to the stored percentage");
}

export type Binding = {
  product: string;
  issuer?: string;
  /** The other products whose stored figure of the same field has the same source document. */
  siblings: readonly string[];
  /** The other products of the same issuer, whatever their source document. */
  others?: readonly string[];
  /** The quote itself must name this product: a first figure has no stored figure to compare with. */
  requireName?: boolean;
};

const bindingOf = (req: ConfirmRequest): Binding | undefined =>
  req.field === "fxFeePct" || req.field === "interestPct"
    ? undefined
    : {
        product: req.product,
        issuer: req.issuer,
        siblings: req.siblings ?? [],
        others: req.others ?? [],
      };

const normName = (name: string) =>
  normalizeQuote(name)
    .replace(/credit\s+card/g, "creditcard")
    .trim();

type Variant = { text: string; drops: number };

/** The full name, and the name with its leading issuer prefix dropped (the first word when the issuer
 *  text has it, then further leading words while two words remain). */
function variantsOf(name: string, issuer: string | undefined): Variant[] {
  const words = normName(name).split(/\s+/).filter(Boolean);
  const out: Variant[] = [{ text: words.join(" "), drops: 0 }];
  const issuerWords = new Set(
    normName(issuer ?? "")
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean),
  );
  if (words.length < 3 || !issuerWords.has(words[0]!)) return out;
  out.push({ text: words.slice(1).join(" "), drops: 1 });
  for (let k = 2; words.length - k >= 2; k++)
    out.push({ text: words.slice(k).join(" "), drops: k });
  return out;
}

const escapeRe = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordMatcher = (text: string) =>
  new RegExp(
    String.raw`(?<![\p{L}\p{N}])${text
      .split(" ")
      .map(escapeRe)
      .join(String.raw`\s+`)}(?![\p{L}\p{N}])`,
    "gu",
  );

type NameHit = { start: number; end: number; owner: number };

/** Where each product (index 0 is this one) is named in the quote. A shorter form of a name counts only
 *  when no other product has the same form with fewer words dropped; the longest match wins an overlap. */
function nameHits(norm: string, binding: Binding): NameHit[] {
  const own = normName(binding.product);
  const rivals = [...new Set([...binding.siblings, ...(binding.others ?? [])])].filter(
    (n) => normName(n) !== own,
  );
  const names = [binding.product, ...rivals];
  const all = names.map((n, i) => variantsOf(n, binding.issuer).map((v) => ({ ...v, owner: i })));
  const hits: (NameHit & { length: number })[] = [];
  for (const mine of all) {
    for (const v of mine) {
      const clash = all.some(
        (other) => other !== mine && other.some((o) => o.text === v.text && o.drops <= v.drops),
      );
      if (clash) continue;
      for (const m of norm.matchAll(wordMatcher(v.text))) {
        const start = m.index ?? 0;
        hits.push({ start, end: start + m[0].length, owner: v.owner, length: m[0].length });
      }
    }
  }
  hits.sort((a, b) => b.length - a.length || a.start - b.start);
  const taken: NameHit[] = [];
  for (const h of hits) {
    if (!taken.some((t) => h.start < t.end && t.start < h.end)) taken.push(h);
  }
  return taken.sort((a, b) => a.start - b.start);
}

/** Every money amount of the quote, in reading order. */
function moneyAmounts(quote: string): { at: number; value: number }[] {
  const seen = new Map<number, number>();
  for (const re of [EURO_BEFORE, EURO_AFTER]) {
    for (const m of quote.matchAll(re)) {
      const value = parseAmount(m[1]!);
      const at = (m.index ?? 0) + m[0].indexOf(m[1]!);
      if (value !== null && !seen.has(at)) seen.set(at, value);
    }
  }
  return [...seen.entries()].sort((a, b) => a[0] - b[0]).map(([at, value]) => ({ at, value }));
}

const nameTokens = (name: string) =>
  normName(name)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** A shortened label of another product that this product's own name does not hold ("Gold" for "ICS Visa
 *  World Card Gold" next to "ICS Visa World Card"): every word of the rival's name that is not in this
 *  product's name (or the issuer's) stands in the quote. Used only when the quote holds no name of this
 *  product, so an ambiguous short form cannot slip by as a name-less quote. */
function namesOtherByLabel(norm: string, binding: Binding): boolean {
  const own = new Set([...nameTokens(binding.product), ...nameTokens(binding.issuer ?? "")]);
  const quoteWords = new Set(nameTokens(norm));
  return [...binding.siblings, ...(binding.others ?? [])].some((rival) => {
    const distinct = nameTokens(rival).filter((w) => w.length >= 2 && !own.has(w));
    return distinct.length > 0 && distinct.every((w) => quoteWords.has(w));
  });
}

/** A quote must name THIS product when the document is shared with other products, when the quote holds
 *  several money amounts, when it names another product of the issuer, or when it is a first figure. A
 *  quote that names this product and another one must line up names and amounts: a header row of names
 *  over a row of amounts has to give the stored amount in this product's column. */
function bindingVerdict(
  field: ConfirmField,
  norm: string,
  value: number,
  binding: Binding,
): QuoteVerdict {
  const amounts = field === "accountFee" ? moneyAmounts(norm) : [];
  const hits = nameHits(norm.replace(/credit\s+card/g, "creditcard"), binding);
  const ownIndexes = hits.flatMap((h, i) => (h.owner === 0 ? [i] : []));
  const namesOther = hits.some((h) => h.owner !== 0);
  if (!ownIndexes.length) {
    if (namesOtherByLabel(norm, binding)) return reject("quote names another product");
    return binding.siblings.length > 0 || amounts.length >= 2 || namesOther || binding.requireName
      ? reject("quote does not name the product")
      : ACCEPT;
  }
  if (!namesOther) return ACCEPT;
  if (amounts.length < 2) return reject("the quote names several products but gives one figure");
  if (hits.length !== amounts.length) {
    return reject("the product names and the amounts of the quote do not line up");
  }
  return ownIndexes.some((i) => Math.abs(amounts[i]!.value - value) < 1e-9)
    ? ACCEPT
    : reject("the amount in the product's column is not the stored amount");
}

/** True when the document names the product: the full name or the name without its issuer prefix,
 *  case-insensitive, whitespace-normalised, on word boundaries. A hit inside a longer sibling name
 *  ("ING Creditcard More" for "ING Creditcard") does not count. */
export function documentNamesProduct(
  text: string,
  product: string,
  issuer?: string,
  siblings: readonly string[] = [],
): boolean {
  const hay = normName(text);
  return nameHits(hay, { product, issuer, siblings }).some((h) => h.owner === 0);
}

/** The per-field quote rules for a still_stated claim, independent of the reply shape: the open
 *  question reuses them for a figure it read. `quote` is checked as given (lowercased and
 *  whitespace-collapsed here); that it is in the document is the caller's check. */
export function checkFigureQuote(
  field: ConfirmField,
  value: number,
  period: FeePeriod | undefined,
  quote: string,
  binding?: Binding,
): QuoteVerdict {
  if (field === "accountFee" && value === 0) {
    return reject("a zero fee is not confirmed from a quote");
  }
  const norm = normalizeQuote(quote);
  const minChars =
    field === "pointsPerEuro" || field === "cashbackPct" ? MIN_SHORT_QUOTE_CHARS : MIN_QUOTE_CHARS;
  if (norm.length < minChars) return reject(`quote shorter than ${minChars} characters`);
  switch (field) {
    case "fxFeePct":
    case "interestPct":
      return (
        value === 0
          ? zeroStatedNearTopic(norm, field)
          : statesPercentage(norm, value) && topicPositions(norm, field).length > 0
      )
        ? ACCEPT
        : reject("quote does not state the figure near its topic");
    case "accountFee":
    case "pointsPerEuro":
    case "cashbackPct": {
      const own =
        field === "accountFee"
          ? amountPeriodVerdict(norm, value, period)
          : field === "pointsPerEuro"
            ? pointsQuoteVerdict(norm, value)
            : cashbackQuoteVerdict(norm, value);
      if (!own.ok || !binding) return own;
      return bindingVerdict(field, norm, value, binding);
    }
  }
}

/** null when the reply is malformed or its quote is not in the text. */
export function parseConfirmReply(raw: unknown, req: ConfirmRequest): ConfirmReply | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (r.status === "not_on_page") return { status: "not_on_page" };
  if (r.status === "none_stated") return req.zeroByAbsence ? { status: "none_stated" } : null;
  if (r.status !== "still_stated" && r.status !== "changed") return null;
  if (r.status === "still_stated" && req.zeroByAbsence) return null;
  if (typeof r.quote !== "string" || !r.quote.trim()) return null;
  const quote = r.quote;
  if (!normalizeQuote(req.text).includes(normalizeQuote(quote))) return null;

  if (r.status === "changed") {
    if (typeof r.newValue !== "number" || !Number.isFinite(r.newValue)) return null;
    if (
      req.zeroByAbsence &&
      !(
        r.newValue > 0 &&
        checkFigureQuote(req.field, r.newValue, undefined, quote, bindingOf(req)).ok
      )
    ) {
      return null;
    }
    return { status: "changed", quote, newValue: r.newValue };
  }
  return checkFigureQuote(req.field, req.storedValue, req.storedPeriod, quote, bindingOf(req)).ok
    ? { status: "still_stated", quote }
    : null;
}
