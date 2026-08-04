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

import { extractInvoiceFields } from "./anthropicExtract.js";

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
        },
      },
    ],
  });

  const res = await extractInvoiceFields({ pdfBase64: "AAAA", mediaType: "application/pdf" }, "sk-ant-test");

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
    confidence: 0.8,
  });

  // Request was built as specified.
  const arg = createMock.mock.calls[0][0];
  expect(arg.model).toBe("claude-opus-4-8");
  expect(arg.tool_choice).toEqual({ type: "tool", name: "record_invoice" });
  const blocks = arg.messages[0].content;
  expect(blocks[0]).toMatchObject({
    type: "document",
    source: { type: "base64", media_type: "application/pdf", data: "AAAA" },
  });
  // The fixed prompt is always the last block.
  expect(blocks[blocks.length - 1].type).toBe("text");
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

  const { fields } = await extractInvoiceFields({ text: "factuurtekst" }, "k");
  expect(fields.direction).toBe("out"); // anything other than "in"
  expect(fields.dueDate).toBe("2026-01-02"); // fell back to issueDate
  expect(fields.currency).toBe("EUR"); // default
  expect(fields.amount).toBe(50); // Number("50")
  expect(fields.vatAmount).toBeUndefined(); // absent -> undefined

  // A text-only input builds no document block.
  const blocks = createMock.mock.calls[0][0].messages[0].content;
  expect(blocks.some((b: { type: string }) => b.type === "document")).toBe(false);
});

test("throws when the response has no tool_use block (surfaces as 502 upstream)", async () => {
  createMock.mockResolvedValue({ content: [{ type: "text", text: "sorry, geen factuur" }] });
  await expect(extractInvoiceFields({ text: "x" }, "k")).rejects.toThrow("geen extractie");
});
