import type { Locale } from "./locale.js";

/* Number and date rendering follows the LANGUAGE the app is in, not the money.
 * A euro amount reads "€ 1.234,56" to a Dutch user and "€1,234.56" to an
 * English-speaking one; the amount is identical, only the separators move.
 * The no-argument exports keep the Dutch rendering so every existing caller
 * behaves exactly as before until it is converted. */

const MONTHS_NL = [
  "jan",
  "feb",
  "mrt",
  "apr",
  "mei",
  "jun",
  "jul",
  "aug",
  "sep",
  "okt",
  "nov",
  "dec",
];

/** The BCP-47 tag behind a locale. Exported because a few call sites build
 *  their own Intl formatter with options none of the helpers here cover, and
 *  each one that inlined the ternary got it wrong by hardcoding "nl-NL". */
export const localeTag = (locale: Locale): string => (locale === "nl" ? "nl-NL" : "en-GB");

const tag = localeTag;

export function formatEuroIn(locale: Locale, n: number): string {
  return new Intl.NumberFormat(tag(locale), { style: "currency", currency: "EUR" }).format(n);
}

/** Whole euros with the symbol and no cents. Inside a sentence the cents are
 *  noise: "€250" reads through, where formatEuroIn's "€ 250,00" interrupts. */
export function formatWholeEuroIn(locale: Locale, n: number): string {
  return (
    "€" + new Intl.NumberFormat(tag(locale), { maximumFractionDigits: 0 }).format(Math.round(n))
  );
}

/** Whole euros with the symbol, currency-spaced, no cents. For chart axes and
 *  forecast figures, where cents are false precision. Distinct from
 *  formatWholeEuroIn, which glues the symbol on for use mid-sentence. */
export function formatEuroAxisIn(locale: Locale, n: number): string {
  return new Intl.NumberFormat(tag(locale), {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(n);
}

export function formatCurrencyIn(locale: Locale, n: number, currency: string): string {
  try {
    return new Intl.NumberFormat(tag(locale), { style: "currency", currency }).format(n);
  } catch {
    return `${currency} ${new Intl.NumberFormat(tag(locale)).format(n)}`;
  }
}

const MONTHS_EN = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "2026-08" -> "aug 2026" / "Aug 2026". Empty string for a missing month. */
export function monthLabel(locale: Locale, ym: string): string {
  if (!ym) return "";
  const [y, m] = ym.split("-").map(Number);
  const names = locale === "nl" ? MONTHS_NL : MONTHS_EN;
  return names[m - 1] ? `${names[m - 1]} ${y}` : ym;
}

/** "2026-08" / "2026-08-04" -> "aug" / "Aug". Empty string for a missing month. */
export function monthShort(locale: Locale, ym: string): string {
  if (!ym) return "";
  const m = Number(ym.split("-")[1]);
  return (locale === "nl" ? MONTHS_NL : MONTHS_EN)[m - 1] ?? "";
}

/** A date as a reader of that language expects it: 4 aug 2026 / 4 Aug 2026. */
export function formatDate(locale: Locale, iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  const names = locale === "nl" ? MONTHS_NL : MONTHS_EN;
  return `${d} ${names[m - 1] ?? m} ${y}`;
}

export function formatEuro(n: number): string {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(n);
}

/** Same formatting as `formatEuro`, for a foreign-currency amount kept in its
 *  own currency (the "separate" FX display mode). The try/catch covers an ISO
 *  code `Intl` doesn't recognize — fall back to a manual currency-code-plus-
 *  number rendering rather than throwing and blanking the whole row. */
export function formatCurrency(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat("nl-NL", { style: "currency", currency }).format(n);
  } catch {
    return `${currency} ${new Intl.NumberFormat("nl-NL").format(n)}`;
  }
}

/** "2026-08" -> "aug 2026" (empty string for a missing month). Also accepts a
 *  full ISO date; only the year-month part is read. */
export function monthLabelNL(ym: string): string {
  if (!ym) return "";
  const [y, m] = ym.split("-").map(Number);
  return MONTHS_NL[m - 1] ? `${MONTHS_NL[m - 1]} ${y}` : ym;
}

/** "2026-08" / "2026-08-04" -> "aug" (empty string for a missing month). */
export function monthShortNL(ym: string): string {
  if (!ym) return "";
  const m = Number(ym.split("-")[1]);
  return MONTHS_NL[m - 1] ?? "";
}
