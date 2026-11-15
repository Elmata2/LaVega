import { expect, test } from "vitest";
import type { CashFlow, CashFlowKind } from "./model.js";
import {
  applyCashFlowKindRules,
  cashFlowSuggestionContexts,
  confirmCashFlowSuggestion,
  confirmedKindFor,
  normaliseCashFlowType,
  signWouldChange,
  signedAmountForKind,
  suggestionSample,
  suggestionSignChange,
  unknownCashFlowTypes,
  type CashFlowRule,
  type CashFlowSuggestion,
} from "./cashFlowRules.js";

const PROBLEM = (reference: string, type: string) =>
  `Trading 212 transaction ${reference} has unknown type ${type}; provider sign was preserved`;

const flow = (
  reference: string,
  kind: CashFlowKind,
  amount: number | null,
  over: Partial<CashFlow> = {},
): CashFlow => ({
  id: `cash-${reference}`,
  entity: "personal",
  broker: "trading212",
  date: "2026-11-01",
  currency: "EUR",
  amount,
  kind,
  description: "Trading 212 NEW_KIND",
  brokerFlowId: reference,
  ...over,
});

const rule = (over: Partial<CashFlowRule> = {}): CashFlowRule => ({
  broker: "trading212",
  typeKey: "NEW_KIND",
  kind: "deposit",
  confirmedAt: "2026-11-11T10:00:00.000Z",
  ...over,
});

const suggestion = (over: Partial<CashFlowSuggestion> = {}): CashFlowSuggestion => ({
  broker: "trading212",
  typeKey: "NEW_KIND",
  rawType: "NEW_KIND",
  kind: "deposit",
  confidence: 0.8,
  state: "pending",
  amount: 100,
  sign: 1,
  currency: "EUR",
  description: "Trading 212 NEW_KIND",
  createdAt: "2026-11-11T10:00:00.000Z",
  ...over,
});

test("NO EFFECT: without a confirmed rule adapter output is byte-for-byte identical", () => {
  const flows = [flow("r1", "other", 100), flow("r2", "deposit", 50)];
  const problems = [PROBLEM("r1", "NEW_KIND"), "a different problem"];
  const result = applyCashFlowKindRules({ broker: "trading212", flows, problems, rules: [] });
  expect(result).toEqual({ flows, problems });
  expect(JSON.stringify(result)).toBe(JSON.stringify({ flows, problems }));
});

test("the broker switch wins: a known kind is never touched by a rule", () => {
  const flows = [flow("r1", "deposit", 100)];
  const problems: string[] = [];
  const result = applyCashFlowKindRules({
    broker: "trading212",
    flows,
    problems,
    rules: [rule({ kind: "withdrawal" })],
  });
  expect(result.flows[0]!.kind).toBe("deposit");
  expect(result.flows[0]!.amount).toBe(100);
});

test("a confirmed rule replaces other and applies the switch's sign normalisation", () => {
  const flows = [flow("r1", "other", 100)];
  const problems = [PROBLEM("r1", "NEW_KIND"), "unrelated problem"];
  const result = applyCashFlowKindRules({
    broker: "trading212",
    flows,
    problems,
    rules: [rule({ kind: "fee" })],
  });
  expect(result.flows[0]).toMatchObject({ kind: "fee", amount: -100 });
  // The owner's confirmation resolves the unknown-type problem; other
  // problems are untouched.
  expect(result.problems).toEqual(["unrelated problem"]);
});

test("a rule is scoped to its broker: the same word at another broker is untouched", () => {
  const ibkrFlow = flow("r1", "other", 100, { broker: "ibkr", id: "cash-ibkr" });
  const result = applyCashFlowKindRules({
    broker: "ibkr",
    flows: [ibkrFlow],
    problems: [PROBLEM("r1", "NEW_KIND")],
    rules: [rule({ broker: "trading212" })],
  });
  expect(result.flows[0]!.kind).toBe("other");
  expect(result.problems).toEqual([PROBLEM("r1", "NEW_KIND")]);
});

test("rule lookup normalises case, spacing and the broker label", () => {
  expect(confirmedKindFor("Trading 212", "new_kind", [rule({ typeKey: "NEW_KIND" })])).toBe(
    "deposit",
  );
  expect(confirmedKindFor("trading212", "  new_kind ", [rule({ typeKey: " new_kind " })])).toBe(
    "deposit",
  );
  expect(normaliseCashFlowType(" buy/sell ")).toBe("BUY/SELL");
  expect(confirmedKindFor("ibkr", "NEW_KIND", [rule()])).toBeNull();
});

