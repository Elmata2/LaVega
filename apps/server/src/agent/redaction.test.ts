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

test("sanitizeExtractInput's size cap cannot be bypassed by a getter (TOCTOU)", () => {
  // A getter that returns a short string for the length check and a huge one for
  // the copy must NOT slip past the cap — the field is read exactly once.
  let n = 0;
  const raw = {
    get pdfBase64() {
      return n++ < 1 ? "A".repeat(14_000_001) : "AAAA";
    },
  };
  expect(() => sanitizeExtractInput(raw as unknown)).toThrow();
});

test("sanitizeExtractInput keeps a valid mediaType and drops prototype-smuggled keys", () => {
  const raw = { text: "hallo", mediaType: "application/pdf", __proto__: { balance: 999 } };
  const out = sanitizeExtractInput(raw as unknown);
  expect(out).toEqual({ text: "hallo", mediaType: "application/pdf" });
  expect((out as Record<string, unknown>).balance).toBeUndefined();
});

test("INVOICE_TOOL forces exactly the 7 invoice fields", () => {
  const props = Object.keys(INVOICE_TOOL.input_schema.properties);
  expect(new Set(props)).toEqual(new Set(["counterparty", "amount", "currency", "issueDate", "dueDate", "direction", "vatAmount"]));
});
