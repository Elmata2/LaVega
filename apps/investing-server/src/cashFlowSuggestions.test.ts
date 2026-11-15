import { expect, test, vi } from "vitest";
import type { CashFlowSuggestionContext } from "@lavega/core";
import {
  MAX_SUGGESTION_QUESTIONS,
  buildCashFlowSuggestionRequest,
  createCashFlowSuggestionService,
  createMemoryCashFlowStore,
  isRuleKind,
  suggestionsFromAnswers,
  type SuggestionCandidate,
} from "./cashFlowSuggestions.js";
import type { SystemOneProvider } from "./systemOne.js";

const context = (over: Partial<CashFlowSuggestionContext> = {}): CashFlowSuggestionContext => ({
  broker: "trading212",
  typeKey: "NEW_KIND",
  rawType: "NEW_KIND",
  description: "Trading 212 NEW_KIND",
  currency: "EUR",
  sign: 1,
  ...over,
});

const candidate = (over: Partial<CashFlowSuggestionContext> = {}): SuggestionCandidate => ({
  context: context(over),
  sample: { amount: 250, sign: 1, currency: "EUR", description: "Trading 212 NEW_KIND" },
});

function provider(answers: Record<string, unknown>): {
  provider: SystemOneProvider;
  judge: ReturnType<typeof vi.fn>;
} {
  const judge = vi.fn(async () => ({
    model: "jev-test",
    answers,
    usage: { inputTokens: 100, outputTokens: 10 },
  }));
  return { provider: { judge } as unknown as SystemOneProvider, judge };
}

test("a batch of distinct types becomes ONE request with one question each", async () => {
  const { provider: fake, judge } = provider({
    type_0: { type: "choice", choice: "deposit", confidence: 0.9, probabilities: {} },
    type_1: { type: "choice", choice: "fee", confidence: 0.7, probabilities: {} },
  });
  const store = createMemoryCashFlowStore();
  const service = createCashFlowSuggestionService({ store, provider: () => fake });

  // The caller passes DISTINCT types (core's `cashFlowSuggestionContexts`
  // dedupes the problems); two rows of one type are one candidate here.
  const result = await service.request([
    candidate(),
    candidate({ typeKey: "OTHER_KIND", rawType: "OTHER_KIND" }),
  ]);

  expect(judge).toHaveBeenCalledTimes(1);
  const request = judge.mock.calls[0]![0] as {
    questions: Record<string, unknown>;
    state: { unknownTypes: Array<{ type: string }> };
  };
  expect(Object.keys(request.questions)).toEqual(["type_0", "type_1"]);
  expect(request.state.unknownTypes.map((t) => t.type)).toEqual(["NEW_KIND", "OTHER_KIND"]);
  // The prompt state never carries the magnitude.
  expect(JSON.stringify(request.state)).not.toContain("250");
  expect(result).toEqual({ created: 2 });

  const stored = await store.listSuggestions();
  expect(stored).toEqual([
    expect.objectContaining({
      typeKey: "NEW_KIND",
      kind: "deposit",
      confidence: 0.9,
      state: "pending",
    }),
    expect.objectContaining({
      typeKey: "OTHER_KIND",
      kind: "fee",
      confidence: 0.7,
      state: "pending",
    }),
  ]);
  expect(stored[0]).toMatchObject({ amount: 250, sign: 1, currency: "EUR" });
});

test("a no-match answer is stored settled and leaves the row as other", async () => {
  const { provider: fake } = provider({
    type_0: { type: "choice", choice: "no-match", confidence: 0.4, probabilities: {} },
  });
  const store = createMemoryCashFlowStore();
  const service = createCashFlowSuggestionService({ store, provider: () => fake });

  await service.request([candidate()]);

  expect(await store.listSuggestions()).toEqual([
    expect.objectContaining({ typeKey: "NEW_KIND", kind: null, state: "no-match" }),
  ]);
});

test("an unknown or malformed answer creates nothing and stores nothing", async () => {
  const { provider: fake } = provider({
    type_0: { type: "choice", choice: "not-a-kind", confidence: 0.4, probabilities: {} },
    type_1: { type: "score", score: 3, confidence: 0.5 },
  });
  const store = createMemoryCashFlowStore();
  const service = createCashFlowSuggestionService({ store, provider: () => fake });

  const result = await service.request([candidate(), candidate({ typeKey: "B", rawType: "B" })]);

  // The malformed choice still stores a settled no-match (never guessed); the
  // non-choice answer stores nothing.
  expect(result.created).toBe(1);
  const stored = await store.listSuggestions();
  expect(stored.map((s) => s.kind)).toEqual([null]);
  expect(stored[0]!.state).toBe("no-match");
});

test("a provider failure never throws and leaves the store untouched", async () => {
  const judge = vi.fn(async () => {
    throw new Error("model down");
  });
  const store = createMemoryCashFlowStore();
  const report = vi.fn();
  const service = createCashFlowSuggestionService({
    store,
    provider: () => ({ judge }),
    reportProblem: report,
  });

  await expect(service.request([candidate()])).resolves.toEqual({ created: 0 });
  expect(await store.listSuggestions()).toEqual([]);
  expect(report).toHaveBeenCalledOnce();
});

test("a type that already has a suggestion is not stored twice", async () => {
  const { provider: fake } = provider({
    type_0: { type: "choice", choice: "deposit", confidence: 0.9, probabilities: {} },
  });
  const store = createMemoryCashFlowStore();
  const service = createCashFlowSuggestionService({ store, provider: () => fake });

  await service.request([candidate()]);
  await service.request([candidate()]);

  expect(await store.listSuggestions()).toHaveLength(1);
});

test("no candidates means no request at all", async () => {
  const { provider: fake, judge } = provider({});
  const service = createCashFlowSuggestionService({
    store: createMemoryCashFlowStore(),
    provider: () => fake,
  });
  expect(await service.request([])).toEqual({ created: 0 });
  expect(judge).not.toHaveBeenCalled();
  expect(buildCashFlowSuggestionRequest([])).toBeNull();
});

test("a batch is capped so one request cannot exceed the state ceiling", () => {
  const many = Array.from({ length: MAX_SUGGESTION_QUESTIONS + 5 }, (_value, index) =>
    candidate({ typeKey: `T${index}`, rawType: `T${index}` }),
  );
  const request = buildCashFlowSuggestionRequest(many);
  expect(Object.keys(request!.questions)).toHaveLength(MAX_SUGGESTION_QUESTIONS);
});

test("only the four suggestible kinds are accepted as a rule kind", () => {
  expect(isRuleKind("deposit")).toBe(true);
  expect(isRuleKind("fee")).toBe(true);
  expect(isRuleKind("other")).toBe(false);
  expect(isRuleKind("no-match")).toBe(false);
  expect(isRuleKind(3)).toBe(false);
});

test("answers are matched to their own question, not by position of the batch", () => {
  const created = suggestionsFromAnswers({
    candidates: [candidate(), candidate({ typeKey: "B", rawType: "B" })],
    answers: {
      type_1: { type: "choice", choice: "interest", confidence: 0.6, probabilities: {} },
    },
    createdAt: "2026-11-11T10:00:00.000Z",
  });
  expect(created).toEqual([
    expect.objectContaining({ typeKey: "B", kind: "interest", confidence: 0.6 }),
  ]);
});
