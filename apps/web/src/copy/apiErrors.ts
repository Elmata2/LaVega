import type { Locale } from "../locale.js";

/**
 * A server error route now returns `{ error, code }`: `error` is the
 * server's own Dutch sentence (kept for an older browser bundle that has
 * never heard of `code`), and `code` is a stable machine tag for the same
 * failure. This module is where a `code` becomes a sentence in the reader's
 * own language — the Dutch entries below are byte-identical copies of the
 * `error` strings they replace, and the English entries are the same
 * failures said in English rather than a leaked-Dutch screen. `apiErrorText`
 * is the lookup: given `code`, it returns the localized sentence, or the
 * server's own `fallback` string untouched when `code` is missing or
 * unrecognized (an older or a newer server than this bundle knows about).
 */

export type ApiErrorCode =
  | "ai-fault"
  | "ai-upstream-limit"
  | "ai-credentials-refused"
  | "ai-unavailable"
  | "ai-budget-day"
  | "ai-budget-month"
  | "extract-not-configured"
  | "chat-not-configured"
  | "categorize-not-configured"
  | "travel-not-configured"
  | "extract-rate-limited-local"
  | "chat-rate-limited-local"
  | "categorize-rate-limited-local"
  | "travel-rate-limited-local"
  | "extract-invalid-input"
  | "extract-pdf-too-large"
  | "extract-text-too-large"
  | "extract-no-document"
  | "categorize-invalid-input"
  | "categorize-no-items"
  | "categorize-too-many-items"
  | "categorize-text-too-long"
  | "categorize-no-valid-items"
  | "travel-invalid-input"
  | "travel-invalid-destination"
  | "travel-too-many-providers"
  | "travel-no-providers"
  | "travel-too-many-facts"
  | "chat-context-too-large"
  | "chat-empty-message"
  | "bad-input"
  | "n8n-not-configured"
  | "n8n-queue-unauthenticated"
  | "n8n-misconfigured-url"
  | "n8n-unreachable"
  | "n8n-upstream-error"
  | "n8n-unreadable"
  | "n8n-forward-address-read-unauthenticated"
  | "n8n-forward-address-write-unauthenticated"
  | "n8n-address-invalid"
  | "n8n-address-taken";

/** Every entry is a plain sentence except `n8n-upstream-error`, which embeds
 *  the HTTP status n8n itself answered with — that shape lives in the type
 *  so a caller can never mix the two up. */
type ApiErrorCopyShape = {
  [K in ApiErrorCode]: K extends "n8n-upstream-error" ? (status: number) => string : string;
};

/* Byte-identical to the `error` literals the server routes return today
 * (agent-routes.ts, n8n-routes.ts) — do not retype or "improve" these. */
const nl: ApiErrorCopyShape = {
  "ai-fault": "De AI-dienst gaf een fout; probeer het later opnieuw.",
  "ai-upstream-limit":
    "De AI-aanbieder weigert nu verzoeken (limiet van het account bereikt). Controleer je Mistral-account; opnieuw proberen helpt pas daarna.",
  "ai-credentials-refused":
    "De AI-aanbieder weigert de sleutel van deze server (401/403). Controleer MISTRAL_API_KEY in de omgeving; opnieuw proberen helpt niet.",
  "ai-unavailable": "De AI-dienst is tijdelijk niet beschikbaar.",
  "ai-budget-day": "De AI-limiet voor vandaag is bereikt.",
  "ai-budget-month": "De AI-limiet voor deze maand is bereikt.",
  "extract-not-configured": "AI-extractie is niet geconfigureerd op de server.",
  "chat-not-configured": "AI-assistent is niet geconfigureerd.",
  "categorize-not-configured": "AI-categorisatie is niet geconfigureerd.",
  "travel-not-configured": "AI-reisadvies is niet geconfigureerd.",
  "extract-rate-limited-local": "Even wachten — te veel AI-verzoeken.",
  "chat-rate-limited-local": "Even wachten — te veel verzoeken.",
  "categorize-rate-limited-local": "Even wachten — te veel verzoeken.",
  "travel-rate-limited-local": "Even wachten — te veel verzoeken.",
  "extract-invalid-input": "ongeldige invoer",
  "extract-pdf-too-large": "pdf te groot",
  "extract-text-too-large": "tekst te groot",
  "extract-no-document": "geen document",
  "categorize-invalid-input": "ongeldige invoer",
  "categorize-no-items": "geen items",
  "categorize-too-many-items": "te veel items",
  "categorize-text-too-long": "tekst te lang",
  "categorize-no-valid-items": "geen geldige items",
  "travel-invalid-input": "ongeldige invoer",
  "travel-invalid-destination": "geen geldige bestemming",
  "travel-too-many-providers": "te veel aanbieders",
  "travel-no-providers": "geen aanbieders",
  "travel-too-many-facts": "te veel bekende feiten",
  "chat-context-too-large": "context te groot",
  "chat-empty-message": "Geen bericht.",
  "bad-input": "Ongeldige aanvraag.",
  "n8n-not-configured": "De factuur-wachtrij is niet ingesteld op de server.",
  "n8n-queue-unauthenticated": "Log in om je facturen op te halen.",
  "n8n-misconfigured-url": "De n8n-URL op de server is ongeldig.",
  "n8n-unreachable": "Kon n8n niet bereiken.",
  "n8n-upstream-error": (status) => `n8n antwoordde met status ${status}.`,
  "n8n-unreadable": "Onleesbaar antwoord van n8n.",
  "n8n-forward-address-read-unauthenticated": "Log in om je doorstuuradres te zien.",
  "n8n-forward-address-write-unauthenticated": "Log in om een doorstuuradres in te stellen.",
  "n8n-address-invalid": "Dat is geen geldig lokaal deel van een e-mailadres.",
  "n8n-address-taken": "Dit adres is al bij een ander account in gebruik.",
};

