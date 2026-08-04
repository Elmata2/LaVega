export type InvoiceExtractInput = { pdfBase64?: string; text?: string; filename?: string; mediaType?: string };

const MAX_PDF_B64 = 14_000_000; // ~10 MB of base64
const MAX_TEXT = 200_000;

/** THE redaction boundary: build the forwarded input from ONLY these four keys.
 *  Nothing else in `raw` (transactions, balances, keys, ...) can ever reach the
 *  Anthropic API. Throws on oversize or an empty document. */
export function sanitizeExtractInput(raw: unknown): InvoiceExtractInput {
  if (!raw || typeof raw !== "object") throw new Error("ongeldige invoer");
  const r = raw as Record<string, unknown>;
  const out: InvoiceExtractInput = {};
  if (typeof r.pdfBase64 === "string") {
    if (r.pdfBase64.length > MAX_PDF_B64) throw new Error("pdf te groot");
    out.pdfBase64 = r.pdfBase64;
  }
  if (typeof r.text === "string") {
    if (r.text.length > MAX_TEXT) throw new Error("tekst te groot");
    out.text = r.text;
  }
  if (typeof r.filename === "string") out.filename = r.filename.slice(0, 200);
  if (typeof r.mediaType === "string") out.mediaType = r.mediaType.slice(0, 100);
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
    },
    required: ["counterparty", "amount", "currency", "issueDate", "dueDate", "direction"],
  },
} as const;

export const EXTRACT_PROMPT =
  "Je krijgt één factuur (PDF of tekst). Haal de velden eruit en roep record_invoice aan. " +
  "Gok niet: laat vatAmount weg als het niet vermeld staat; als de vervaldatum ontbreekt, gebruik de factuurdatum. " +
  "Bepaal 'direction' vanuit wie de factuur uitschrijft.";
