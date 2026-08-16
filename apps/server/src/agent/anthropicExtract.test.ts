import { beforeEach, expect, test, vi } from "vitest";

// Mock the Anthropic SDK so we exercise request construction + response parsing
// WITHOUT a network call (the route tests inject a fake extractor and never run
// this file's SDK path). `vi.hoisted` lets the mock factory reference the spy.
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: createMock };
  },
}));

import { AGENTS } from "@lavega/core";
import { extractInvoiceFields } from "./anthropicExtract.js";
import { sanitizeKnownFacts } from "./facts.js";

beforeEach(() => createMock.mockReset());

test("builds a forced-tool request with the document block and parses tool_use", async () => {
  createMock.mockResolvedValue({
    content: [
      { type: "text", text: "ok" },
      {
        type: "tool_use",
        name: "record_invoice",
        input: {
          counterparty: "ACME BV",
          amount: 121,
          currency: "EUR",
          issueDate: "2026-07-01",
          dueDate: "2026-07-31",
          direction: "in",
          vatAmount: 21,
          confidence: 0.9,
        },
      },
    ],
  });

  // A caller-supplied mediaType must NOT be trusted for the document block.
  const res = await extractInvoiceFields({ pdfBase64: "AAAA", mediaType: "image/png" }, "sk-ant-test");

  expect(res).toEqual({
    fields: {
      counterparty: "ACME BV",
      amount: 121,
      currency: "EUR",
      issueDate: "2026-07-01",
      dueDate: "2026-07-31",
      direction: "in",
      vatAmount: 21,
    },
    confidence: 0.9, // the model's own self-reported value, passed through
  });

  // Request was built as specified.
  const arg = createMock.mock.calls[0][0];
  expect(arg.model).toBe("claude-haiku-4-5");
  expect(arg.tool_choice).toEqual({ type: "tool", name: "record_invoice" });
  const blocks = arg.messages[0].content;
  expect(blocks[0]).toMatchObject({
    type: "document",
    source: { type: "base64", media_type: "application/pdf", data: "AAAA" }, // fixed, not "image/png"
  });
  // The instructions are no longer a string literal appended to the message:
  // they are the composed system prompt (_base.md + facturen-extract.md), and
  // the user message carries only the document.
  expect(blocks).toHaveLength(1);
  expect(arg.system).toContain("Factuur-extractie-agent");
  expect(arg.system).toContain("LaVega"); // _base.md composed in
});

test("coerces missing/mistyped fields: direction defaults to out, dueDate falls back to issueDate", async () => {
  createMock.mockResolvedValue({
    content: [
      {
        type: "tool_use",
        name: "record_invoice",
        input: { counterparty: "X", amount: "50", issueDate: "2026-01-02", direction: "weird" },
      },
    ],
  });

  const { fields, confidence } = await extractInvoiceFields({ text: "factuurtekst" }, "k");
  expect(fields.direction).toBe("out"); // anything other than "in"
  expect(fields.dueDate).toBe("2026-01-02"); // fell back to issueDate
  expect(fields.currency).toBe("EUR"); // default
  expect(fields.amount).toBe(50); // Number("50")
  expect(fields.vatAmount).toBeUndefined(); // absent -> undefined
  expect(confidence).toBeNull(); // model reported none -> null, never fabricated

  // A text-only input builds no document block.
  const blocks = createMock.mock.calls[0][0].messages[0].content;
  expect(blocks.some((b: { type: string }) => b.type === "document")).toBe(false);
});

test("the extractor is told the owner's field preferences, and never a counterparty", async () => {
  createMock.mockResolvedValue({
    content: [{ type: "tool_use", name: "record_invoice", input: { counterparty: "X", amount: 1, issueDate: "2026-01-01" } }],
  });
  const facts = sanitizeKnownFacts(
    [
      { subject: "dueDate", key: "voorkeur", value: "issueDate+30", source: "user" },
      { subject: "ACME BV", key: "voorkeur", value: "14 dagen", source: "user" }, // a counterparty: refused
    ],
    AGENTS.facturen,
  );
  await extractInvoiceFields({ text: "factuur" }, "k", facts);
  const system: string = createMock.mock.calls[0][0].system;
  expect(system).toContain("- dueDate voorkeur = issueDate+30 (door de gebruiker)");
  expect(system).not.toContain("ACME BV");
});

test("throws when the response has no tool_use block (surfaces as 502 upstream)", async () => {
  createMock.mockResolvedValue({ content: [{ type: "text", text: "sorry, geen factuur" }] });
  await expect(extractInvoiceFields({ text: "x" }, "k")).rejects.toThrow("geen extractie");
});
