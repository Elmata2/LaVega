import {
  TypeSafeClient,
  type ChoiceQuestion,
  type ChoiceResponse,
  type EntryType,
  type NoulQuestion,
  type NoulResponse,
  type ScoreQuestion,
  type ScoreResponse,
} from "@typesafe-ai/sdk";
import { checkSystemOneBudget, recordSystemOneUsage } from "./systemOneUsage.js";

export const DEFAULT_SYSTEM_ONE_MODEL = "jev-1.13.0";
export const MAX_SYSTEM_ONE_STATE_BYTES = 128_000;
const FAILED_REQUEST_INPUT_TOKENS = 32_000;

export type SystemOneQuestion = ChoiceQuestion | ScoreQuestion | NoulQuestion;
export type SystemOneAnswer = ChoiceResponse | ScoreResponse | NoulResponse;
export type SystemOneRequest = {
  state: EntryType;
  questions: Record<string, SystemOneQuestion>;
  model?: string;
};
export type SystemOneResult = {
  model: string;
  answers: Record<string, SystemOneAnswer>;
  usage: { inputTokens: number; outputTokens: number };
};
export type SystemOneProvider = { judge(request: SystemOneRequest): Promise<SystemOneResult> };
export type SystemOneConfig = { apiKey: string; model: string };

export function resolveSystemOneConfig(): SystemOneConfig {
  const apiKey = process.env.TYPESAFE_API_KEY?.trim();
  if (!apiKey) throw new Error("TYPESAFE_API_KEY is not set; configure TypeSafe System One");
  return { apiKey, model: process.env.TYPESAFE_MODEL?.trim() || DEFAULT_SYSTEM_ONE_MODEL };
}

type SystemOneClient = Pick<TypeSafeClient, "systemOne">;

export function createSystemOneProvider(
  deps: {
    client?: SystemOneClient;
    config?: SystemOneConfig;
    checkBudget?: () => Promise<{ ok: true } | { ok: false; scope: "day" | "month" }>;
    recordUsage?: (model: string, inputTokens: number, outputTokens: number) => Promise<void>;
  } = {},
): SystemOneProvider {
  const config = deps.config ?? resolveSystemOneConfig();
  const client =
    deps.client ?? new TypeSafeClient({ apiKey: config.apiKey, defaultModel: config.model });
  return {
    async judge(request) {
      assertStateSize(request.state);
      const budget = await (deps.checkBudget ?? checkSystemOneBudget)();
      if (!budget.ok) throw new Error(`System One budget exhausted for ${budget.scope}`);
      let result;
      try {
        result = await client.systemOne({
          state: request.state,
          questions: request.questions,
          model: request.model ?? config.model,
        });
      } catch (error) {
        await (deps.recordUsage ?? recordSystemOneUsage)(
          request.model ?? config.model,
          FAILED_REQUEST_INPUT_TOKENS,
          0,
        );
        throw error;
      }
      await (deps.recordUsage ?? recordSystemOneUsage)(
        result.model,
        result.usage.input_tokens,
        result.usage.output_tokens,
      );
      return {
        model: result.model,
        answers: result.answers,
        usage: { inputTokens: result.usage.input_tokens, outputTokens: result.usage.output_tokens },
      };
    },
  };
}

function assertStateSize(state: SystemOneRequest["state"]): void {
  const bytes = new TextEncoder().encode(
    typeof state === "string" ? state : JSON.stringify(state),
  ).length;
  if (bytes > MAX_SYSTEM_ONE_STATE_BYTES)
    throw new Error(`System One state exceeds ${MAX_SYSTEM_ONE_STATE_BYTES} byte limit`);
}
