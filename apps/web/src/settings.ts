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

const MODULES_KEY = "lavega.navModules";

/** Which modules the owner put in his top navigation (see components/
 *  moduleRegistry.tsx). A preference about HIS app, not data about his money,
 *  so it lives in localStorage next to the buffer and the home country — it
 *  survives a reload, it stays out of the vault, and a back-up file therefore
 *  never carries one person's nav layout into another's vault.
 *
 *  Returns `null` when he has never chosen. "Not chosen" is not the same as
 *  "chose nothing", and this function will not invent a default: the registry
 *  decides what an unset preference means, and an explicitly emptied list
 *  stays empty (bar the home module the registry always adds back). */
export function getEnabledModules(): string[] | null {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(MODULES_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null; // garbage is "never chosen", not "chose nothing"
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return null;
  }
}

export function setEnabledModules(ids: string[]): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(MODULES_KEY, JSON.stringify(ids));
  } catch {
    /* quota/serialization errors are non-fatal for a preference */
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

const HOME_REGION_KEY = "lavega.homeRegion";
/** A subdivision name, not an essay. Long enough for "Newfoundland and
 *  Labrador", short enough that a paste accident cannot fill the store. */
const REGION_MAX = 80;

/** The region/state under the home country — "Texas" is not the same tax
 *  question as "New York", and no country code can carry that. Free text on
 *  purpose: for most countries LaVega has no verified subdivision list, and a
 *  dropdown of guesses in front of a tax decision is worse than a text field.
 *
 *  There is NO default. An empty string means "he has not said", which is a
 *  different thing from a region — nothing downstream may read it as one. */
export function getHomeRegion(): string {
  try {
    return (typeof localStorage === "undefined" ? null : localStorage.getItem(HOME_REGION_KEY)) ?? "";
  } catch {
    return "";
  }
}

export function setHomeRegion(region: string): void {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(HOME_REGION_KEY, String(region ?? "").trim().slice(0, REGION_MAX));
    }
  } catch {
    /* non-fatal for a preference */
  }
}

const NAME_FIRST_KEY = "lavega.ownerFirstName";
const NAME_LAST_KEY = "lavega.ownerLastName";
/** A name, not a paste buffer. */
const NAME_MAX = 60;

export type OwnerName = { first: string; last: string };

/** The owner's own name, so the profile reads as HIS screen rather than as a
 *  settings page.
 *
 *  It is a preference and nothing more: localStorage, this browser, never in
 *  the vault (so a back-up file cannot carry one person's name into another's
 *  vault), never sent to the server, and deliberately not part of any agent or
 *  chat context — the redaction boundary exists so a model never learns who the
 *  owner is, and a display name would hand it over for free.
 *
 *  Empty strings mean "not given" and are never filled in with a guess. */
export function getOwnerName(): OwnerName {
  try {
    if (typeof localStorage === "undefined") return { first: "", last: "" };
    return {
      first: localStorage.getItem(NAME_FIRST_KEY) ?? "",
      last: localStorage.getItem(NAME_LAST_KEY) ?? "",
    };
  } catch {
    return { first: "", last: "" };
  }
}

export function setOwnerName(name: OwnerName): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(NAME_FIRST_KEY, String(name.first ?? "").trim().slice(0, NAME_MAX));
    localStorage.setItem(NAME_LAST_KEY, String(name.last ?? "").trim().slice(0, NAME_MAX));
  } catch {
    /* non-fatal for a preference */
  }
}

/** How to greet him: both names when he gave them, one when he gave one, and
 *  nothing at all when he gave neither — the header says something else then,
 *  rather than greeting an empty space. */
export function ownerDisplayName(name: OwnerName): string {
  return [name.first, name.last].map((s) => s.trim()).filter(Boolean).join(" ");
}
