/**
 * Whole euros typed the Dutch or the English way -> cents, or null when it is
 * not an amount. A "," or "." followed by exactly three digits (repeating) is a
 * thousands separator ("3.250" and "2,500" are 3250 and 2500); followed by one
 * or two digits at the end it is the decimal mark, rounded to whole euros
 * ("12.50" is 13, "3.250,50" and "3,250.50" are 3251).
 */
export function parseEuros(text: string): number | null {
  const t = text.replace(/[€\s ]/g, "");
  const m = /^(\d{1,3}(?:[.,]\d{3})+|\d+)(?:([.,])(\d{1,2}))?$/.exec(t);
  if (!m) return null;
  const whole = m[1] ?? "";
  const seps = new Set(whole.match(/[.,]/g) ?? []);
  if (seps.size > 1) return null;
  if (m[2] !== undefined && seps.has(m[2])) return null;
  const frac = m[3] === undefined ? 0 : Number(`0.${m[3]}`);
  const euros = Math.round(Number(whole.replace(/[.,]/g, "")) + frac);
  return Number.isSafeInteger(euros * 100) ? euros * 100 : null;
}
