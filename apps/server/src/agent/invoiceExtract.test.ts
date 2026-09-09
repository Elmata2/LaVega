import { beforeEach, expect, test, vi } from "vitest";

// Mock the Mistral provider so we exercise request construction + response
// parsing WITHOUT a network call (the route tests inject a fake extractor and
// never run this file's provider path). `vi.hoisted` lets the mock factory
// reference the spies.
const { ocrMock, completeMock } = vi.hoisted(() => ({
  ocrMock: vi.fn(),
  completeMock: vi.fn(),
}));
vi.mock("./mistral.js", () => ({
  createMistralProvider: vi.fn(() => ({ ocrPdf: ocrMock, complete: completeMock })),
}));

import { AGENTS } from "@lavega/core";
import { extractInvoiceFields } from "./invoiceExtract.js";
import { sanitizeKnownFacts } from "./facts.js";

beforeEach(() => {
  ocrMock.mockReset();
  completeMock.mockReset();
});

test("a PDF input is OCR'd first, and the OCR markdown (not input.text) reaches complete()", async () => {
  ocrMock.mockResolvedValue({ markdown: "factuur van ACME", pages: 1 });
  completeMock.mockResolvedValue({
    text: JSON.stringify({
      counterparty: "ACME BV",
      amount: 121,
      currency: "EUR",
      issueDate: "2026-07-01",
      dueDate: "2026-07-31",
      direction: "in",
      vatAmount: 21,
      confidence: 0.9,
    }),
    usage: { input: 0, output: 0 },
  });

  const res = await extractInvoiceFields({ pdfBase64: "AAAA", text: "genegeerd" }, "sk-test");

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

  expect(ocrMock).toHaveBeenCalledWith({ pdfBase64: "AAAA" });
  const arg = completeMock.mock.calls[0][0];
  expect(arg.user).toBe("Factuurtekst:\nfactuur van ACME");
  expect(arg.json).toBe(true);
  expect(arg.maxTokens).toBe(1024);
  expect(arg.system).toContain("Factuur-extractie-agent");
});

test("throws 'geen extractie' when OCR returns empty markdown and there is no input.text, without calling complete()", async () => {
  ocrMock.mockResolvedValue({ markdown: "", pages: 1 });

  await expect(extractInvoiceFields({ pdfBase64: "AAAA" }, "k")).rejects.toThrow("geen extractie");
  expect(completeMock).not.toHaveBeenCalled();
});

test("onUsage still fires with the OCR page count when a blank/unreadable scan throws before complete() — that OCR call was real and billable", async () => {
  ocrMock.mockResolvedValue({ markdown: "", pages: 2 });
  const onUsage = vi.fn();

  await expect(extractInvoiceFields({ pdfBase64: "AAAA" }, "k", [], onUsage)).rejects.toThrow(
    "geen extractie",
  );
  expect(completeMock).not.toHaveBeenCalled();
  expect(onUsage).toHaveBeenCalledTimes(1);
  expect(onUsage).toHaveBeenCalledWith({ inputTokens: 0, outputTokens: 0, pages: 2 });
});

test("a text-only input never calls ocrPdf, and input.text reaches complete()", async () => {
  completeMock.mockResolvedValue({
    text: JSON.stringify({
      counterparty: "X",
      amount: "50",
      issueDate: "2026-01-02",
      direction: "weird",
    }),
    usage: { input: 0, output: 0 },
  });

  const { fields, confidence } = await extractInvoiceFields({ text: "factuurtekst" }, "k");

  expect(ocrMock).not.toHaveBeenCalled();
  expect(completeMock.mock.calls[0][0].user).toBe("Factuurtekst:\nfactuurtekst");
  expect(fields.direction).toBe("out"); // anything other than "in"
  expect(fields.dueDate).toBe("2026-01-02"); // fell back to issueDate
  expect(fields.currency).toBe("EUR"); // default
  expect(fields.amount).toBe(50); // Number("50")
  expect(fields.vatAmount).toBeUndefined(); // absent -> undefined
  expect(confidence).toBeNull(); // model reported none -> null, never fabricated
});

test("the extractor is told the owner's field preferences, and never a counterparty", async () => {
  completeMock.mockResolvedValue({
    text: JSON.stringify({ counterparty: "X", amount: 1, issueDate: "2026-01-01" }),
    usage: { input: 0, output: 0 },
  });
  const facts = sanitizeKnownFacts(
    [
      { subject: "dueDate", key: "voorkeur", value: "issueDate+30", source: "user" },
      { subject: "ACME BV", key: "voorkeur", value: "14 dagen", source: "user" }, // a counterparty: refused
    ],
    AGENTS.facturen,
  );
  await extractInvoiceFields({ text: "factuur" }, "k", facts);
  const system: string = completeMock.mock.calls[0][0].system;
  expect(system).toContain("- dueDate voorkeur = issueDate+30 (door de gebruiker)");
  expect(system).not.toContain("ACME BV");
});

test("throws 'geen extractie' when complete() returns text that is not valid JSON", async () => {
  completeMock.mockResolvedValue({ text: "sorry, geen factuur", usage: { input: 0, output: 0 } });
  await expect(extractInvoiceFields({ text: "x" }, "k")).rejects.toThrow("geen extractie");
});

test("throws 'geen extractie' when the parsed JSON is not an object", async () => {
  completeMock.mockResolvedValue({ text: JSON.stringify(null), usage: { input: 0, output: 0 } });
  await expect(extractInvoiceFields({ text: "x" }, "k")).rejects.toThrow("geen extractie");
});

test("onUsage fires once with OCR pages plus the completion's token counts, when a PDF is involved", async () => {
  ocrMock.mockResolvedValue({ markdown: "factuur van ACME", pages: 3 });
  completeMock.mockResolvedValue({
    text: JSON.stringify({ counterparty: "ACME BV", amount: 1, issueDate: "2026-01-01" }),
    usage: { input: 100, output: 50 },
  });
  const onUsage = vi.fn();
  await extractInvoiceFields({ pdfBase64: "AAAA" }, "k", [], onUsage);
  expect(onUsage).toHaveBeenCalledTimes(1);
  expect(onUsage).toHaveBeenCalledWith({ inputTokens: 100, outputTokens: 50, pages: 3 });
});

test("onUsage reports 0 pages when no PDF was involved", async () => {
  completeMock.mockResolvedValue({
    text: JSON.stringify({ counterparty: "X", amount: 1, issueDate: "2026-01-01" }),
    usage: { input: 10, output: 5 },
  });
  const onUsage = vi.fn();
  await extractInvoiceFields({ text: "factuurtekst" }, "k", [], onUsage);
  expect(onUsage).toHaveBeenCalledWith({ inputTokens: 10, outputTokens: 5, pages: 0 });
});
