import { expect, test, vi } from "vitest";
import type { AgentMemoryRepository, PortfolioLetter } from "@lavega/database";
import type { InvestingDashboardData } from "@lavega/core";
import {
  ensureLetter,
  LETTER_INTERVAL_MS,
  letterHashes,
  normalizeLetterDraft,
  shouldGenerateLetter,
} from "./portfolioLetter.js";

const position = (symbol: string, quantity: number, costBasis = 100) =>
  ({
    symbol,
    quantity,
    returns: { remainingCostBasis: costBasis, realizedGain: 0, dividendsReceived: 0 },
  }) as unknown as InvestingDashboardData["positions"][number];

const dashboard = (...positions: InvestingDashboardData["positions"]) =>
  ({
    positions,
    presentationCurrency: "EUR",
    portfolio: { All: [] },
    problems: [],
  }) as unknown as InvestingDashboardData;

const draft = {
  verdict: "Too concentrated.",
  observations: [{ title: "ASML", body: "ASML is 30%.", figures: ["30%"] }],
};

function memoryStub(initial: PortfolioLetter | null = null) {
  let stored = initial;
  const repository = {
    latestLetter: async () => stored,
    saveLetter: async (letter: Omit<PortfolioLetter, "createdAt">) => {
      stored = { ...letter, createdAt: new Date().toISOString() };
      return stored;
    },
  } as unknown as AgentMemoryRepository;
  return repository;
}

const NOW = Date.parse("2026-10-03T12:00:00Z");
const letterAt = (ageMs: number, snapshotHash: string, holdingsHash: string) => ({
  snapshotHash,
  holdingsHash,
  createdAt: new Date(NOW - ageMs).toISOString(),
});

test("the generation gate", () => {
  const current = { snapshotHash: "s2", holdingsHash: "h1" };
  const cases: Array<[string, ReturnType<typeof letterAt> | null, boolean]> = [
    ["no letter yet", null, true],
    ["same snapshot", letterAt(10 * LETTER_INTERVAL_MS, "s2", "h1"), false],
    [
      "new snapshot, same holdings, under a week",
      letterAt(LETTER_INTERVAL_MS - 1, "s1", "h1"),
      false,
    ],
    ["new snapshot, same holdings, a week old", letterAt(LETTER_INTERVAL_MS, "s1", "h1"), true],
    ["holdings changed, one minute old", letterAt(60_000, "s1", "h0"), true],
  ];
  for (const [name, latest, expected] of cases)
    expect(shouldGenerateLetter(latest, current, NOW), name).toBe(expected);
});

test("prices do not change the snapshot hash, quantities and cost basis do", () => {
  const base = letterHashes(dashboard(position("ASML", 2), position("KO", 5)));
  const reordered = letterHashes(dashboard(position("KO", 5), position("ASML", 2)));
  const moreCost = letterHashes(dashboard(position("ASML", 2, 150), position("KO", 5)));
  const moreShares = letterHashes(dashboard(position("ASML", 3), position("KO", 5)));
  expect(reordered).toEqual(base);
  expect(moreCost.holdingsHash).toBe(base.holdingsHash);
  expect(moreCost.snapshotHash).not.toBe(base.snapshotHash);
  expect(moreShares.holdingsHash).not.toBe(base.holdingsHash);
});

test("a second ensure on the same snapshot makes no model call", async () => {
  const memory = memoryStub();
  const generate = vi.fn(async () => draft);
  const input = { dashboard: dashboard(position("ASML", 2)), sectors: null, memory, generate };

  const first = await ensureLetter(input);
  const second = await ensureLetter(input);

  expect(first.generated).toBe(true);
  expect(second).toEqual({ letter: first.letter, generated: false });
  expect(generate).toHaveBeenCalledTimes(1);
});

test("only three observations are kept, whatever the model returns", async () => {
  const many = {
    verdict: "Fine.",
    observations: Array.from({ length: 5 }, (_, i) => ({
      title: `T${i}`,
      body: `B${i}`,
      figures: ["1%"],
    })),
  };
  const { letter } = await ensureLetter({
    dashboard: dashboard(position("ASML", 2)),
    sectors: null,
    memory: memoryStub(),
    generate: async () => many,
  });
  expect(letter?.observations.map((o) => o.title)).toEqual(["T0", "T1", "T2"]);
});

test("a malformed draft stores nothing", async () => {
  expect(normalizeLetterDraft({ verdict: "", observations: [] })).toBeNull();
  expect(
    normalizeLetterDraft({ verdict: "x", observations: [{ title: "a", body: "b", figures: [] }] }),
  ).toBeNull();
  const memory = memoryStub();
  await expect(
    ensureLetter({
      dashboard: dashboard(position("ASML", 2)),
      sectors: null,
      memory,
      generate: async () => ({ verdict: "", observations: [] }),
    }),
  ).rejects.toThrow("no usable letter");
  expect(await memory.latestLetter()).toBeNull();
});
