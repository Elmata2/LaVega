import { expect, test } from "vitest";
import {
  priceOcrCents,
  priceSearchCents,
  priceTokensCents,
  totalCostCents,
  PRICED_TOKEN_MODELS,
} from "./pricing.js";
import { MISTRAL_SMALL, MISTRAL_MEDIUM, MISTRAL_OCR } from "./models.js";

test("priceTokensCents: mistral-small-latest at a known token count", () => {
  // 1M input @ $0.15 + 1M output @ $0.60 = $0.75 = 75 USD cents.
  expect(priceTokensCents(MISTRAL_SMALL, 1_000_000, 1_000_000)).toBeCloseTo(75, 6);
});

test("priceTokensCents: mistral-medium-latest at a known token count", () => {
  // 1M input @ $1.50 + 1M output @ $7.50 = $9.00 = 900 USD cents.
  expect(priceTokensCents(MISTRAL_MEDIUM, 1_000_000, 1_000_000)).toBeCloseTo(900, 6);
});

test("priceTokensCents: an unknown model throws by name, rather than silently pricing at 0", () => {
  expect(() => priceTokensCents("gpt-unknown", 1_000_000, 1_000_000)).toThrow('"gpt-unknown"');
});

test("totalCostCents: an unknown model throws too — it delegates token pricing to priceTokensCents", () => {
  expect(() =>
    totalCostCents({
      model: "gpt-unknown",
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      pages: 1000,
      searches: 0,
    }),
  ).toThrow('"gpt-unknown"');
});

test("every model constant in models.ts is either a priced token model or the OCR model (priced per-page, not per-token)", () => {
  expect([...PRICED_TOKEN_MODELS, MISTRAL_OCR].sort()).toEqual(
    [MISTRAL_SMALL, MISTRAL_MEDIUM, MISTRAL_OCR].sort(),
  );
});

test("priceOcrCents: per-page math at $4/1000 pages", () => {
  expect(priceOcrCents(1000)).toBeCloseTo(400, 6); // 1000 pages -> 400 USD cents
  expect(priceOcrCents(1)).toBeCloseTo(0.4, 6);
});

test("priceSearchCents: per-search math at $30/1000 searches", () => {
  expect(priceSearchCents(1000)).toBeCloseTo(3000, 6); // 1000 searches -> 3000 USD cents
  expect(priceSearchCents(1)).toBeCloseTo(3, 6);
});

test("totalCostCents: no usage at all costs nothing", () => {
  expect(
    totalCostCents({
      model: MISTRAL_SMALL,
      inputTokens: 0,
      outputTokens: 0,
      pages: 0,
      searches: 0,
    }),
  ).toBe(0);
});

/* Prompt-cache pricing (#300, WS5.7 leftover). The multiplier choice is
 * deliberately pessimistic; these tests pin the arithmetic so a later,
 * better-informed change is visible. */
test("cache-write tokens add a 25% input-rate premium, cache-read tokens add a full input charge", () => {
  // mistral-medium input is $1.50 per 1M, i.e. 150 USD cents per 1M tokens.
  expect(priceTokensCents(MISTRAL_MEDIUM, 0, 0, { cacheWriteTokens: 1_000_000 })).toBeCloseTo(
    37.5,
    6,
  );
  expect(priceTokensCents(MISTRAL_MEDIUM, 0, 0, { cacheReadTokens: 1_000_000 })).toBeCloseTo(
    150,
    6,
  );
  expect(
    priceTokensCents(MISTRAL_MEDIUM, 0, 0, {
      cacheWriteTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
    }),
  ).toBeCloseTo(187.5, 6);
});

test("cache params are optional and an absent/zero count does not change the price", () => {
  expect(priceTokensCents(MISTRAL_SMALL, 1_000_000, 1_000_000, {})).toBeCloseTo(75, 6);
  expect(
    priceTokensCents(MISTRAL_SMALL, 1_000_000, 1_000_000, {
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
    }),
  ).toBeCloseTo(75, 6);
});

test("totalCostCents carries cache tokens through, in EUR cents like every other cost", () => {
  const withCache = totalCostCents({
    model: MISTRAL_MEDIUM,
    inputTokens: 0,
    outputTokens: 0,
    pages: 0,
    searches: 0,
    cacheReadTokens: 1_000_000,
  });
  // 150 USD cents * 0.92 EUR rate = 138 EUR cents.
  expect(withCache).toBe(138);
});
