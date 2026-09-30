import { expect, test } from "vitest";
import { renderMemoryBrief } from "./chatMemory.js";

const thesis = (symbol: string, status: "active" | "dormant") => ({
  symbol,
  status,
  why: "Ecosystem",
  worth: "$250",
  entry: null,
  wrongIf: null,
  updatedAt: "2026-01-01T00:00:00.000Z",
});

test("a rebought holding's old thesis is shown as from the previous holding, not as current", () => {
  const brief = renderMemoryBrief(
    { riskTolerance: "balanced", goals: [], theses: [thesis("AAPL", "dormant")] },
    [],
  );
  expect(brief).toContain(
    "From their previous holding of AAPL, which they hold again: why they own it: Ecosystem; what they think it is worth: $250.",
  );
  expect(brief).toContain("ask whether it is still true");
  expect(brief).not.toContain("Thesis for AAPL");
  expect(brief).toContain("Risk tolerance: Balanced.");
});

test("a named holding with a dormant thesis is not also asked about as if it had none", () => {
  const brief = renderMemoryBrief(
    { riskTolerance: null, goals: [], theses: [thesis("AAPL", "dormant")] },
    ["AAPL", "KO"],
  );
  expect(brief).not.toContain("They hold AAPL and have no thesis");
  expect(brief).toContain("They hold KO and have no thesis");
});
