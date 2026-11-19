import { adviceHits, maskDataNames } from "./adviceWords.js";

/* The two guards that run on the COMPLETE answer, in the browser, before it is
 * shown. Pure: no clock, no network.
 *
 * Numbers: every amount in the answer must be a figure a tool returned in this
 * question (or one the user typed, or one an earlier, already checked answer
 * quoted). The model does no arithmetic, so a sum or a difference it worked out
 * itself is not in the results and is caught. Signs are ignored (a debt may be
 * quoted as owed). Small whole numbers (0 to 31: days and counts) and years pass.
 *
 * Advice: the one banned-language list (`findAdviceLanguage`), in both
 * languages, because the model answers in the user's language, not the UI's. */

/** "1.234,56", "1,234.56", "1234.56", "84", "15,99" to a number. */
export function parseChatAmount(raw: string): number {
  const s = raw.replace(/[.,]+$/, "");
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  let canonical: string;
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = Math.max(lastDot, lastComma);
    canonical = `${s.slice(0, dec).replace(/[.,]/g, "")}.${s.slice(dec + 1)}`;
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? "." : ",";
    const parts = s.split(sep);
    const last = parts[parts.length - 1] ?? "";
    const thousands = parts.length > 2 || (last.length === 3 && (parts[0]?.length ?? 0) <= 3);
    canonical = thousands ? parts.join("") : `${parts.slice(0, -1).join("")}.${last}`;
  } else canonical = s;
  return Number(canonical);
}

const NUM = String.raw`(\d[\d.,]*\d|\d)`;
const ISO_DATE = /\d{4}-\d{2}-\d{2}/g;
const MONEY_PREFIX = new RegExp(String.raw`(?:€|\bEUR\b)\s?-?\s?${NUM}`, "gi");
const MONEY_SUFFIX = new RegExp(String.raw`${NUM}\s?(?:€|\beuros?\b|\bEUR\b)`, "gi");
const PERCENT = new RegExp(String.raw`${NUM}\s?%`, "g");
const BARE = new RegExp(NUM, "g");

const key = (v: number): number => Math.round(v * 1e6);

type Token = { raw: string; value: number };

function takeAll(text: string, re: RegExp): { tokens: Token[]; rest: string } {
  const tokens: Token[] = [];
  const rest = text.replace(re, (whole: string, num: string) => {
    tokens.push({ raw: whole.trim(), value: parseChatAmount(num) });
    return " ";
  });
  return { tokens, rest };
}

/** All figures in a text, split into money, percent and bare numbers. */
function figuresIn(text: string): { money: Token[]; percent: Token[]; bare: Token[] } {
  const noDates = text.replace(ISO_DATE, " ");
  const a = takeAll(noDates, MONEY_PREFIX);
  const b = takeAll(a.rest, MONEY_SUFFIX);
  const c = takeAll(b.rest, PERCENT);
  const d = takeAll(c.rest, BARE);
  return { money: [...a.tokens, ...b.tokens], percent: c.tokens, bare: d.tokens };
}

type Allowed = { cents: Set<number>; values: Set<number>; percents: Set<number> };

function addValue(allowed: Allowed, v: number): void {
  if (!Number.isFinite(v)) return;
  allowed.values.add(key(v));
  allowed.values.add(key(Math.abs(v)));
  allowed.percents.add(key(v));
  if (Math.abs(v) <= 1) {
    const p = v * 100;
    allowed.percents.add(key(p));
    allowed.percents.add(key(Math.round(p)));
    allowed.percents.add(key(Math.round(p * 10) / 10));
  }
}

function addText(allowed: Allowed, text: string): void {
  const f = figuresIn(text);
  for (const t of f.money) {
    allowed.cents.add(Math.round(Math.abs(t.value) * 100));
    addValue(allowed, t.value);
  }
  for (const t of [...f.percent, ...f.bare]) addValue(allowed, t.value);
}

function walk(allowed: Allowed, node: unknown, depth = 0): void {
  if (depth > 10) return;
  if (typeof node === "number") addValue(allowed, node);
  else if (typeof node === "string") {
    /* Names, categories and dates are DATA, not figures: a merchant called
     * "Refund 4999 euro" must not make 4999 an allowed amount. Only money objects and
     * numeric fields count. */
  } else if (Array.isArray(node)) for (const n of node) walk(allowed, n, depth + 1);
  else if (node && typeof node === "object") {
    const o = node as Record<string, unknown>;
    if (typeof o.cents === "number" && typeof o.text === "string") {
      allowed.cents.add(Math.abs(o.cents));
      addValue(allowed, o.cents / 100);
    }
    for (const v of Object.values(o)) walk(allowed, v, depth + 1);
  }
}

export type NumberCheck = { ok: boolean; offending: string[] };

