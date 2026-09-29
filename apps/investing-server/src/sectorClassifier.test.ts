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

test("a confident answer reports the sector itself", async () => {
  const classifier = createSystemOneSectorClassifier(providerReturning("Technology", 0.9), 0.6);
  expect(await classifier({ symbol: "ACME", description: "Acme Cloud Software Inc" })).toEqual({
    sector: "Technology",
    confidence: 0.9,
  });
});

test("an unconfident answer reports the broader division instead", async () => {
  const classifier = createSystemOneSectorClassifier(providerReturning("Technology", 0.3), 0.6);
  expect(await classifier({ symbol: "ACME" })).toEqual({ sector: "Sensitive", confidence: 0.3 });
});

test("an explicit no-match resolves to null, mapped to Unknown by the caller", async () => {
  const classifier = createSystemOneSectorClassifier(providerReturning("NoMatch", 0.95), 0.6);
  expect(await classifier({ symbol: "ACME" })).toBeNull();
});

test("sends only symbol and description as state — never holdings, quantity, or value", async () => {
  const provider = providerReturning("Technology", 0.9);
  const classifier = createSystemOneSectorClassifier(provider, 0.6);
  await classifier({ symbol: "ACME", description: "Acme Cloud Software Inc" });
  const [request] = provider.judge.mock.calls[0]!;
  expect(JSON.stringify(request.state)).not.toMatch(/quantity|marketValue|holding/i);
});
