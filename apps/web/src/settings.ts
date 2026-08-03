/* App preferences that aren't sensitive account data. The alert buffer is a
 * threshold (a preference, not a balance/transaction), so it lives in
 * localStorage — outside the encrypted vault, and available before unlock.
 * Guarded so it no-ops where localStorage is absent (SSR/tests). */

const BUFFER_KEY = "lavega.bufferCents";

/** The alert buffer in integer cents (>= 0). Defaults to 0 (warn only when a
 *  balance would actually go negative). */
export function getBufferCents(): number {
  try {
    if (typeof localStorage === "undefined") return 0;
    const raw = localStorage.getItem(BUFFER_KEY);
    if (raw === null) return 0;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
  } catch {
    return 0;
  }
}

export function setBufferCents(cents: number): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(BUFFER_KEY, String(Math.max(0, Math.round(cents))));
  } catch {
    /* quota/serialization errors are non-fatal for a preference */
  }
}
