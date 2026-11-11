import { expect, test, vi } from "vitest";
import {
  createInvestingWriteTools,
  diffAccountWrappers,
  RULE_PREVIEW_TTL_MS,
  rulePayloadKey,
  type InvestingWriteSource,
} from "./writeTools.js";

/* WS5.4 acceptance (#299): a write preview changes nothing until apply; the
 * apply path is the only write; a read token never sees these tools. */

function source(overrides: Partial<InvestingWriteSource> = {}): InvestingWriteSource {
  return {
    recordValuation: vi.fn(async ({ date, totalCents, citation }) => ({
      applied: true as const,
      date,
      totalCents,
      citation,
    })),
    currentEntries: async () => [{ broker: "trading212", account: "ISA", wrapper: "unknown" }],
    storePreview: vi.fn(async ({ entries }) => ({
      previewToken: "rule_preview-1",
      expiresAt: "2026-11-11T00:30:00.000Z",
      entries,
    })),
    applyPreview: vi.fn(async () => ({
      applied: true as const,
      entries: [{ broker: "trading212", account: "ISA", wrapper: "isa" as const }],
    })),
    ...overrides,
  };
}

const tool = (defs: ReturnType<typeof createInvestingWriteTools>, name: string) =>
  defs.find((definition) => definition.name === name)!;

test("all write tools are write-scoped and apply is preview-gated", () => {
  const defs = createInvestingWriteTools(source());
  expect(defs.map((definition) => definition.name)).toEqual([
    "record_valuation",
    "preview_rule",
    "apply_rule",
  ]);
  expect(defs.every((definition) => definition.scope === "write")).toBe(true);
  expect(tool(defs, "apply_rule").preview).toBe(true);
  expect(RULE_PREVIEW_TTL_MS).toBe(30 * 60 * 1000);
});

test("preview validates the rule, describes the change and writes nothing", async () => {
  const writeSource = source();
  const preview = await tool(createInvestingWriteTools(writeSource), "preview_rule").handler({
    entries: [
      { broker: "trading212", account: "ISA", wrapper: "isa" },
      { broker: "ibkr", account: "Main", wrapper: "not-a-wrapper" },
    ],
  });

  expect(preview).toMatchObject({
    applied: false,
    valid: true,
    previewToken: "rule_preview-1",
    changes: [{ broker: "trading212", account: "ISA", from: "unknown", to: "isa" }],
  });
  expect(writeSource.applyPreview).not.toHaveBeenCalled();
  expect(writeSource.storePreview).toHaveBeenCalledWith(
    expect.objectContaining({ ttlMs: RULE_PREVIEW_TTL_MS }),
  );
});

test("an all-invalid rule is refused before a preview token is issued", async () => {
  const writeSource = source();
  const preview = await tool(createInvestingWriteTools(writeSource), "preview_rule").handler({
    entries: [{ broker: "ibkr", account: "Main", wrapper: "nope" }],
  });
  expect(preview).toMatchObject({ valid: false, applied: false });
  expect(writeSource.storePreview).not.toHaveBeenCalled();
});

test("apply consumes the token and performs the one write", async () => {
  const writeSource = source();
  const applied = await tool(createInvestingWriteTools(writeSource), "apply_rule").handler({
    previewToken: "rule_preview-1",
  });
  expect(applied).toEqual({
    applied: true,
    entries: [{ broker: "trading212", account: "ISA", wrapper: "isa" }],
  });
  expect(writeSource.applyPreview).toHaveBeenCalledWith("rule_preview-1");
});

test("an invalid token is safe data and changes nothing", async () => {
  const writeSource = source({
    applyPreview: async () => {
      throw new Error("expired");
    },
  });
  const applied = await tool(createInvestingWriteTools(writeSource), "apply_rule").handler({
    previewToken: "rule_stale",
  });
  expect(applied).toMatchObject({ applied: false });
  expect(JSON.stringify(applied)).not.toContain("Error: expired");
});

