/** A percentage typed the Dutch or the English way ("14,9", "14.9 %", "15") ->
 *  percentage points, or null when it is not one. Between 0 and 100 inclusive. */
export function parsePercent(text: string): number | null {
  const t = text.replace(/[%\s ]/g, "");
  if (!/^\d{1,3}(?:[.,]\d{1,3})?$/.test(t)) return null;
  const n = Number(t.replace(",", "."));
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : null;
}
