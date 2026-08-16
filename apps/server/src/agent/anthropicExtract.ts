import Anthropic from "@anthropic-ai/sdk";
import { AGENTS, type LearnedFact } from "@lavega/core";
import type { InvoiceExtractInput } from "./redaction.js";
import { INVOICE_TOOL } from "./redaction.js";
import { loadAgentPrompt } from "./prompts.js";
import { factsBlock } from "./facts.js";

/** The seven fields we ask Claude to pull off one invoice. */
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
 * Call Claude to extract the invoice fields from an ALREADY-SANITIZED input
 * (see sanitizeExtractInput — this is the only place `@anthropic-ai/sdk` may be
 * imported, and it must never see anything beyond the redacted document).
 *
 * The request is a single forced-tool call: the instructions are the SYSTEM
 * prompt, composed from `_base.md` + `prompts/facturen-extract.md` plus what
 * this agent has learned about how the owner corrects it, and the user message
 * carries only the document — the PDF as a `document` base64 block and the
 * (optional) OCR/text as a `text` block. `tool_choice` forces `record_invoice`,
 * so the response is one tiny `tool_use` block — no thinking, no streaming
 * needed. We coerce its `.input` defensively (the model can omit or mistype
 * fields).
 */
export async function extractInvoiceFields(
  input: InvoiceExtractInput,
  apiKey: string,
  facts: readonly LearnedFact[] = [],
): Promise<{ fields: ExtractedInvoice; confidence: number | null }> {
  const client = new Anthropic({ apiKey });

  const content: Anthropic.ContentBlockParam[] = [];
  if (input.pdfBase64) {
    content.push({
      type: "document",
      source: {
        type: "base64",
        // We only ever send PDFs as a document block, so the media type is fixed
        // here rather than trusting the caller-supplied string.
        media_type: "application/pdf",
        data: input.pdfBase64,
      },
    });
  }
  if (input.text) {
    content.push({ type: "text", text: `Factuurtekst:\n${input.text}` });
  }

  const res = await client.messages.create({
    // Haiku 4.5: invoice field-extraction with a forced tool is a light task —
    // ~5x cheaper than Opus, same native PDF support. Bump a specific doc to a
    // stronger model only if extraction quality proves insufficient.
    model: "claude-haiku-4-5",
    max_tokens: 1024,
    system: loadAgentPrompt("facturen-extract") + factsBlock(facts, AGENTS.facturen),
    tools: [INVOICE_TOOL as unknown as Anthropic.Tool],
    tool_choice: { type: "tool", name: "record_invoice" },
    messages: [{ role: "user", content }],
  });

  const block = res.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") throw new Error("geen extractie");
  const f = block.input as Record<string, unknown>;
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
  const confidence =
    typeof rawConf === "number" && rawConf >= 0 && rawConf <= 1 ? rawConf : null;
  return { fields, confidence };
}
