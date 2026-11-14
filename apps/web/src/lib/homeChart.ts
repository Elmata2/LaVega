/* Which chart the Home chart slot shows. One preference, this browser only:
 * never in the vault, never in a back-up. Every storage access is guarded, so a
 * blocked or throwing store gives the default and the slot still renders. */

export type HomeChart = "position" | "cashflow";

const KEY = "lavega.homeChart";

export function readHomeChart(): HomeChart {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(KEY);
    return raw === "cashflow" ? "cashflow" : "position";
  } catch {
    return "position";
  }
}

export function writeHomeChart(value: HomeChart): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(KEY, value);
  } catch {
    /* a preference that cannot be saved is still a working slot */
  }
}
