import { expect, test, vi } from "vitest";
import { createSystemOneSectorClassifier } from "./sectorClassifier.js";

function providerReturning(choice: string, confidence: number) {
  return {
    judge: vi.fn().mockResolvedValue({
      model: "jev-1.13.0",
      answers: { sector: { type: "choice", choice, confidence, probabilities: {} } },
      usage: { inputTokens: 1, outputTokens: 1 },
    }),
  };
}

function providerRejecting(error: unknown) {
  return { judge: vi.fn().mockRejectedValue(error) };
}

function providerAnswering(answers: Record<string, unknown>) {
  return {
    judge: vi.fn().mockResolvedValue({
      model: "jev-1.13.0",
      answers,
      usage: { inputTokens: 1, outputTokens: 1 },
    }),
  };
}

test("a confident answer reports the sector itself", async () => {
  const classifier = createSystemOneSectorClassifier(providerReturning("Technology", 0.9), 0.6);
  expect(await classifier({ symbol: "ACME", description: "Acme Cloud Software Inc" })).toEqual({
    kind: "classified",
    sector: "Technology",
    specificity: "sector",
    confidence: 0.9,
  });
});

test("an unconfident answer reports the broader division instead", async () => {
  const classifier = createSystemOneSectorClassifier(providerReturning("Technology", 0.3), 0.6);
  expect(await classifier({ symbol: "ACME" })).toEqual({
    kind: "classified",
    sector: "Sensitive",
    specificity: "division",
    confidence: 0.3,
  });
});

test("an explicit no-match resolves to the no-match result", async () => {
  const classifier = createSystemOneSectorClassifier(providerReturning("NoMatch", 0.95), 0.6);
  expect(await classifier({ symbol: "ACME" })).toEqual({ kind: "no-match" });
});

test("a high-confidence answer outside the GICS set is never trusted as a sector", async () => {
  const classifier = createSystemOneSectorClassifier(providerReturning("Private", 0.99), 0.6);
  expect(await classifier({ symbol: "ACME" })).toEqual({ kind: "no-match" });
});

test("a provider throw resolves to failed, not no-match", async () => {
  const classifier = createSystemOneSectorClassifier(providerRejecting(new Error("upstream timeout")), 0.6);
  expect(await classifier({ symbol: "ACME" })).toEqual({ kind: "failed", reason: "upstream timeout" });
});

test("a budget refusal resolves to failed, not no-match", async () => {
  const classifier = createSystemOneSectorClassifier(
    providerRejecting(new Error("System One budget exhausted for day")),
    0.6,
  );
  expect(await classifier({ symbol: "ACME" })).toEqual({
    kind: "failed",
    reason: "System One budget exhausted for day",
  });
});

test("a NaN confidence resolves to failed, not a cacheable classification", async () => {
  const classifier = createSystemOneSectorClassifier(providerReturning("Technology", NaN), 0.6);
  expect(await classifier({ symbol: "ACME" })).toEqual({
    kind: "failed",
    reason: "invalid confidence: NaN",
  });
});

test("a confidence above 1 resolves to failed, not a cacheable classification", async () => {
  const classifier = createSystemOneSectorClassifier(providerReturning("Technology", 1.5), 0.6);
  expect(await classifier({ symbol: "ACME" })).toEqual({
    kind: "failed",
    reason: "invalid confidence: 1.5",
  });
});

test("a missing sector answer resolves to failed", async () => {
  const classifier = createSystemOneSectorClassifier(providerAnswering({}), 0.6);
  expect(await classifier({ symbol: "ACME" })).toEqual({
    kind: "failed",
    reason: "System One did not return a choice answer for sector",
  });
});

test("a non-choice sector answer resolves to failed", async () => {
  const classifier = createSystemOneSectorClassifier(
    providerAnswering({ sector: { type: "score", score: 1, confidence: 0.9, legend: {}, probabilities: {} } }),
    0.6,
  );
  expect(await classifier({ symbol: "ACME" })).toEqual({
    kind: "failed",
    reason: "System One did not return a choice answer for sector",
  });
});

test("sends only symbol and description as state — never holdings, quantity, or value", async () => {
  const provider = providerReturning("Technology", 0.9);
  const classifier = createSystemOneSectorClassifier(provider, 0.6);
  await classifier({ symbol: "ACME", description: "Acme Cloud Software Inc" });
  const [request] = provider.judge.mock.calls[0]!;
  expect(JSON.stringify(request.state)).not.toMatch(/quantity|marketValue|holding/i);
});
