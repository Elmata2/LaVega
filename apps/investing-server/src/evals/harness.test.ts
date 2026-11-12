import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { createInvestingTools } from "../tools/investingTools.js";
import { EVAL_FIXTURES, evalRegistry } from "./fixtures.js";
import {
  contractDrift,
  contractSnapshot,
  EvalContractError,
  EvalValueError,
  resultContains,
  runEvalFixture,
  schemaProblem,
  type ContractSnapshot,
} from "./harness.js";

/*
 * WS5.9 acceptance (#300): fixtures pass for model and prompt changes, and the
 * harness fails LOUDLY when the tool contract changes. The second half is tested
 * by deliberately mutating a tool (rename, schema, description) and asserting the
 * exact failure the harness produces.
 */

const contractPath = join(dirname(fileURLToPath(import.meta.url)), "contract.json");

const committedContract = (): ContractSnapshot =>
  JSON.parse(readFileSync(contractPath, "utf8")) as ContractSnapshot;

test("every fixture passes against the real registry", async () => {
  const results = [];
  for (const fixture of EVAL_FIXTURES) results.push(await runEvalFixture(fixture));
  expect(results.map((result) => result.fixtureId)).toEqual(EVAL_FIXTURES.map((f) => f.id));
  expect(results.every((result) => result.steps > 0 && result.answer.length > 0)).toBe(true);
});

test("the committed contract snapshot matches the live registry — a tool or prompt change must be reviewed", () => {
  expect(contractDrift(evalRegistry(), committedContract())).toEqual([]);
});

test("a renamed tool fails the fixture with an explicit contract error", async () => {
  const fixture = EVAL_FIXTURES[0]!;
  const renamed = createInvestingTools(fixture.source).map((tool) =>
    tool.name === "get_positions" ? { ...tool, name: "get_holdings" } : tool,
  );
  await expect(runEvalFixture(fixture, { tools: renamed })).rejects.toThrow(
    /the registry has no tool named "get_positions"/,
  );
});

test("an argument renamed by a schema change fails the fixture as a contract error", async () => {
  const fixture = EVAL_FIXTURES[1]!;
  const renamed = createInvestingTools(fixture.source).map((tool) =>
    tool.name === "get_trades"
      ? {
          ...tool,
          schema: {
            type: "object" as const,
            properties: { ticker: { type: "string" } },
            additionalProperties: false,
          },
        }
      : tool,
  );
  await expect(runEvalFixture(fixture, { tools: renamed })).rejects.toBeInstanceOf(
    EvalContractError,
  );
});

test("the contract snapshot reports a renamed, rescoped or retuned tool by name", () => {
  const snapshot = contractSnapshot(evalRegistry());
  const mutated = createInvestingTools(EVAL_FIXTURES[0]!.source).map((tool) =>
    tool.name === "get_positions"
      ? { ...tool, name: "get_holdings" }
      : tool.name === "get_trades"
        ? { ...tool, scope: "write" as const }
        : tool.name === "get_price"
          ? { ...tool, description: `${tool.description} (changed prompt)` }
          : tool.name === "get_risk"
            ? { ...tool, schema: { ...tool.schema, required: ["range"] } }
            : tool,
  );
  const drift = contractDrift(mutated, snapshot);
  expect(drift).toContain("tool removed: get_positions");
  expect(drift).toContain("tool added: get_holdings");
  expect(drift).toContain("scope changed: get_trades read -> write");
  expect(drift).toContain("description changed: get_price");
  expect(drift).toContain("input schema changed: get_risk");
});

test("a fixture whose arguments no longer match the schema fails as a contract error", async () => {
  const fixture = EVAL_FIXTURES[1]!;
  const broken = {
    ...fixture,
    steps: [{ ...fixture.steps[0]!, arguments: { ticker: "AAPL" } }],
  };
  await expect(runEvalFixture(broken)).rejects.toBeInstanceOf(EvalContractError);
});

test("a changed projection fails the fixture as a value error with expected-vs-actual", async () => {
  const fixture = EVAL_FIXTURES[0]!;
  const brokenSource = {
    ...fixture.source,
    dashboard: async () => {
      const dashboard = await fixture.source.dashboard();
      // Simulate a projection regression: the symbol disappears from the payload.
      dashboard.positions = [];
      return dashboard;
    },
  };
  await expect(runEvalFixture({ ...fixture, source: brokenSource })).rejects.toBeInstanceOf(
    EvalValueError,
  );
});

test("schemaProblem covers the subset of JSON Schema the registry publishes", () => {
  expect(schemaProblem({ type: "object", required: ["a"] }, {})).toContain("a is required");
  expect(
    schemaProblem(
      { type: "object", properties: { a: { type: "string" } }, additionalProperties: false },
      { b: 1 },
    ),
  ).toContain("not a known argument");
  expect(schemaProblem({ type: "integer" }, 1.5)).toContain("integer");
  expect(schemaProblem({ type: "string", enum: ["6M", "1Y"] }, "3Y")).toContain("must be one of");
  expect(schemaProblem({ type: "object", properties: {} }, {})).toBeNull();
});

test("resultContains is a recursive subset match for objects and exact for arrays", () => {
  expect(resultContains({ a: 1, b: { c: 2, d: 3 } }, { a: 1, b: { c: 2 } })).toBe(true);
  expect(resultContains({ a: 1 }, { a: 2 })).toBe(false);
  expect(resultContains([{ a: 1 }], [{ a: 1 }])).toBe(true);
  expect(resultContains([{ a: 1 }], [{ a: 1 }, { a: 2 }])).toBe(false);
});