test("the diff and payload key are stable and ignore invalid labels", () => {
  expect(
    diffAccountWrappers(
      [{ broker: "a", account: "1", wrapper: "isa" }],
      [
        { broker: "a", account: "1", wrapper: "isa" },
        { broker: "b", account: "2", wrapper: "pea" },
      ],
    ),
  ).toEqual([{ broker: "b", account: "2", from: "unknown", to: "pea" }]);
  expect(
    rulePayloadKey([
      { broker: "b", account: "2", wrapper: "pea" },
      { broker: "a", account: "1", wrapper: "isa" },
    ]),
  ).toBe(
    rulePayloadKey([
      { broker: "a", account: "1", wrapper: "isa" },
      { broker: "b", account: "2", wrapper: "pea" },
    ]),
  );
});

/* WS5.5 (#300): the one valuation write, and its mandatory structured citation.
 * Sure source: app/models/assistant/function/record_valuation.rb @ 562fe09 —
 * `record_valuation` writes directly and the citation grammar is what gates it. */
const citation = {
  source: "Trading 212 account statement",
  grade: "A",
  date: "2026-01-01",
  documentId: "statement-2026-01",
};
const valuationInput = { date: "2026-01-01", totalCents: 123_456, citation };

test("record_valuation is a write tool that is not preview-gated", () => {
  const defs = createInvestingWriteTools(source());
  const definition = tool(defs, "record_valuation");
  expect(definition.scope).toBe("write");
  expect(definition.preview).toBeUndefined();
});

test("a valuation with a valid structured citation is recorded with the decoded citation", async () => {
  const writeSource = source();
  const result = await tool(createInvestingWriteTools(writeSource), "record_valuation").handler(
    valuationInput,
  );
  expect(result).toEqual({
    applied: true,
    date: "2026-01-01",
    totalCents: 123_456,
    citation,
  });
  expect(writeSource.recordValuation).toHaveBeenCalledWith({
    date: "2026-01-01",
    totalCents: 123_456,
    citation,
  });
});

test("a valuation WITHOUT a citation is refused in the agent path and nothing is written", async () => {
  const writeSource = source();
  const result = await tool(createInvestingWriteTools(writeSource), "record_valuation").handler({
    date: "2026-01-01",
    totalCents: 123_456,
  });
  expect(result).toMatchObject({
    applied: false,
    error: "citation_required",
    problems: [expect.stringContaining("citation")],
  });
  expect(writeSource.recordValuation).not.toHaveBeenCalled();
});

test("a malformed citation is refused with a safe hint and nothing is written", async () => {
  for (const bad of [
    { ...citation, grade: "D" },
    { ...citation, date: "2026-13-40" },
    { ...citation, source: "   " },
    { ...citation, note: "free text" },
  ]) {
    const writeSource = source();
    const result = await tool(createInvestingWriteTools(writeSource), "record_valuation").handler({
      ...valuationInput,
      citation: bad,
    });
    expect(result, JSON.stringify(bad)).toMatchObject({
      applied: false,
      error: "invalid_citation",
    });
    expect(JSON.stringify(result)).not.toContain("Expected");
    expect(writeSource.recordValuation).not.toHaveBeenCalled();
  }
});

test("a valuation amount must be integer cents, and the currency must be EUR (ADR 0011)", async () => {
  const writeSource = source();
  for (const bad of [
    { ...valuationInput, totalCents: 12.34 },
    { ...valuationInput, totalCents: "123" },
    { ...valuationInput, currency: "USD" },
  ]) {
    const result = await tool(createInvestingWriteTools(writeSource), "record_valuation").handler(
      bad,
    );
    expect(result).toMatchObject({ applied: false });
    expect(writeSource.recordValuation).not.toHaveBeenCalled();
  }
});

test("a future valuation date is refused", async () => {
  const writeSource = source();
  const result = await tool(createInvestingWriteTools(writeSource), "record_valuation").handler({
    ...valuationInput,
    date: "2999-01-01",
  });
  expect(result).toMatchObject({ applied: false, error: "future_date" });
  expect(writeSource.recordValuation).not.toHaveBeenCalled();
});
