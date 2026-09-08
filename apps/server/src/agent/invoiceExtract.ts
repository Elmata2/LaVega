import { AGENTS, type LearnedFact } from "@lavega/core";
import type { InvoiceExtractInput } from "./redaction.js";
import { loadAgentPrompt } from "./prompts.js";
import { factsBlock } from "./facts.js";
import { createMistralProvider } from "./mistral.js";

/** The seven fields we ask the model to pull off one invoice. */
export type ExtractedInvoice = {
  counterparty: string;
  amount: number;
  currency: string;
  issueDate: string;
  dueDate: string;
  direction: "in" | "out";
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
export async function extractInvoiceFields(
  input: InvoiceExtractInput,
  apiKey: string,
  facts: readonly LearnedFact[] = [],
): Promise<{ fields: ExtractedInvoice; confidence: number | null }> {
  const provider = createMistralProvider(apiKey, "mistral-small-latest");

  let markdown: string | undefined;
  if (input.pdfBase64) {
    markdown = (await provider.ocrPdf({ pdfBase64: input.pdfBase64 })).markdown;
  }
  const documentText = markdown || input.text;
  if (!documentText) throw new Error("geen extractie");

  const res = await provider.complete({
    system: loadAgentPrompt("facturen-extract") + factsBlock(facts, AGENTS.facturen),
    user: `Factuurtekst:\n${documentText}`,
    json: true,
    maxTokens: 1024,
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(res.text);
  } catch {
    throw new Error("geen extractie");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("geen extractie");

  const f = parsed as Record<string, unknown>;
  const fields: ExtractedInvoice = {
    counterparty: String(f.counterparty ?? ""),
    amount: Number(f.amount ?? 0),
    currency: String(f.currency ?? "EUR"),
    issueDate: String(f.issueDate ?? ""),
    dueDate: String(f.dueDate ?? f.issueDate ?? ""),
    direction: f.direction === "in" ? "in" : "out",
    vatAmount: typeof f.vatAmount === "number" ? f.vatAmount : undefined,
  };
  // The model's OWN self-reported certainty (0..1), or null when it gave none —
  // we never fabricate a number, so the UI only shows a percentage it actually
  // reported.
  const rawConf = f.confidence;
  const confidence = typeof rawConf === "number" && rawConf >= 0 && rawConf <= 1 ? rawConf : null;
  return { fields, confidence };
}
