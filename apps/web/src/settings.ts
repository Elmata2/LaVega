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

/* --- The owner's own n8n invoice webhook (see docs/n8n/FACTUREN.md).
 * URL and token are HIS, for HIS n8n: they live in this browser only — never in
 * the vault-synced data (a back-up file would then carry a live token), never
 * in the repo, and they are never sent to the LaVega server. The whole point of
 * the n8n design is that the invoice path is mailbox -> his n8n -> his browser,
 * with our server nowhere in it. --- */

const N8N_URL_KEY = "lavega.n8nInvoiceUrl";
const N8N_TOKEN_KEY = "lavega.n8nInvoiceToken";

export function getN8nInvoiceUrl(): string {
  try {
    return (typeof localStorage === "undefined" ? null : localStorage.getItem(N8N_URL_KEY)) ?? "";
  } catch {
    return "";
  }
}

export function setN8nInvoiceUrl(url: string): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(N8N_URL_KEY, String(url ?? "").trim());
  } catch {
    /* non-fatal for a preference */
  }
}

export function getN8nInvoiceToken(): string {
  try {
    return (typeof localStorage === "undefined" ? null : localStorage.getItem(N8N_TOKEN_KEY)) ?? "";
  } catch {
    return "";
  }
}

export function setN8nInvoiceToken(token: string): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(N8N_TOKEN_KEY, String(token ?? "").trim());
  } catch {
    /* non-fatal for a preference */
  }
}

const N8N_HANDLED_KEY = "lavega.n8nHandledMessageIds";
/** Keep the newest N decided messageIds. The n8n queue holds at most 200 and
 *  covers 7 days of mail, so this window is far wider than anything that can
 *  still be re-offered. */
const HANDLED_MAX = 1000;

/** Gmail messageIds already decided on (confirmed OR rejected). Needed because
 *  the n8n queue only dedups against what is STILL in the queue: it empties on
 *  read, so the hourly run over the same 7 days of mail re-queues an invoice we
 *  already dealt with. Only opaque message ids are stored here — no amounts, no
 *  counterparties; the invoice itself lives in the encrypted vault. */
export function getHandledInvoiceMessageIds(): string[] {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(N8N_HANDLED_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function addHandledInvoiceMessageIds(ids: string[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    const merged = [...getHandledInvoiceMessageIds(), ...ids.filter((id) => typeof id === "string" && id.length > 0)];
    const deduped = Array.from(new Set(merged));
    localStorage.setItem(N8N_HANDLED_KEY, JSON.stringify(deduped.slice(-HANDLED_MAX)));
  } catch {
    /* non-fatal for a preference */
  }
}

const HOME_COUNTRY_KEY = "lavega.homeCountry";

/** The owner's home country as a 2-letter code, default NL. A local-first app
 *  has no signup to read this from, so it's a preference — and it's the one
 *  thing the travel agent needs to know to look up the RIGHT market's card
 *  terms (the same brand differs per country). */
export function getHomeCountry(): string {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(HOME_COUNTRY_KEY);
    return raw && /^[A-Z]{2}$/.test(raw) ? raw : "NL";
  } catch {
    return "NL";
  }
}

export function setHomeCountry(code: string): void {
  try {
    const c = String(code ?? "").trim().toUpperCase();
    if (typeof localStorage !== "undefined" && /^[A-Z]{2}$/.test(c)) localStorage.setItem(HOME_COUNTRY_KEY, c);
  } catch {
    /* non-fatal for a preference */
  }
}
