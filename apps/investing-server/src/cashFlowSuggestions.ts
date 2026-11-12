/* Jev-04: suggestions for cash-flow vocabulary words the broker switch does not
 * know (issue #137).
 *
 * The adapters stay pure. This module is the ONE seam: it consumes the problems
 * adapters already emit ("Trading 212 transaction <ref> has unknown type
 * <TYPE>; provider sign was preserved"), asks Jev a Choice per DISTINCT type in
 * ONE request, and stores the answer as a suggestion. Nothing here changes a
 * kind, a sign or a figure: a suggestion only becomes effective when the owner
 * confirms it, and the confirmation creates a rule the sync applies through
 * `applyCashFlowKindRules` (packages/core).
 *
 * Failure is silent by design: the caller fires this off the sync path, and a
 * model that is down leaves exactly today's state — `other` plus its problem.
 */
import type { ChoiceQuestion, ChoiceResponse } from "@typesafe-ai/sdk";
import {
  SUGGESTIBLE_CASH_FLOW_KINDS,
  type CashFlowKind,
  type CashFlowRule,
  type CashFlowSuggestion,
  type CashFlowSuggestionContext,
} from "@lavega/core";
import type { SystemOneProvider } from "./systemOne.js";

/** One AI-usage route for this inference (`AiUsage["route"]`). */
export const CASH_FLOW_SUGGESTION_ROUTE = "cash-flow-suggestion";

/** One request covers many vocabulary words, but not an unbounded number: the
 *  128 kB state ceiling and the per-question output both grow with the batch. */
export const MAX_SUGGESTION_QUESTIONS = 24;

/** How the owner's choice maps back to a kind; `no-match` leaves the row as
 *  `other` with its problem, which is exactly today's behaviour. */
const NO_MATCH = "no-match";

/** Stored suggestion+rules state. Implementations: Neon (per tenant), a JSON
 *  file (Docker) and memory (tests). Replace-all writes match the other
 *  investing stores. */
export type CashFlowStore = {
  listSuggestions(): Promise<CashFlowSuggestion[]>;
  saveSuggestions(suggestions: readonly CashFlowSuggestion[]): Promise<void>;
  listRules(): Promise<CashFlowRule[]>;
  saveRules(rules: readonly CashFlowRule[]): Promise<void>;
  /** Explicit owner switch. Default false: the app behaves as it does today. */
  suggestionsEnabled(): Promise<boolean>;
  setSuggestionsEnabled(enabled: boolean): Promise<void>;
};

export function createMemoryCashFlowStore(): CashFlowStore {
  let suggestions: CashFlowSuggestion[] = [];
  let rules: CashFlowRule[] = [];
  let enabled = false;
  return {
    async listSuggestions() {
      return [...suggestions];
    },
    async saveSuggestions(next) {
      suggestions = [...next];
    },
    async listRules() {
      return [...rules];
    },
    async saveRules(next) {
      rules = [...next];
    },
    async suggestionsEnabled() {
      return enabled;
    },
    async setSuggestionsEnabled(value) {
      enabled = value;
    },
  };
}

export type SuggestionCandidate = {
  context: CashFlowSuggestionContext;
  /** Display sample from the first row of that type (not sent to the model). */
  sample: {
    amount: number | null;
    sign: 1 | -1;
    currency: string;
    description: string;
  };
};

/** The request for a batch: one question per distinct vocabulary word, state
 *  carrying broker + type + description + currency + sign (never magnitude). */