export function checkNumbers(
  answer: string,
  sources: {
    /** The tool messages (JSON text) of this question. */
    results: readonly string[];
    /** What the user typed. */
    user: readonly string[];
    /** Earlier answers of this conversation that already passed this check. */
    earlier: readonly string[];
  },
): NumberCheck {
  const allowed: Allowed = { cents: new Set(), values: new Set(), percents: new Set() };
  for (const r of sources.results) {
    try {
      walk(allowed, JSON.parse(r));
    } catch {
      /* a result that is not JSON carries no figure */
    }
  }
  for (const t of [...sources.user, ...sources.earlier]) addText(allowed, t);

  /* A name quoted whole from the results ("Trading 212", "Albert Heijn 1234") is data:
   * its digits are not figures the model claims. */
  const f = figuresIn(maskDataNames(answer, dataStringsOf(sources.results)));
  const offending: string[] = [];
  for (const t of f.money)
    if (!allowed.cents.has(Math.round(Math.abs(t.value) * 100))) offending.push(t.raw);
  for (const t of f.percent) if (!allowed.percents.has(key(t.value))) offending.push(t.raw);
  for (const t of f.bare) {
    const v = t.value;
    const small = Number.isInteger(v) && v >= 0 && v <= 31;
    const year = Number.isInteger(v) && v >= 1900 && v <= 2100;
    if (!small && !year && !allowed.values.has(key(v))) offending.push(t.raw);
  }
  return { ok: offending.length === 0, offending };
}

const MIN_DATA_CHARS = 8;
const MIN_DATA_WORDS = 2;

const isNameWorthMasking = (s: string): boolean =>
  s.trim().split(/\s+/).length >= MIN_DATA_WORDS || s.length >= MIN_DATA_CHARS;

/** Every string in the tool results of this question: merchant, account and bill
 *  names, categories. They are DATA, so quoting one is not the model giving advice. */
export function dataStringsOf(results: readonly string[]): string[] {
  const found = new Set<string>();
  const visit = (node: unknown, depth: number): void => {
    if (depth > 10) return;
    if (typeof node === "string") {
      if (isNameWorthMasking(node)) found.add(node);
      /* A name clipped to 60 characters ends in "…"; the model may quote it without. */
      const unclipped = node.replace(/…$/, "");
      if (unclipped !== node && isNameWorthMasking(unclipped)) found.add(unclipped);
    } else if (Array.isArray(node)) for (const n of node) visit(n, depth + 1);
    else if (node && typeof node === "object")
      for (const v of Object.values(node)) visit(v, depth + 1);
  };
  for (const r of results) {
    try {
      visit((JSON.parse(r) as { data?: unknown }).data, 0);
    } catch {
      /* a result that is not JSON carries no names */
    }
  }
  return [...found].sort((a, b) => b.length - a.length);
}

/** Labels of the product or investment advice phrases the answer trips.
 *  `dataStrings` (see `dataStringsOf`) are blanked out first where they stand whole: a
 *  name quoted from the owner's own data is data. The model's own words are checked. */
export function checkAdvice(answer: string, dataStrings: readonly string[] = []): string[] {
  return adviceHits(maskDataNames(answer, dataStrings));
}

/* --- the plain facts shown when an answer cannot be checked --- */

const SKIP_KEYS = new Set([
  "alias",
  "currency",
  "classification",
  "source",
  "direction",
  "sumCurrency",
  "function",
  "type",
  "dataCovers",
  "reason",
  "status",
  "weekday",
  "asOf",
]);
const MAX_FACTS = 12;

const isMoney = (v: unknown): v is { cents: number; text: string } =>
  !!v &&
  typeof v === "object" &&
  typeof (v as { text?: unknown }).text === "string" &&
  typeof (v as { cents?: unknown }).cents === "number";

function collect(node: unknown, out: string[], depth = 0): void {
  if (depth > 8 || out.length >= MAX_FACTS) return;
  if (Array.isArray(node)) {
    for (const n of node) collect(n, out, depth + 1);
    return;
  }
  if (!node || typeof node !== "object") return;
  const o = node as Record<string, unknown>;
  const strings: string[] = [];
  const moneys: string[] = [];
  for (const [k, v] of Object.entries(o)) {
    if (SKIP_KEYS.has(k)) continue;
    if (typeof v === "string" && v !== "") strings.push(v);
    else if (isMoney(v)) moneys.push(v.text);
  }
  if (moneys.length > 0) {
    const line = [...strings, ...moneys].join(" · ");
    if (!out.includes(line)) out.push(line);
  }
  for (const [k, v] of Object.entries(o)) {
    if (SKIP_KEYS.has(k) || isMoney(v)) continue;
    if (v && typeof v === "object") collect(v, out, depth + 1);
  }
}

/** Plain lines (name, date, amount text) from this question's tool results. */
export function plainFacts(results: readonly string[]): string[] {
  const out: string[] = [];
  for (const r of results) {
    try {
      const parsed = JSON.parse(r) as { data?: unknown };
      collect(parsed.data, out);
    } catch {
      /* skip */
    }
  }
  return out.slice(0, MAX_FACTS);
}
