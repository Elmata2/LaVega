import { expect, test } from "vitest";
import { sanitizeExtractInput, INVOICE_TOOL } from "./redaction.js";

test("sanitizeExtractInput passes only the allowed doc fields — never anything else", () => {
  const out = sanitizeExtractInput({ pdfBase64: "AAAA", filename: "f.pdf", transactions: [1, 2, 3], balance: 99999, apiKey: "leak" } as unknown);
  expect(out).toEqual({ pdfBase64: "AAAA", filename: "f.pdf" });
  expect((out as Record<string, unknown>).transactions).toBeUndefined();
  expect((out as Record<string, unknown>).balance).toBeUndefined();
});

test("sanitizeExtractInput enforces size caps and requires a document", () => {
  expect(() => sanitizeExtractInput({})).toThrow();
  expect(() => sanitizeExtractInput({ pdfBase64: "A".repeat(14_000_001) })).toThrow();
  expect(() => sanitizeExtractInput({ text: "A".repeat(200_001) })).toThrow();
});

test("INVOICE_TOOL forces exactly the 7 invoice fields", () => {
  const props = Object.keys(INVOICE_TOOL.input_schema.properties);
  expect(new Set(props)).toEqual(new Set(["counterparty", "amount", "currency", "issueDate", "dueDate", "direction", "vatAmount"]));
});
