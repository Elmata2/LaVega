/**
 * AI-spend pricing: pure math, no DB, no side effects. Every price is USD per
 * Mistral's La Plateforme pricing page (checked 2026-09-08); this file
 * converts to EUR cents so `ai_usage.cost_cents` and the budget caps share one
 * unit.
 */
import { MISTRAL_SMALL, MISTRAL_MEDIUM } from "./models.js";

type ModelPrice = { inputPerMillion: number; outputPerMillion: number };

const MODEL_PRICES: Record<string, ModelPrice> = {
  [MISTRAL_SMALL]: { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  [MISTRAL_MEDIUM]: { inputPerMillion: 1.5, outputPerMillion: 7.5 },
};

/** Every token-priced model, for pricing.test.ts's coverage scan. */
export const PRICED_TOKEN_MODELS: ReadonlySet<string> = new Set(Object.keys(MODEL_PRICES));

const OCR_USD_PER_1000_PAGES = 4;

// ASSUMPTION: Mistral does not publish a per-search price for its hosted
// web_search tool as of writing. $10/1000 searches is a placeholder pending a
// published number — the cap this feeds still bounds worst-case spend either way.
const SEARCH_USD_PER_1000 = 10;

// Fixed, not live: the budget cap only needs to be roughly right, not track
// the market rate. Revisit if it drifts far enough to matter.
const USD_TO_EUR_RATE = 0.92;

/** USD cents for `model`'s token usage. Throws for an unrecognized model
 *  rather than silently pricing it at 0 — a model renamed at a call site
 *  without updating MODEL_PRICES must not go invisibly free from the budget's
 *  perspective. The caller (budget.ts's `recordUsage`) catches this and logs
 *  loudly instead of failing the request that already succeeded; the real
 *  defence is pricing.test.ts's scan asserting every model string used in
 *  agent/*.ts is one of the constants in models.ts and is priced here. */
export function priceTokensCents(model: string, inputTokens: number, outputTokens: number): number {
  const price = MODEL_PRICES[model];
  if (!price) throw new Error(`agent/pricing: no price configured for model "${model}"`);
  const usd =
    (inputTokens / 1_000_000) * price.inputPerMillion +
    (outputTokens / 1_000_000) * price.outputPerMillion;
  return usd * 100;
}

/** USD cents for OCR pages, independent of which OCR model ran. */
export function priceOcrCents(pages: number): number {
  return (pages / 1000) * OCR_USD_PER_1000_PAGES * 100;
}

/** USD cents for hosted web searches (one per successful chatWithSearch call). */
export function priceSearchCents(searches: number): number {
  return (searches / 1000) * SEARCH_USD_PER_1000 * 100;
}

export function totalCostCents(input: {
  model: string;
  inputTokens: number;
  outputTokens: number;
  pages: number;
  searches: number;
}): number {
  const usdCents =
    priceTokensCents(input.model, input.inputTokens, input.outputTokens) +
    priceOcrCents(input.pages) +
    priceSearchCents(input.searches);
  return Math.round(usdCents * USD_TO_EUR_RATE);
}