test("sign change is detected and never applied silently", () => {
  expect(signWouldChange(100, "withdrawal")).toBe(true);
  expect(signWouldChange(100, "fee")).toBe(true);
  expect(signWouldChange(100, "deposit")).toBe(false);
  expect(signWouldChange(-100, "withdrawal")).toBe(false);
  expect(signWouldChange(null, "withdrawal")).toBe(false);
  expect(signedAmountForKind(100, "withdrawal")).toBe(-100);
  expect(signedAmountForKind(-100, "withdrawal")).toBe(-100);
  expect(signedAmountForKind(null, "withdrawal")).toBeNull();
});

test("confirming a sign-changing suggestion requires the acknowledged before/after", () => {
  const refused = confirmCashFlowSuggestion({
    suggestions: [suggestion({ amount: 100 })],
    broker: "trading212",
    typeKey: "NEW_KIND",
    kind: "withdrawal",
    acknowledgeSignChange: false,
    confirmedAt: "2026-11-11T10:00:00.000Z",
  });
  expect(refused).toEqual({
    ok: false,
    reason: "sign-change-unacknowledged",
    before: 100,
    after: -100,
  });

  const accepted = confirmCashFlowSuggestion({
    suggestions: [suggestion({ amount: 100 })],
    broker: "trading212",
    typeKey: "NEW_KIND",
    kind: "withdrawal",
    acknowledgeSignChange: true,
    confirmedAt: "2026-11-11T10:00:00.000Z",
  });
  expect(accepted).toMatchObject({ ok: true, rule: { kind: "withdrawal" } });
});

test("batching: same unknown type yields one context, distinct types many, settled ones none", () => {
  const flows = [flow("r1", "other", 100), flow("r2", "other", 50), flow("r3", "other", -5)];
  const problems = [
    PROBLEM("r1", "NEW_KIND"),
    PROBLEM("r2", "NEW_KIND"),
    PROBLEM("r3", "OTHER_KIND"),
  ];
  const contexts = cashFlowSuggestionContexts({
    broker: "trading212",
    flows,
    problems,
    rules: [],
    suggestions: [],
  });
  expect(contexts).toHaveLength(2);
  expect(contexts.map((c) => c.typeKey)).toEqual(["NEW_KIND", "OTHER_KIND"]);
  // The prompt state carries the sign, not the magnitude.
  expect(contexts[1]!.sign).toBe(-1);
  expect(JSON.stringify(contexts)).not.toContain("100");
  expect(JSON.stringify(contexts)).not.toContain("-5");

  const settled = cashFlowSuggestionContexts({
    broker: "trading212",
    flows,
    problems,
    rules: [rule({ typeKey: "OTHER_KIND" })],
    suggestions: [suggestion({ typeKey: "NEW_KIND", state: "rejected" })],
  });
  expect(settled).toEqual([]);
});

test("a rejected or no-match suggestion is not offered again", () => {
  for (const state of ["rejected", "no-match", "pending"] as const) {
    const contexts = cashFlowSuggestionContexts({
      broker: "trading212",
      flows: [flow("r1", "other", 100)],
      problems: [PROBLEM("r1", "NEW_KIND")],
      rules: [],
      suggestions: [suggestion({ state })],
    });
    expect(contexts).toEqual([]);
  }
});

test("an ambiguous transfer never reaches the suggestion layer", () => {
  // The adapter emits no cash flow for an ambiguous TRANSFER and its problem
  // does not use the unknown-type sentence.
  const contexts = cashFlowSuggestionContexts({
    broker: "trading212",
    flows: [],
    problems: ["Trading 212 transaction t1 is an ambiguous TRANSFER; direction unknown"],
    rules: [],
    suggestions: [],
  });
  expect(contexts).toEqual([]);
});

test("unknown types are parsed from the adapter's problem, distinct and broker-scoped", () => {
  const types = unknownCashFlowTypes(
    [PROBLEM("r1", "NEW_KIND"), PROBLEM("r2", "NEW_KIND"), PROBLEM("r3", "X")],
    "trading212",
  );
  expect(types.map((t) => t.typeKey)).toEqual(["NEW_KIND", "X"]);
  expect(types[0]).toMatchObject({ broker: "trading212", rawType: "NEW_KIND", reference: "r1" });
  expect(unknownCashFlowTypes([PROBLEM("r1", "NEW_KIND")], "ibkr")).toEqual([]);
});

test("the stored suggestion keeps the observed amount and flags a sign change", () => {
  const sample = suggestionSample(
    "trading212",
    "NEW_KIND",
    [flow("r1", "other", 250)],
    [PROBLEM("r1", "NEW_KIND")],
  );
  expect(sample).toMatchObject({ amount: 250, sign: 1, currency: "EUR" });
  expect(suggestionSignChange(suggestion({ amount: 250, kind: "withdrawal" }))).toBe(true);
  expect(suggestionSignChange(suggestion({ amount: 250, kind: "deposit" }))).toBe(false);
  expect(suggestionSignChange(suggestion({ kind: null }))).toBe(false);
});
