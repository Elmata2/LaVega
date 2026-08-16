export type InvoiceExtractInput = { pdfBase64?: string; text?: string; filename?: string; mediaType?: string };

const MAX_PDF_B64 = 14_000_000; // ~14 MB of base64 (~10 MB binary)
const MAX_TEXT = 200_000;

/** THE redaction boundary: build the forwarded input from ONLY these four keys.
 *  Nothing else in `raw` (transactions, balances, keys, ...) can ever reach the
 *  Anthropic API. Throws on oversize or an empty document.
 *
 *  Each field is snapshotted into a local const with a single read, so a getter
 *  cannot return a small value for the size check and a huge one for the copy
 *  (a TOCTOU cap bypass). Only the four named keys are ever touched. */
export function sanitizeExtractInput(raw: unknown): InvoiceExtractInput {
  if (!raw || typeof raw !== "object") throw new Error("ongeldige invoer");
  const r = raw as Record<string, unknown>;
  const out: InvoiceExtractInput = {};
  const pdf = r.pdfBase64;
  if (typeof pdf === "string") {
    if (pdf.length > MAX_PDF_B64) throw new Error("pdf te groot");
    out.pdfBase64 = pdf;
  }
  const text = r.text;
  if (typeof text === "string") {
    if (text.length > MAX_TEXT) throw new Error("tekst te groot");
    out.text = text;
  }
  const filename = r.filename;
  if (typeof filename === "string") out.filename = filename.slice(0, 200);
  const mediaType = r.mediaType;
  if (typeof mediaType === "string") out.mediaType = mediaType.slice(0, 100);
  if (!out.pdfBase64 && !out.text) throw new Error("geen document");
  return out;
}

export const INVOICE_TOOL = {
  name: "record_invoice",
  description: "Registreer de velden van deze ene factuur.",
  input_schema: {
    type: "object",
    properties: {
      counterparty: { type: "string", description: "Naam van de wederpartij (leverancier bij inkoop, klant bij verkoop)" },
      amount: { type: "number", description: "Totaalbedrag incl. btw, in de factuurvaluta" },
      currency: { type: "string", description: "ISO-valuta, bv. EUR" },
      issueDate: { type: "string", description: "Factuurdatum, ISO YYYY-MM-DD" },
      dueDate: { type: "string", description: "Vervaldatum, ISO YYYY-MM-DD (indien afwezig: gelijk aan factuurdatum)" },
      direction: { type: "string", enum: ["in", "out"], description: "'in' = jij ontvangt geld (verkoopfactuur); 'out' = jij betaalt (inkoopfactuur)" },
      vatAmount: { type: "number", description: "Btw-bedrag indien vermeld" },
      confidence: { type: "number", description: "Je eigen zekerheid over deze extractie, 0 (onzeker) tot 1 (zeker)." },
    },
    required: ["counterparty", "amount", "currency", "issueDate", "dueDate", "direction"],
  },
} as const;

/* The extractor's instructions used to live here as a string literal. They are
 * now `prompts/facturen-extract.md`, composed with `_base.md` — edit the
 * Markdown, not TypeScript. */
