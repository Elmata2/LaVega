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

const AI_KEY = "lavega.aiExtraction";

/** Opt-in toggle for AI PDF invoice extraction. Defaults false: no document is
 *  ever sent to the server (and onward to Anthropic) unless the owner turns this
 *  on AND picks a specific PDF. A preference, so it lives in localStorage. */
export function getAiExtractionEnabled(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(AI_KEY) === "1";
  } catch {
    return false;
  }
}

export function setAiExtractionEnabled(on: boolean): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(AI_KEY, on ? "1" : "0");
  } catch {
    /* quota/serialization errors are non-fatal for a preference */
  }
}

const CHAT_KEY = "lavega.chatEnabled";

/** Opt-in toggle for the LaVega chat assistant. Defaults false: no tab
 *  context or message is ever sent to the server (and onward to Claude)
 *  until the owner explicitly turns this on. A preference, so it lives in
 *  localStorage. */
export function getChatEnabled(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(CHAT_KEY) === "1";
  } catch {
    return false;
  }
}

export function setChatEnabled(on: boolean): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(CHAT_KEY, on ? "1" : "0");
  } catch {
    /* quota/serialization errors are non-fatal for a preference */
  }
}

const CATEGORIZE_KEY = "lavega.aiCategorize";

/** Opt-in toggle for AI transaction-categorization. Defaults false: the
 *  merchant text of your onbekend transactions is only sent to the server
 *  (and onward to Claude) after the owner turns this on. A preference, so it
 *  lives in localStorage. */
export function getAiCategorizeEnabled(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(CATEGORIZE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setAiCategorizeEnabled(on: boolean): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(CATEGORIZE_KEY, on ? "1" : "0");
  } catch {
    /* quota/serialization errors are non-fatal for a preference */
  }
}
