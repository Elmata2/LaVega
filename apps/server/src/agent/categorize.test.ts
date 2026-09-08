import { beforeEach, expect, test, vi } from "vitest";
import { AGENTS } from "@lavega/core";
import { sanitizeCategorizeInput } from "./categorize.js";
import { sanitizeKnownFacts } from "./facts.js";

const { completeMock } = vi.hoisted(() => ({ completeMock: vi.fn() }));
vi.mock("./mistral.js", () => ({
  createMistralProvider: () => ({ complete: completeMock }),
}));
import { categorizeTransactions } from "./categorize.js";

beforeEach(() => completeMock.mockReset());

test("sanitizeCategorizeInput keeps only {id,text,sign} — drops amount/accountKey etc.", () => {
  const out = sanitizeCategorizeInput({
    items: [
      {
        id: "t1",
        text: "Albert Heijn",
        sign: "out",
        amount: -20,
        accountKey: "A1",
        date: "2026-08-01",
      },
    ],
  });
  expect(out.items).toEqual([{ id: "t1", text: "Albert Heijn", sign: "out" }]);
});

test("sanitizeCategorizeInput throws on empty / too-many / oversize-text", () => {
  expect(() => sanitizeCategorizeInput({ items: [] })).toThrow();
  expect(() => sanitizeCategorizeInput({})).toThrow();
  expect(() =>
    sanitizeCategorizeInput({
      items: Array.from({ length: 201 }, (_, i) => ({ id: String(i), text: "x", sign: "out" })),
    }),
  ).toThrow();
  expect(() =>
    sanitizeCategorizeInput({ items: [{ id: "t1", text: "A".repeat(201), sign: "out" }] }),
  ).toThrow();
});

test("sanitizeCategorizeInput coerces sign to in/out", () => {
  const out = sanitizeCategorizeInput({
    items: [
      { id: "t1", text: "x", sign: "weird" },
      { id: "t2", text: "y", sign: "in" },
    ],
  });
  expect(out.items.map((i) => i.sign)).toEqual(["out", "in"]);
});

test("categorizeTransactions calls the Mistral provider in JSON mode + drops invalid categories", async () => {
  completeMock.mockResolvedValue({
    text: JSON.stringify({
      results: [
        { id: "t1", category: "Boodschappen" },
        { id: "t2", category: "NietBestaand" },
        { id: "t3", category: "Inkomen" },
      ],
    }),
    usage: { input: 0, output: 0 },
  });
  const out = await categorizeTransactions(
    {
      items: [
        { id: "t1", text: "Albert Heijn", sign: "out" },
        { id: "t2", text: "x", sign: "out" },
        { id: "t3", text: "Salaris", sign: "in" },
      ],
    },
    "k",
  );
  expect(out).toEqual([
    { id: "t1", category: "Boodschappen" },
    { id: "t3", category: "Inkomen" },
  ]);
  const arg = completeMock.mock.calls[0][0];
  expect(arg.json).toBe(true);
  expect(arg.maxTokens).toBe(8192);
  expect(arg.system).toContain("Categorisatie-agent");
  expect(arg.system).toContain("LaVega — basis voor elke agent");
});

test("categorizeTransactions is told how the owner re-files its suggestions", async () => {
  completeMock.mockResolvedValue({
    text: JSON.stringify({ results: [] }),
    usage: { input: 0, output: 0 },
  });
  const facts = sanitizeKnownFacts(
    [
      {
        subject: "Overboekingen",
        key: "corrigeerNaar",
        value: "Eigen overboeking",
        source: "user",
      },
      { subject: "Albert Heijn", key: "corrigeerNaar", value: "Boodschappen", source: "user" }, // a merchant: refused
    ],
    AGENTS.categorize,
  );
  await categorizeTransactions({ items: [{ id: "t1", text: "x", sign: "out" }] }, "k", facts);
  const system: string = completeMock.mock.calls[0][0].system;
  expect(system).toContain("- Overboekingen corrigeerNaar = Eigen overboeking (door de gebruiker)");
  expect(system).not.toContain("Albert Heijn");
});

test("a full month-sized batch fits the cap (the AI pass runs month by month)", () => {
  // The browser points the pass at one month at a time, newest month first
  // (core's uncategorizedByMonth). A busy month stays inside MAX_ITEMS.
  const month = Array.from({ length: 200 }, (_, i) => ({
    id: `t${i}`,
    text: "Onbekende Winkel",
    sign: "out",
  }));
  expect(sanitizeCategorizeInput({ items: month }).items).toHaveLength(200);
});

test("redaction boundary end-to-end: nothing but {id,text,sign} reaches the model", async () => {
  completeMock.mockResolvedValue({
    text: JSON.stringify({ results: [] }),
    usage: { input: 0, output: 0 },
  });
  // A caller that smuggles amounts/IBANs/dates onto the item alongside the text.
  const input = sanitizeCategorizeInput({
    items: [
      {
        id: "t1",
        text: "Onbekende Winkel XYZ",
        sign: "out",
        amount: -1234.56,
        balance: 98765.43,
        accountKey: "NL95INGB0674843703",
        iban: "NL95INGB0674843703",
        date: "2026-08-14",
      },
    ],
  });
  await categorizeTransactions(input, "k");
  const sent = completeMock.mock.calls[0][0].user;
  expect(sent).toContain("Onbekende Winkel XYZ");
  for (const leak of ["1234.56", "98765.43", "NL95INGB0674843703", "2026-08-14"]) {
    expect(sent).not.toContain(leak);
  }
});

test("sanitizeCategorizeInput scrubs a raw IBAN left in text — defence in depth (M5/L7)", () => {
  // The browser's own redaction is supposed to have already stripped this;
  // the server must not trust that and re-check the value itself.
  const out = sanitizeCategorizeInput({
    items: [
      {
        id: "t1",
        text: "Naar NL91 ABNA 0417 1643 00 voor Jan, mail jan@voorbeeld.nl",
        sign: "out",
      },
    ],
  });
  expect(out.items).toEqual([
    { id: "t1", text: "Naar [IBAN] voor Jan, mail [EMAIL]", sign: "out" },
  ]);
});

test("categorizeTransactions never forwards a raw IBAN even if the caller's text still carries one", async () => {
  completeMock.mockResolvedValue({
    text: JSON.stringify({ results: [] }),
    usage: { input: 0, output: 0 },
  });
  const input = sanitizeCategorizeInput({
    items: [{ id: "t1", text: "NL91 ABNA 0417 1643 00 Albert Heijn", sign: "out" }],
  });
  await categorizeTransactions(input, "k");
  const sent: string = completeMock.mock.calls[0][0].user;
  expect(sent).toBe("Transacties:\nt1\t[out] [IBAN] Albert Heijn");
  expect(sent).not.toContain("NL91");
  expect(sent).not.toContain("1643");
});

test("categorizeTransactions returns [] when the model's text has no usable results array", async () => {
  completeMock.mockResolvedValue({
    text: JSON.stringify({ nope: true }),
    usage: { input: 0, output: 0 },
  });
  expect(
    await categorizeTransactions({ items: [{ id: "t1", text: "x", sign: "out" }] }, "k"),
  ).toEqual([]);
});

test("categorizeTransactions returns [] when the model's text isn't JSON", async () => {
  completeMock.mockResolvedValue({ text: "not json at all", usage: { input: 0, output: 0 } });
  expect(
    await categorizeTransactions({ items: [{ id: "t1", text: "x", sign: "out" }] }, "k"),
  ).toEqual([]);
});
