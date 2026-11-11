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

test("both write tools are write-scoped and apply is preview-gated", () => {
  const defs = createInvestingWriteTools(source());
  expect(defs.map((definition) => definition.name)).toEqual(["preview_rule", "apply_rule"]);
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
