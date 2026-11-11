/*
 * Ported from Sure (we-promise/sure) commit 562fe09 — AGPL-3.0 — independently
 * reimplemented for LaVega; changed 2026-11-11.
 *
 * The agent eval harness (plan §3 WS5.9, #300).
 *
 * Sure source: CI includes `llm-evals.yml` and an eval dataset concept at pinned
 * commit 562fe09 (research: docs/research/sure/02-platform-ai.md §1.7/CI). Sure
 * keeps fixtures in Rails tables; LaVega keeps them as files and runs them
 * offline, because the point is to catch a TOOL-CONTRACT regression on a model or
 * prompt change, not to call a model on every CI run.
 *
 * Two halves:
 *
 *   1. A FIXTURE is a conversation the scripted model plays: the tool calls it
 *      makes (name + arguments) and the values it expects back. The harness runs
 *      those calls through the REAL registry (`createInvestingTools`), so a
 *      renamed tool, a changed argument or a changed projection fails loudly.
 *   2. A CONTRACT SNAPSHOT pins every tool's name, scope, description and input
 *      schema digest. Changing a description or schema is a prompt/tool change
 *      and must be reviewed: the test fails until the snapshot is regenerated
 *      with `pnpm agent:evals --update-contract`.
 *
 * No network, no model, no clock: a fixture supplies the data source and the
 * harness plays the model. That also means it is deterministic in CI.
 */

import { createHash } from "node:crypto";
import { createInvestingTools, type InvestingToolSource } from "../tools/investingTools.js";
import type { AgentToolDefinition } from "@lavega/core";

/** The fixture breaks the tool contract. Distinct from a bad answer: this is
 *  the class of failure a model/prompt change must never cause silently. */
export class EvalContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvalContractError";
  }
}

/** The tools ran, but a value the fixture relies on is missing or wrong. */
export class EvalValueError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvalValueError";
  }
}

export type EvalStep = {
  /** The call the scripted model makes. */
  readonly name: string;
  readonly arguments: Record<string, unknown>;
  /** Values the REAL tool result must contain, recursively (objects subset,
   *  arrays deep-equal). */
  readonly resultContains: Record<string, unknown>;
};

export type EvalFixture = {
  readonly id: string;
  readonly description: string;
  /** The data the tools read on this surface; bound like the chat's source. */
  readonly source: InvestingToolSource;
  readonly steps: readonly EvalStep[];
  /** The scripted model's final answer, written from the tool results. */
  readonly answer: (results: readonly unknown[]) => string;
  /** Strings the final answer must contain. */
  readonly expectAnswer: readonly string[];
};

export type EvalRunResult = {
  readonly fixtureId: string;
  readonly steps: number;
  readonly answer: string;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Validate arguments against the tool's published JSON Schema. This is
 * deliberately a small, explicit subset (object/array/string/number/integer/
 * boolean/enum/required/properties/additionalProperties/min/max/pattern) — the
 * same subset the registry's schemas use — so a schema change that a fixture no
 * longer satisfies fails HERE, not as a confusing handler error.
 */
export function schemaProblem(schema: unknown, value: unknown, path = "arguments"): string | null {
  if (!isPlainObject(schema)) return null;
  const expected = schema.type;
  if (expected === "object") {
    if (!isPlainObject(value)) return `${path} must be an object`;
    const properties = isPlainObject(schema.properties) ? schema.properties : {};
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) if (!(key in value)) return `${path}.${key} is required`;
    if (schema.additionalProperties === false)
      for (const key of Object.keys(value))
        if (!(key in properties)) return `${path}.${key} is not a known argument`;
    for (const [key, child] of Object.entries(properties)) {
      if (!(key in value)) continue;
      const problem = schemaProblem(child, value[key], `${path}.${key}`);
      if (problem) return problem;
    }
    return null;
  }
  if (expected === "array") {
    if (!Array.isArray(value)) return `${path} must be an array`;
    if (!isPlainObject(schema.items)) return null;
    for (const [index, item] of value.entries()) {
      const problem = schemaProblem(schema.items, item, `${path}[${index}]`);
      if (problem) return problem;
    }
    return null;
  }
  if (expected === "string") {
    if (typeof value !== "string") return `${path} must be a string`;
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value))
      return `${path} does not match ${schema.pattern}`;
  } else if (expected === "number" || expected === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value)) return `${path} must be a number`;
    if (expected === "integer" && !Number.isInteger(value)) return `${path} must be an integer`;
    if (typeof schema.minimum === "number" && value < schema.minimum)
      return `${path} is below ${schema.minimum}`;
    if (typeof schema.maximum === "number" && value > schema.maximum)
      return `${path} is above ${schema.maximum}`;
  } else if (expected === "boolean") {
    if (typeof value !== "boolean") return `${path} must be a boolean`;
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value))
    return `${path} must be one of ${schema.enum.join(", ")}`;
  return null;
}

