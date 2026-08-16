export function formatEuro(n: number): string {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(n);
}

const MONTHS_NL = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

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
