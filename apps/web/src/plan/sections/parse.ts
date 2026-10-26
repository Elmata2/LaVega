import { isIsoDate } from "@lavega/core";

/** Why a typed figure was refused. The copy turns the key into a sentence. */
export type ParseError =
  | "required"
  | "number"
  | "negative"
  | "zero"
  | "decimals"
  | "tooLarge"
  | "integer"
  | "range"
  | "date";

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: ParseError };

const fail = (error: ParseError): { ok: false; error: ParseError } => ({ ok: false, error });

/** Largest money figure accepted: 10 million euros, in cents. */
export const MAX_CENTS = 1_000_000_000;

/** A euro amount typed by the user as whole cents. "," or "." as the decimal
 *  mark, at most two decimals, no sign, no exponent. Built from the digits so
 *  no float arithmetic can move a cent. */
export function parseEuros(text: string, o: { allowZero?: boolean } = {}): Parsed<number> {
  const t = text.trim().replace(/^€\s*/, "");
  if (t === "") return fail("required");
  if (t.startsWith("-")) return /^-\d/.test(t) ? fail("negative") : fail("number");
  const m = /^(\d{1,12})(?:[.,](\d*))?$/.exec(t);
  if (m === null) return fail("number");
  const frac = m[2] ?? "";
  if (frac.length > 2) return fail("decimals");
  const cents = Number(m[1]) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return fail("tooLarge");
  if (cents === 0 && o.allowZero !== true) return fail("zero");
  return { ok: true, value: cents };
}

/** A plain number with at most `maxDecimals` decimals inside [min, max]. */
export function parseNumber(
  text: string,
  o: { min: number; max: number; maxDecimals: number },
): Parsed<number> {
  const t = text.trim();
  if (t === "") return fail("required");
  const m = /^(-?)(\d{1,9})(?:[.,](\d*))?$/.exec(t);
  if (m === null) return fail("number");
  if ((m[3] ?? "").length > o.maxDecimals)
    return fail(o.maxDecimals === 0 ? "integer" : "decimals");
  const n = Number(`${m[1]}${m[2]}${m[3] === undefined || m[3] === "" ? "" : `.${m[3]}`}`);
  if (!Number.isFinite(n)) return fail("number");
  if (n < o.min || n > o.max) return fail(n < 0 && o.min >= 0 ? "negative" : "range");
  return { ok: true, value: n === 0 ? 0 : n };
}

export const parseWholeNumber = (text: string, o: { min: number; max: number }): Parsed<number> =>
  parseNumber(text, { ...o, maxDecimals: 0 });

/** A calendar day as YYYY-MM-DD, a real date. */
export function parseDate(text: string): Parsed<string> {
  const t = text.trim();
  if (t === "") return fail("required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || !isIsoDate(t) || t < "1900-01-01") return fail("date");
  const d = new Date(`${t}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t) return fail("date");
  return { ok: true, value: t };
}

export const centsText = (cents: number): string => {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.trunc(abs / 100);
  const rest = abs % 100;
  return `${sign}${whole}${rest === 0 ? "" : `.${String(rest).padStart(2, "0")}`}`;
};