/** Recursive expectation check: objects may omit keys, arrays must match fully. */
export function resultContains(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    return expected.every((item, index) => resultContains(actual[index], item));
  }
  if (isPlainObject(expected)) {
    if (!isPlainObject(actual)) return false;
    return Object.entries(expected).every(([key, value]) => resultContains(actual[key], value));
  }
  return Object.is(actual, expected);
}

/**
 * Run one fixture through the real registry.
 *
 * `tools` is injectable ONLY so a test can prove that a mutated contract fails;
 * production runs leave it out and get the real registry bound to the fixture's
 * data source. Throws EvalContractError / EvalValueError.
 */
export async function runEvalFixture(
  fixture: EvalFixture,
  options: { tools?: readonly AgentToolDefinition[] } = {},
): Promise<EvalRunResult> {
  const tools = options.tools ?? createInvestingTools(fixture.source);
  const results: unknown[] = [];
  for (const [index, step] of fixture.steps.entries()) {
    const label = `${fixture.id} step ${index + 1} (${step.name})`;
    const tool = tools.find((candidate) => candidate.name === step.name);
    if (!tool)
      throw new EvalContractError(
        `${label}: the registry has no tool named "${step.name}". Defined: ${tools
          .map((candidate) => candidate.name)
          .join(", ")}.`,
      );
    const problem = schemaProblem(tool.schema, step.arguments);
    if (problem) throw new EvalContractError(`${label}: ${problem}`);
    let result: unknown;
    try {
      result = await tool.handler(step.arguments);
    } catch (error) {
      throw new EvalValueError(
        `${label}: the tool threw ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!resultContains(result, step.resultContains))
      throw new EvalValueError(
        `${label}: the result did not contain the expected values.\n expected: ${JSON.stringify(
          step.resultContains,
        )}\n actual:   ${JSON.stringify(result)}`,
      );
    results.push(result);
  }
  const answer = fixture.answer(results);
  for (const expected of fixture.expectAnswer)
    if (!answer.includes(expected))
      throw new EvalValueError(
        `${fixture.id}: the scripted answer is missing "${expected}".\n answer: ${answer}`,
      );
  return { fixtureId: fixture.id, steps: fixture.steps.length, answer };
}

export type ContractSnapshot = {
  readonly version: 1;
  readonly tools: ReadonlyArray<{
    readonly name: string;
    readonly scope: string;
    readonly preview: boolean;
    readonly descriptionHash: string;
    readonly schemaHash: string;
  }>;
};

const digest = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);

export function contractSnapshot(tools: readonly AgentToolDefinition[]): ContractSnapshot {
  return {
    version: 1,
    tools: [...tools]
      .map((tool) => ({
        name: tool.name,
        scope: tool.scope,
        preview: tool.preview === true,
        descriptionHash: digest(tool.description),
        schemaHash: digest(tool.schema),
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  };
}

/**
 * Human-readable drift lines between the live registry and a committed
 * snapshot. Used by the test and by `pnpm agent:evals`; empty means no drift.
 */
export function contractDrift(
  tools: readonly AgentToolDefinition[],
  snapshot: ContractSnapshot,
): string[] {
  const live = contractSnapshot(tools);
  const byName = new Map(live.tools.map((tool) => [tool.name, tool]));
  const drift: string[] = [];
  for (const pinned of snapshot.tools) {
    const current = byName.get(pinned.name);
    if (!current) {
      drift.push(`tool removed: ${pinned.name}`);
      continue;
    }
    if (current.scope !== pinned.scope)
      drift.push(`scope changed: ${pinned.name} ${pinned.scope} -> ${current.scope}`);
    if (current.preview !== pinned.preview)
      drift.push(`preview flag changed: ${pinned.name} ${pinned.preview} -> ${current.preview}`);
    if (current.descriptionHash !== pinned.descriptionHash)
      drift.push(`description changed: ${pinned.name}`);
    if (current.schemaHash !== pinned.schemaHash)
      drift.push(`input schema changed: ${pinned.name}`);
    byName.delete(pinned.name);
  }
  for (const added of byName.keys()) drift.push(`tool added: ${added}`);
  return drift;
}
