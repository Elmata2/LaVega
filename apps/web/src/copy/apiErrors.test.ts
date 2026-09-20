import { expect, test } from "vitest";
import { apiErrorText } from "./apiErrors.js";

/* The AI taxonomy is the part of this table most likely to be misread by a
 * reader who has just been rate-limited or budget-capped — a distinct English
 * sentence per code, and the Dutch side unchanged from what the server has
 * always sent, are both load-bearing. */

test("each AI code renders a distinct English sentence", () => {
  const codes = ["ai-fault", "ai-upstream-limit", "ai-credentials-refused", "ai-budget-day", "ai-budget-month"] as const;
  const sentences = codes.map((code) => apiErrorText("en", code, "should not be seen"));
  expect(new Set(sentences).size).toBe(codes.length);
});

test("ai-fault: English is a distinct sentence, Dutch reproduces the server literal", () => {
  expect(apiErrorText("en", "ai-fault", "should not be seen")).toBe(
    "The AI service returned an error. Try again later.",
  );
  expect(apiErrorText("nl", "ai-fault", "should not be seen")).toBe(
    "De AI-dienst gaf een fout; probeer het later opnieuw.",
  );
});

test("ai-upstream-limit: English is a distinct sentence, Dutch reproduces the server literal", () => {
  expect(apiErrorText("en", "ai-upstream-limit", "should not be seen")).toBe(
    "The AI provider is refusing requests right now (the account limit has been reached). Check the Mistral account — retrying now will not help until that limit clears.",
  );
  expect(apiErrorText("nl", "ai-upstream-limit", "should not be seen")).toBe(
    "De AI-aanbieder weigert nu verzoeken (limiet van het account bereikt). Controleer je Mistral-account; opnieuw proberen helpt pas daarna.",
  );
});

test("ai-credentials-refused: English is a distinct sentence, Dutch reproduces the server literal", () => {
  expect(apiErrorText("en", "ai-credentials-refused", "should not be seen")).toBe(
    "The AI provider is refusing this server's key (401/403). Check MISTRAL_API_KEY in the environment — retrying will not help until that's fixed.",
  );
  expect(apiErrorText("nl", "ai-credentials-refused", "should not be seen")).toBe(
    "De AI-aanbieder weigert de sleutel van deze server (401/403). Controleer MISTRAL_API_KEY in de omgeving; opnieuw proberen helpt niet.",
  );
});

test("ai-budget-day: English is a distinct sentence, Dutch reproduces the server literal", () => {
  expect(apiErrorText("en", "ai-budget-day", "should not be seen")).toBe(
    "Today's AI limit has been reached.",
  );
  expect(apiErrorText("nl", "ai-budget-day", "should not be seen")).toBe(
    "De AI-limiet voor vandaag is bereikt.",
  );
});

test("ai-budget-month: English is a distinct sentence, Dutch reproduces the server literal", () => {
  expect(apiErrorText("en", "ai-budget-month", "should not be seen")).toBe(
    "This month's AI limit has been reached.",
  );
  expect(apiErrorText("nl", "ai-budget-month", "should not be seen")).toBe(
    "De AI-limiet voor deze maand is bereikt.",
  );
});

test("the one code embedding a status renders it in both languages", () => {
  expect(apiErrorText("nl", "n8n-upstream-error", "should not be seen", 503)).toBe(
    "n8n antwoordde met status 503.",
  );
  expect(apiErrorText("en", "n8n-upstream-error", "should not be seen", 503)).toBe(
    "n8n responded with status 503.",
  );
});

test("an unrecognized code returns the fallback unchanged", () => {
  expect(apiErrorText("en", "some-future-code", "the server's own sentence")).toBe(
    "the server's own sentence",
  );
  expect(apiErrorText("nl", "some-future-code", "de eigen zin van de server")).toBe(
    "de eigen zin van de server",
  );
});

test("no code at all returns the fallback unchanged", () => {
  expect(apiErrorText("en", undefined, "the server's own sentence")).toBe(
    "the server's own sentence",
  );
});
