/** A number input's text as whole cents, or null when empty or not a number
 *  of zero or more. Number inputs always use "." as the decimal mark. */
export function toCents(text: string): number | null {
  if (text.trim() === "") return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

export const centsToInput = (cents: number): string => String(Math.round(cents) / 100);
