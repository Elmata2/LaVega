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
      seller: "ACME BV",
      buyer: "Steunenberg Holding BV",
      payeeIban: "NL02 INGB 0123 4567 89",
      amount: 121,
      currency: "EUR",
      issueDate: "2026-07-01",
      dueDate: "2026-07-31",
      vatAmount: 21,
      confidence: 0.9,
    }),
    usage: { input: 0, output: 0 },
  });

  const res = await extractInvoiceFields({ pdfBase64: "AAAA", text: "genegeerd" }, "sk-test");

  expect(res).toEqual({
    fields: {
      seller: "ACME BV",
      buyer: "Steunenberg Holding BV",
      payeeIban: "NL02 INGB 0123 4567 89",
      amount: 121,
      currency: "EUR",
      issueDate: "2026-07-01",
      dueDate: "2026-07-31",
      vatAmount: 21,
    },
    confidence: 0.9, // the model's own self-reported value, passed through
  });

  /* The page window is part of the contract, not an incidental argument: it is
  // the only bound on what a single extraction can cost. */
  expect(ocrMock).toHaveBeenCalledWith({
    pdfBase64: "AAAA",
    pages: Array.from({ length: 20 }, (_, i) => i),
  });
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

/* DE ZUSTERGEVAL VAN HET BLANCO SCAN-GEVAL, EN HET GEVAL DAT ECHT GEBEURDE.
 *
 * Op 14 september slaagde elke OCR-aanroep en gaf elke completion 429, omdat
 * het spend-plafond van de Mistral-workspace bereikt was. De pagina's waren dus
 * echt gekocht, maar `onUsage` stond alleen op het gelukkige pad: het plafond
 * zag die uitgave nooit en opnieuw proberen leek gratis. Nu de aanbieder
 * pay-as-you-go is, is dat precies het gat waardoor een rekening oploopt zonder
 * dat de dagteller beweegt. */
test("onUsage fires with the OCR page count when complete() throws — those pages were bought", async () => {
  ocrMock.mockResolvedValue({ markdown: "factuur van ACME", pages: 3 });
  completeMock.mockRejectedValue(new Error("mistral chat 429: Rate limit exceeded"));
  const onUsage = vi.fn();

  await expect(extractInvoiceFields({ pdfBase64: "AAAA" }, "k", [], onUsage)).rejects.toThrow(
    "429",
  );
  expect(onUsage).toHaveBeenCalledTimes(1);
  expect(onUsage).toHaveBeenCalledWith({ inputTokens: 0, outputTokens: 0, pages: 3 });
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

/* A EUROPEAN AMOUNT AS A STRING USED TO BECOME NaN, NOT ZERO.
 *
 * `Number("1.234,56")` is NaN, and `f.amount ?? 0` never fires for it, because
 * NaN is not null. So the old coercion put NaN into `amount`, the browser did
 * `String(NaN)` into the form, and the field read "NaN". The model is asked for
 * a plain number and normally gives one — this is the guard for when it does
 * not, and it must land on a value the form can refuse, not on NaN. */
test("an unparseable amount lands on 0 rather than NaN", async () => {
  completeMock.mockResolvedValue({
    text: JSON.stringify({
      seller: "X",
      buyer: "Y",
      amount: "1.234,56",
      vatAmount: "n.v.t.",
      issueDate: "2026-01-02",
    }),
    usage: { input: 0, output: 0 },
  });
  const { fields } = await extractInvoiceFields({ text: "t" }, "k");
  expect(Number.isNaN(fields.amount)).toBe(false);
  expect(fields.amount).toBe(0);
  expect(fields.vatAmount).toBeUndefined();
});

/* The IBAN comes back as printed, spaces and all — invoiceParty.ts normalises
 * it. A blank or whitespace-only value is dropped rather than forwarded as "",
 * because an empty string would read as "the document printed an IBAN". */
test("a blank payee IBAN is dropped, a printed one is kept verbatim", async () => {
  for (const [given, expected] of [
    ["  ", undefined],
    ["", undefined],
    [" NL91 ABNA 0417 1643 00 ", "NL91 ABNA 0417 1643 00"],
  ] as const) {
    completeMock.mockResolvedValue({
      text: JSON.stringify({ seller: "X", buyer: "Y", amount: 1, issueDate: "2026-01-02", payeeIban: given }),
      usage: { input: 0, output: 0 },
    });
    const { fields } = await extractInvoiceFields({ text: "t" }, "k");
    expect(fields.payeeIban, JSON.stringify(given)).toBe(expected);
  }
});

test("a text-only input never calls ocrPdf, and input.text reaches complete()", async () => {
  completeMock.mockResolvedValue({
    text: JSON.stringify({
      seller: "X",
      buyer: "Y",
      amount: "50",
      issueDate: "2026-01-02",
    }),
    usage: { input: 0, output: 0 },
  });

  const { fields, confidence } = await extractInvoiceFields({ text: "factuurtekst" }, "k");

  expect(ocrMock).not.toHaveBeenCalled();
  expect(completeMock.mock.calls[0][0].user).toBe("Factuurtekst:\nfactuurtekst");
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
