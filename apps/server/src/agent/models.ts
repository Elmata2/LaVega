/**
 * The Mistral model ids this app actually calls — the ONE place a raw
 * "mistral-…" string literal is allowed to live. Every call site and
 * pricing.ts's price table import from here rather than typing their own
 * copy, so a model rename is a one-line change instead of a hunt across
 * agent-routes.ts/categorize.ts/chat.ts/invoiceExtract.ts/travel.ts/mistral.ts
 * — and pricing.test.ts's model-coverage scan can catch a stray literal that
 * slips in anyway.
 */
export const MISTRAL_SMALL = "mistral-small-latest";
export const MISTRAL_MEDIUM = "mistral-medium-latest";
export const MISTRAL_OCR = "mistral-ocr-latest";
