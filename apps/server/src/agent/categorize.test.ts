import { beforeEach, expect, test, vi } from "vitest";
import { AGENTS } from "@lavega/core";
import { sanitizeCategorizeInput } from "./categorize.js";
import { sanitizeKnownFacts } from "./facts.js";

// Mock the SDK so categorizeTransactions runs without a network call.
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create: createMock }; } }));
import { categorizeTransactions } from "./categorize.js";

beforeEach(() => createMock.mockReset());

test("sanitizeCategorizeInput keeps only {id,text,sign} — drops amount/accountKey etc.", () => {
  const out = sanitizeCategorizeInput({
    items: [{ id: "t1", text: "Albert Heijn", sign: "out", amount: -20, accountKey: "A1", date: "2026-08-01" }],
  });
  expect(out.items).toEqual([{ id: "t1", text: "Albert Heijn", sign: "out" }]);
});

test("sanitizeCategorizeInput throws on empty / too-many / oversize-text", () => {
  expect(() => sanitizeCategorizeInput({ items: [] })).toThrow();
  expect(() => sanitizeCategorizeInput({})).toThrow();
  expect(() =>
    sanitizeCategorizeInput({ items: Array.from({ length: 201 }, (_, i) => ({ id: String(i), text: "x", sign: "out" })) }),
  ).toThrow();
  expect(() => sanitizeCategorizeInput({ items: [{ id: "t1", text: "A".repeat(201), sign: "out" }] })).toThrow();
});

test("sanitizeCategorizeInput coerces sign to in/out", () => {
  const out = sanitizeCategorizeInput({
    items: [{ id: "t1", text: "x", sign: "weird" }, { id: "t2", text: "y", sign: "in" }],
  });
  expect(out.items.map((i) => i.sign)).toEqual(["out", "in"]);
});

test("categorizeTransactions uses Haiku forced tool + drops invalid categories", async () => {
  createMock.mockResolvedValue({
    content: [
      {
        type: "tool_use",
        name: "categorize_transactions",
        input: {
          results: [
            { id: "t1", category: "Boodschappen" },
            { id: "t2", category: "NietBestaand" }, // invalid -> dropped
            { id: "t3", category: "Inkomen" },
          ],
        },
      },
    ],
  });
  const out = await categorizeTransactions(
    { items: [{ id: "t1", text: "Albert Heijn", sign: "out" }, { id: "t2", text: "x", sign: "out" }, { id: "t3", text: "Salaris", sign: "in" }] },
    "k",
  );
  expect(out).toEqual([{ id: "t1", category: "Boodschappen" }, { id: "t3", category: "Inkomen" }]);
  const arg = createMock.mock.calls[0][0];
  expect(arg.model).toBe("claude-haiku-4-5");
  expect(arg.tool_choice).toEqual({ type: "tool", name: "categorize_transactions" });
  // The instructions come from prompts/categorize.md + _base.md, not a literal.
  expect(arg.system).toContain("Categorisatie-agent");
  expect(arg.system).toContain("LaVega — basis voor elke agent");
});

test("categorizeTransactions is told how the owner re-files its suggestions", async () => {
  createMock.mockResolvedValue({ content: [{ type: "tool_use", name: "categorize_transactions", input: { results: [] } }] });
  const facts = sanitizeKnownFacts(
    [
      { subject: "Overboekingen", key: "corrigeerNaar", value: "Eigen overboeking", source: "user" },
      { subject: "Albert Heijn", key: "corrigeerNaar", value: "Boodschappen", source: "user" }, // a merchant: refused
    ],
    AGENTS.categorize,
  );
  await categorizeTransactions({ items: [{ id: "t1", text: "x", sign: "out" }] }, "k", facts);
  const system: string = createMock.mock.calls[0][0].system;
  expect(system).toContain("- Overboekingen corrigeerNaar = Eigen overboeking (door de gebruiker)");
  expect(system).not.toContain("Albert Heijn");
});

test("categorizeTransactions returns [] when there's no tool_use block", async () => {
  createMock.mockResolvedValue({ content: [{ type: "text", text: "nope" }] });
  expect(await categorizeTransactions({ items: [{ id: "t1", text: "x", sign: "out" }] }, "k")).toEqual([]);
});
