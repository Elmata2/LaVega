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

/** The model behind the Assistent chat. The one place to change it; `pricing.ts` prices both
 *  models and `WORST_CASE_CENTS["assistant-chat"]` in budget.ts must cover the one chosen here.
 *  Chosen by the evaluation in docs/research/2026-11-18-assistant-chat-eval.md. */
export const ASSISTANT_MODEL = MISTRAL_SMALL;
