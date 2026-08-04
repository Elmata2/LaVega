import Anthropic from "@anthropic-ai/sdk";
import type { InvoiceExtractInput } from "./redaction.js";
import { INVOICE_TOOL, EXTRACT_PROMPT } from "./redaction.js";

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
 * The request is a single forced-tool call: the PDF goes in as a `document`
 * base64 block, the (optional) OCR/text as a `text` block, then the fixed Dutch
 * prompt. `tool_choice` forces `record_invoice`, so the response is one tiny
 * `tool_use` block — no thinking, no streaming needed. We coerce its `.input`
 * defensively (the model can omit or mistype fields).
 */
export async function extractInvoiceFields(
  input: InvoiceExtractInput,
  apiKey: string,
): Promise<{ fields: ExtractedInvoice; confidence: number }> {
  const client = new Anthropic({ apiKey });

  const content: Anthropic.ContentBlockParam[] = [];
  if (input.pdfBase64) {
    content.push({
      type: "document",
      source: {
        type: "base64",
        media_type: (input.mediaType as "application/pdf") || "application/pdf",
        data: input.pdfBase64,
      },
    });
  }
  if (input.text) {
    content.push({ type: "text", text: `Factuurtekst:\n${input.text}` });
  }
  content.push({ type: "text", text: EXTRACT_PROMPT });

  const res = await client.messages.create({
    model: "claude-opus-4-8",
    max_tokens: 1024,
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
  return { fields, confidence: 0.8 };
}