export function buildCashFlowSuggestionRequest(
  candidates: readonly SuggestionCandidate[],
): { state: unknown; questions: Record<string, ChoiceQuestion> } | null {
  const batch = candidates.slice(0, MAX_SUGGESTION_QUESTIONS);
  if (batch.length === 0) return null;
  const questions: Record<string, ChoiceQuestion> = {};
  batch.forEach((candidate, index) => {
    questions[`type_${index}`] = {
      type: "choice",
      instructions: {
        task: "Classify ONE broker cash-movement type string into a cash-flow kind.",
        context:
          "The app's brokers describe cash movements in their own vocabulary. A conservative switch did not recognise this type, so the row is currently 'other'. Choose the kind the broker's own words describe. Choose no-match when the words do not identify a kind; that keeps the row as other with its problem.",
        unknownType: candidate.context.rawType,
        broker: candidate.context.broker,
        description: candidate.context.description,
        currency: candidate.context.currency,
        sign: candidate.context.sign === 1 ? "money in (positive)" : "money out (negative)",
        note: "The amount is not provided and is not needed. Do not infer a sign change.",
      },
      criteria: {
        deposit: "Money the owner moved INTO the broker account.",
        withdrawal: "Money the owner moved OUT of the broker account.",
        interest: "Interest or similar income credited by the broker.",
        fee: "A cost the broker debited (fee, commission, tax withheld).",
        [NO_MATCH]: "None of these kinds fits this type; keep it as other.",
      },
    };
  });
  return {
    state: {
      broker: batch[0]!.context.broker,
      unknownTypes: batch.map((candidate, index) => ({
        question: `type_${index}`,
        type: candidate.context.rawType,
        description: candidate.context.description,
        currency: candidate.context.currency,
        sign: candidate.context.sign === 1 ? "in" : "out",
      })),
    },
    questions,
  };
}

/** Turns the answers into stored suggestions. A no-match answer is stored as a
 *  settled `no-match` suggestion so the same word is not asked again (a
 *  rejected suggestion behaves the same way). */
export function suggestionsFromAnswers(input: {
  candidates: readonly SuggestionCandidate[];
  answers: Record<string, unknown>;
  createdAt: string;
}): CashFlowSuggestion[] {
  const created: CashFlowSuggestion[] = [];
  input.candidates.slice(0, MAX_SUGGESTION_QUESTIONS).forEach((candidate, index) => {
    const answer = input.answers[`type_${index}`] as ChoiceResponse | undefined;
    if (!answer || answer.type !== "choice") return;
    const kind =
      answer.choice === NO_MATCH
        ? null
        : (SUGGESTIBLE_CASH_FLOW_KINDS.find((value) => value === answer.choice) ?? null);
    const confidence =
      typeof answer.confidence === "number" && Number.isFinite(answer.confidence)
        ? Math.min(1, Math.max(0, answer.confidence))
        : null;
    created.push({
      broker: candidate.context.broker,
      typeKey: candidate.context.typeKey,
      rawType: candidate.context.rawType,
      kind,
      confidence,
      state: kind === null ? "no-match" : "pending",
      amount: candidate.sample.amount,
      sign: candidate.sample.sign,
      currency: candidate.sample.currency,
      description: candidate.sample.description,
      createdAt: input.createdAt,
    });
  });
  return created;
}

export type CashFlowSuggestionService = {
  /** One provider request for the whole batch. Never throws. */
  request(candidates: readonly SuggestionCandidate[]): Promise<{ created: number }>;
};

export function createCashFlowSuggestionService(deps: {
  store: CashFlowStore;
  provider: () => SystemOneProvider | null;
  now?: () => string;
  reportProblem?: (message: string, error?: unknown) => void;
}): CashFlowSuggestionService {
  const now = deps.now ?? (() => new Date().toISOString());
  return {
    async request(candidates) {
      const request = buildCashFlowSuggestionRequest(candidates);
      if (!request) return { created: 0 };
      try {
        const provider = deps.provider();
        if (!provider) return { created: 0 };
        const result = await provider.judge({
          state: request.state as never,
          questions: request.questions as never,
        });
        const created = suggestionsFromAnswers({
          candidates,
          answers: result.answers,
          createdAt: now(),
        });
        if (created.length === 0) return { created: 0 };
        const existing = await deps.store.listSuggestions();
        const key = (s: CashFlowSuggestion) => `${s.broker}|${s.typeKey}`;
        const settled = new Set(existing.map(key));
        await deps.store.saveSuggestions([
          ...existing,
          ...created.filter((suggestion) => !settled.has(key(suggestion))),
        ]);
        return { created: created.length };
      } catch (error) {
        /* Off the sync path by contract: a model or store failure leaves the
         * problems unresolved, which is exactly today's behaviour. */
        deps.reportProblem?.("Cash-flow suggestion request failed", error);
        return { created: 0 };
      }
    },
  };
}

/** The kind values the confirmation route accepts (never `other` via a rule —
 *  `other` is what a no-match already leaves). */
export function isRuleKind(value: unknown): value is Exclude<CashFlowKind, "other"> {
  return typeof value === "string" && SUGGESTIBLE_CASH_FLOW_KINDS.some((kind) => kind === value);
}