/* `bad-input`'s nl entry is a deliberate new sentence, not copied from an
 * existing literal — the server uses this code only as a fallback for a raw
 * JSON-parse failure, which previously leaked as an untranslated technical
 * error in both languages, so there is no "original" Dutch string to keep. */
const en: ApiErrorCopyShape = {
  "ai-fault": "The AI service returned an error. Try again later.",
  "ai-upstream-limit":
    "The AI provider is refusing requests right now (the account limit has been reached). Check the Mistral account — retrying now will not help until that limit clears.",
  "ai-credentials-refused":
    "The AI provider is refusing this server's key (401/403). Check MISTRAL_API_KEY in the environment — retrying will not help until that's fixed.",
  "ai-unavailable": "The AI service is temporarily unavailable.",
  "ai-budget-day": "Today's AI limit has been reached.",
  "ai-budget-month": "This month's AI limit has been reached.",
  "extract-not-configured": "AI extraction is not configured on the server.",
  "chat-not-configured": "The AI assistant is not configured.",
  "categorize-not-configured": "AI categorisation is not configured.",
  "travel-not-configured": "AI travel advice is not configured.",
  "extract-rate-limited-local": "Hold on — too many AI requests.",
  "chat-rate-limited-local": "Hold on — too many requests.",
  "categorize-rate-limited-local": "Hold on — too many requests.",
  "travel-rate-limited-local": "Hold on — too many requests.",
  "extract-invalid-input": "invalid input",
  "extract-pdf-too-large": "pdf too large",
  "extract-text-too-large": "text too large",
  "extract-no-document": "no document",
  "categorize-invalid-input": "invalid input",
  "categorize-no-items": "no items",
  "categorize-too-many-items": "too many items",
  "categorize-text-too-long": "text too long",
  "categorize-no-valid-items": "no valid items",
  "travel-invalid-input": "invalid input",
  "travel-invalid-destination": "no valid destination",
  "travel-too-many-providers": "too many providers",
  "travel-no-providers": "no providers",
  "travel-too-many-facts": "too many known facts",
  "chat-context-too-large": "context too large",
  "chat-empty-message": "No message.",
  "bad-input": "Invalid request.",
  "n8n-not-configured": "The invoice queue is not set up on the server.",
  "n8n-queue-unauthenticated": "Sign in to fetch your invoices.",
  "n8n-misconfigured-url": "The n8n URL on the server is invalid.",
  "n8n-unreachable": "Could not reach n8n.",
  "n8n-upstream-error": (status) => `n8n responded with status ${status}.`,
  "n8n-unreadable": "Unreadable response from n8n.",
  "n8n-forward-address-read-unauthenticated": "Sign in to see your forwarding address.",
  "n8n-forward-address-write-unauthenticated": "Sign in to set a forwarding address.",
  "n8n-address-invalid": "That is not a valid local part of an email address.",
  "n8n-address-taken": "This address is already in use by another account.",
};

export const apiErrorCopy: Record<Locale, ApiErrorCopyShape> = { nl, en };

/** The sentence for a server error `code`, in `locale`. `status` feeds the one
 *  entry that embeds it (`n8n-upstream-error`); ignored by every other entry.
 *  `fallback` is the server's own `error` string (always Dutch, always
 *  present) — returned as-is when `code` is absent or not one this bundle
 *  recognises (an older or a newer server), so there is never a blank
 *  message, only ever Dutch-when-unrecognised-English-when-known. */
export function apiErrorText(
  locale: Locale,
  code: string | undefined,
  fallback: string,
  status = 0,
): string {
  if (!code) return fallback;
  const entry = apiErrorCopy[locale][code as ApiErrorCode];
  if (entry === undefined) return fallback;
  return typeof entry === "function" ? entry(status) : entry;
}
