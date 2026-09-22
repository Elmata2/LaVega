import { AGENTS, type LearnedFact } from "@lavega/core";
import type { InvoiceExtractInput } from "./redaction.js";
import { loadAgentPrompt } from "./prompts.js";
import { factsBlock } from "./facts.js";
import { createMistralProvider } from "./mistral.js";
import { MISTRAL_SMALL } from "./models.js";

/* WHAT IS PRINTED, NOT WHO THE OWNER IS.
 *
 * This used to carry `counterparty` and `direction`, both defined relative to
 * the owner — and this agent is deliberately never told who the owner is. So
 * the model guessed, identically on every model measured (17 Sep 2026,
 * mistral-small and mistral-medium): always `direction: "out"`, always the
 * issuer as counterparty. Correct for a bill received, wrong for every invoice
 * he sends, and wrong in the direction that books revenue as cost.
 *
 * Both fields now come out of apps/web/src/invoiceParty.ts, against accounts
 * and entity labels that never leave the browser. */
export type ExtractedInvoice = {
  /** The party that issued the invoice and is owed the money, as printed. */
  seller: string;
  /** The party that must pay it, as printed. */
  buyer: string;
  /** The IBAN to pay into, when the document prints one. */
  payeeIban?: string;
  /** The invoice's own number, when it prints one. */
  invoiceNumber?: string;
  amount: number;
  currency: string;
  issueDate: string;
  dueDate: string;
  vatAmount?: number;
};

/**
 * Extract the invoice fields from an ALREADY-SANITIZED input (see
 * sanitizeExtractInput) via the Mistral provider, in two steps: a PDF is
 * first OCR'd to markdown, then that markdown (or the caller's plain `text`
 * when there's no PDF) goes to the model as a JSON-mode completion. Its
 * behaviour lives in `prompts/facturen-extract.md` (composed with
 * `_base.md`), not in this file. We coerce the parsed JSON defensively (the
 * model can omit or mistype fields).
 */
/* THE ONLY THING BOUNDING WHAT ONE EXTRACTION CAN COST.
 *
 * OCR bills per page ($4 per 1000), and the redaction boundary accepts a PDF up
 * to ~10 MB, which can be thousands of pages. The budget gate runs ONCE before
 * the request, so it cannot stop a single call that costs more than the whole
 * daily cap — it only refuses the next one. Twenty pages is far beyond any real
 * invoice and holds one extraction under about seven cents.
 *
 * A longer document is truncated rather than refused: the fields this agent
 * looks for are on the first pages, and refusing a fat scan outright would be a
 * worse answer than reading the front of it. */
const MAX_OCR_PAGES = 20;
const OCR_PAGE_WINDOW = Array.from({ length: MAX_OCR_PAGES }, (_, i) => i);

export async function extractInvoiceFields(
  input: InvoiceExtractInput,
  apiKey: string,
  facts: readonly LearnedFact[] = [],
  onUsage?: (usage: {
    inputTokens: number;
    outputTokens: number;
    pages: number;
  }) => void | Promise<void>,
): Promise<{ fields: ExtractedInvoice; confidence: number | null }> {
  const provider = createMistralProvider(apiKey, MISTRAL_SMALL);

  let markdown: string | undefined;
  let pages = 0;
  if (input.pdfBase64) {
    /* A timeout or a malformed body here still leaves Mistral having processed
     * and billed the pages. We cannot know how many, so the window is the
     * honest upper bound: over-attributing is the safe direction for a cap. */
    try {
      const ocr = await provider.ocrPdf({ pdfBase64: input.pdfBase64, pages: OCR_PAGE_WINDOW });
      markdown = ocr.markdown;
      pages = ocr.pages;
    } catch (e) {
      await onUsage?.({ inputTokens: 0, outputTokens: 0, pages: MAX_OCR_PAGES });
      throw e;
    }
  }
  const documentText = markdown || input.text;
  if (!documentText) {
    // A blank/unreadable scan still burned a real, billable OCR call — record
    // it before throwing, or the spend never reaches the budget ledger.
    await onUsage?.({ inputTokens: 0, outputTokens: 0, pages });
    throw new Error("geen extractie");
  }

  // THE OCR PAGES ARE ALREADY BOUGHT BY HERE, whatever the completion does.
  //
  // Recording only on the happy path is how spend goes missing: on 14 Sep the
  // owner's OCR calls were succeeding while every completion answered 429, so
  // each attempt billed real pages that the cap never saw, and retrying looked
  // free. The blank-scan branch above always knew this; this one did not.
  let res: Awaited<ReturnType<typeof provider.complete>>;
  try {
    res = await provider.complete({
      system: loadAgentPrompt("facturen-extract") + factsBlock(facts, AGENTS.facturen),
      user: `Factuurtekst:\n${documentText}`,
      json: true,
      maxTokens: 1024,
    });
  } catch (e) {
    await onUsage?.({ inputTokens: 0, outputTokens: 0, pages });
    throw e;
  }
  // One row covers both the OCR pass and the completion — call it once, after
  // complete() resolves, so it reflects the full cost of this extraction.
  await onUsage?.({ inputTokens: res.usage.input, outputTokens: res.usage.output, pages });

  let parsed: unknown;
  try {
    parsed = JSON.parse(res.text);
  } catch {
    throw new Error("geen extractie");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("geen extractie");

  const f = parsed as Record<string, unknown>;
  /* Number(), then a finiteness check. `Number("1.234,56")` is NaN, not 0, and
   * `?? 0` never fires for it because NaN is not null — so a model that answers
   * with a formatted string used to put NaN straight into the amount field. */
  const amount = Number(f.amount ?? 0);
  const vat = Number(f.vatAmount);
  const fields: ExtractedInvoice = {
    seller: String(f.seller ?? ""),
    buyer: String(f.buyer ?? ""),
    payeeIban:
      typeof f.payeeIban === "string" && f.payeeIban.trim() ? f.payeeIban.trim() : undefined,
    invoiceNumber:
      typeof f.invoiceNumber === "string" && f.invoiceNumber.trim()
        ? f.invoiceNumber.trim()
        : undefined,
    amount: Number.isFinite(amount) ? amount : 0,
    currency: String(f.currency ?? "EUR"),
    issueDate: String(f.issueDate ?? ""),
    dueDate: String(f.dueDate ?? f.issueDate ?? ""),
    vatAmount: Number.isFinite(vat) ? vat : undefined,
  };
  // The model's OWN self-reported certainty (0..1), or null when it gave none —
  // we never fabricate a number, so the UI only shows a percentage it actually
  // reported.
  const rawConf = f.confidence;
  const confidence = typeof rawConf === "number" && rawConf >= 0 && rawConf <= 1 ? rawConf : null;
  return { fields, confidence };
}
