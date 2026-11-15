import { expect, test, vi } from "vitest";
import type { IdentifierCandidate } from "@lavega/adapters";
import {
  createSystemOneIdentifierSelector,
  IDENTIFIER_SELECTION_CONFIDENCE_THRESHOLD,
  IDENTIFIER_SELECTION_WORST_CASE_CENTS,
} from "./identifierSelector.js";
import type { SystemOneProvider, SystemOneRequest, SystemOneResult } from "./systemOne.js";

/* Jev-03 (issue #136): the Choice selector. It picks among the provider's own
 * candidates or answers the explicit none option; the provider then copies the
 * chosen candidate verbatim. These tests assert what the caller observes — the
 * selection, the option set offered, and the failure mapping — never wording. */

const CANDIDATES: IdentifierCandidate[] = [
  {
    ticker: "VUAA",
    exchange: "LSE",
    name: "Vanguard S&P 500 UCITS ETF",
    currency: "USD",
  },
  {
    ticker: "VUAA",
    exchange: "XETRA",
    name: "Vanguard S&P 500 UCITS ETF",
    currency: "EUR",
  },
];

function provider(answer: (request: SystemOneRequest) => unknown): {
  provider: SystemOneProvider;
  requests: SystemOneRequest[];
} {
  const requests: SystemOneRequest[] = [];
  return {
    requests,
    provider: {
      async judge(request) {
        requests.push(request);
        const value = answer(request);
        if (value instanceof Error) throw value;
        return value as SystemOneResult;
      },
    },
  };
}

const choice = (selected: string, confidence = 0.8): SystemOneResult => ({
  model: "jev-1.13.0",
  answers: { listing: { type: "choice", choice: selected, confidence, probabilities: {} } },
  usage: { inputTokens: 120, outputTokens: 4 },
});

const instrument = { name: "Vanguard S&P 500", currency: "EUR", description: "ETF" };

test("offers every candidate plus the explicit none option, and returns the chosen candidate", async () => {
  const fake = provider((request) => {
    // The option keys are the criteria; the answer names one of them.
    const options = Object.keys(
      (request.questions.listing as { criteria: Record<string, string> }).criteria,
    );
    expect(options).toHaveLength(3);
    const chosen = options.find((option) => option.includes("xetra"))!;
    return choice(chosen, 0.82);
  });
  const selector = createSystemOneIdentifierSelector(fake.provider);

  const selection = await selector({ isin: "IE00BFMXXD54", instrument, candidates: CANDIDATES });

  expect(selection).toEqual({
    kind: "selected",
    ticker: "VUAA",
    exchange: "XETRA",
    confidence: 0.82,
  });
  expect(fake.requests).toHaveLength(1);
  // State carries identity only: the ISIN and the broker's instrument context,
  // never a quantity, value or account.
  const state = fake.requests[0]!.state as Record<string, unknown>;
  expect(Object.keys(state).sort()).toEqual(["candidates", "holding"]);
  expect(state.holding).toEqual({
    isin: "IE00BFMXXD54",
    name: "Vanguard S&P 500",
    currency: "EUR",
    description: "ETF",
  });
  expect(JSON.stringify(state)).not.toMatch(/quantity|marketValue|account/i);
});

test("the none option maps to an explicit no-match, not to a forced pick", async () => {
  const fake = provider((request) => {
    const options = Object.keys(
      (request.questions.listing as { criteria: Record<string, string> }).criteria,
    );
    return choice(
      options.find((option) => option === "none_of_these_candidates")!,
      0.7,
    );
  });
  const selector = createSystemOneIdentifierSelector(fake.provider);

  await expect(selector({ isin: "IE00BFMXXD54", candidates: CANDIDATES })).resolves.toEqual({
    kind: "no-match",
    confidence: 0.7,
  });
});

test("an answer outside the offered option set is a failure, never a mapped ticker", async () => {
  const fake = provider(() => choice("some_other_listing", 0.99));
  const selector = createSystemOneIdentifierSelector(fake.provider);

  const selection = await selector({ isin: "IE00BFMXXD54", candidates: CANDIDATES });

  expect(selection.kind).toBe("failed");
});

test("a provider failure is a failed selection, not a no-match", async () => {
  const fake = provider(() => new Error("rate limited"));
  const selector = createSystemOneIdentifierSelector(fake.provider);

  const selection = await selector({ isin: "IE00BFMXXD54", candidates: CANDIDATES });

  expect(selection).toMatchObject({ kind: "failed", reason: "rate limited" });
});

test("an invalid confidence is refused rather than stored", async () => {
  const fake = provider(() => ({
    model: "jev-1.13.0",
    answers: {
      listing: {
        type: "choice",
        choice: "none_of_these_candidates",
        confidence: 1.4,
        probabilities: {},
      },
    },
    usage: { inputTokens: 1, outputTokens: 1 },
  }));
  const selector = createSystemOneIdentifierSelector(fake.provider);

  expect(await selector({ isin: "IE00BFMXXD54", candidates: CANDIDATES })).toMatchObject({
    kind: "failed",
  });
});

test("the placeholder threshold and the route's ceiling are declared for the owner to tune", () => {
  // Placeholders, measured later on the owner's own data (issue #136).
  expect(IDENTIFIER_SELECTION_CONFIDENCE_THRESHOLD).toBe(0.6);
  expect(IDENTIFIER_SELECTION_WORST_CASE_CENTS).toBe(2);
});

test("a single-candidate set still offers the candidate and the none option", async () => {
  const judge = vi.fn(async (request: SystemOneRequest) => {
    const options = Object.keys(
      (request.questions.listing as { criteria: Record<string, string> }).criteria,
    );
    expect(options).toHaveLength(2);
    return choice(options.find((option) => option.includes("vuaa"))!);
  });
  const selector = createSystemOneIdentifierSelector({ judge });
  const single = await selector({ isin: "IE00BFMXXD54", candidates: [CANDIDATES[0]!] });
  // The PROVIDER bypasses the selector entirely for one candidate (covered in
  // the provider test); when called, the selector still offers a real choice.
  expect(single).toMatchObject({ kind: "selected", ticker: "VUAA" });
  expect(judge).toHaveBeenCalledTimes(1);
});
