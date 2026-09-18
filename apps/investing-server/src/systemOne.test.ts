import { afterEach, expect, test, vi } from "vitest";
import {
  createSystemOneProvider,
  DEFAULT_SYSTEM_ONE_MODEL,
  MAX_SYSTEM_ONE_STATE_BYTES,
  resolveSystemOneConfig,
} from "./systemOne.js";

afterEach(() => vi.unstubAllEnvs());

test("System One requires an explicit server key and pins its model", () => {
  vi.stubEnv("TYPESAFE_API_KEY", "");
  expect(() => resolveSystemOneConfig()).toThrow("TYPESAFE_API_KEY");
  vi.stubEnv("TYPESAFE_API_KEY", "test-key");
  vi.stubEnv("TYPESAFE_MODEL", "");
  expect(resolveSystemOneConfig()).toEqual({ apiKey: "test-key", model: DEFAULT_SYSTEM_ONE_MODEL });
});

test("System One maps typed answers and usage without parsing text", async () => {
  const systemOne = vi.fn(async () => ({
    model: "jev-1.13.0",
    answers: {
      outlook: {
        type: "choice" as const,
        choice: "bullish",
        confidence: 0.8,
        probabilities: { bullish: 0.8, bearish: 0.2 },
      },
    },
    usage: { input_tokens: 24, output_tokens: 3 },
  }));
  const provider = createSystemOneProvider({
    config: { apiKey: "test-key", model: DEFAULT_SYSTEM_ONE_MODEL },
    client: { systemOne } as never,
  });
  await expect(
    provider.judge({
      state: { symbol: "AAPL" },
      questions: { outlook: { type: "choice", criteria: { bullish: null, bearish: null } } },
    }),
  ).resolves.toEqual({
    model: "jev-1.13.0",
    answers: { outlook: expect.objectContaining({ choice: "bullish", confidence: 0.8 }) },
    usage: { inputTokens: 24, outputTokens: 3 },
  });
  expect(systemOne).toHaveBeenCalledWith(
    expect.objectContaining({ model: DEFAULT_SYSTEM_ONE_MODEL }),
  );
});

test("System One checks budget and records returned token usage", async () => {
  const recordUsage = vi.fn(async () => undefined);
  const provider = createSystemOneProvider({
    config: { apiKey: "test-key", model: DEFAULT_SYSTEM_ONE_MODEL },
    checkBudget: async () => ({ ok: true }),
    recordUsage,
    client: {
      systemOne: async () => ({
        model: "jev-1.13.0",
        answers: { answer: { type: "noul", noul: 0.9 } },
        usage: { input_tokens: 32, output_tokens: 4 },
      }),
    } as never,
  });
  await provider.judge({ state: "portfolio", questions: { answer: { type: "noul" } } });
  expect(recordUsage).toHaveBeenCalledWith("jev-1.13.0", 32, 4);
});

test("System One does not call provider after its budget gate refuses", async () => {
  const systemOne = vi.fn();
  const provider = createSystemOneProvider({
    config: { apiKey: "test-key", model: DEFAULT_SYSTEM_ONE_MODEL },
    checkBudget: async () => ({ ok: false as const, scope: "day" as const }),
    client: { systemOne } as never,
  });
  await expect(
    provider.judge({ state: "portfolio", questions: { answer: { type: "noul" } } }),
  ).rejects.toThrow("budget exhausted");
  expect(systemOne).not.toHaveBeenCalled();
});

test("System One refuses state above its byte limit", async () => {
  const provider = createSystemOneProvider({
    config: { apiKey: "test-key", model: DEFAULT_SYSTEM_ONE_MODEL },
    client: { systemOne: vi.fn() } as never,
  });
  await expect(
    provider.judge({
      state: "x".repeat(MAX_SYSTEM_ONE_STATE_BYTES + 1),
      questions: { answer: { type: "noul" } },
    }),
  ).rejects.toThrow("state exceeds");
});
