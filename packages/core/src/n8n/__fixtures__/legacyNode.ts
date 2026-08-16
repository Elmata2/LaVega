/* De twee Code-nodes ZOALS ZE WAREN, woord voor woord uit
 * docs/n8n/lavega-invoices.json van vóór 17 augustus 2026 (git: de versie die
 * de run met 768 invoer-tokens produceerde).
 *
 * Ze staan hier alleen om de vergelijking te kunnen meten. "Het is nu beter"
 * hoort een getal te zijn, geen bewering.
 */

import type { GmailNodeItem } from "./gmailNode.js";

/** De oude "Normaliseer bericht". Las alleen `text` en `snippet`. */
export function legacyNormalise(item: GmailNodeItem): {
  subject: string;
  from: string;
  date: string;
  text: string;
  pdfs: { name: string; data: string }[];
  ok: boolean;
} {
  const j = item.json as Record<string, any>;
  const bin = (item.binary ?? {}) as Record<string, any>;
  const headers = j.headers || {};

  const subject = j.subject || headers.subject || "";
  const from = headers.from || j.From || "";
  const date = headers.date || j.internalDate || "";
  const text = String(j.text || j.snippet || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 6000);

  const pdfs: { name: string; data: string }[] = [];
  for (const key of Object.keys(bin)) {
    const b = bin[key];
    if (!b || !b.data) continue;
    const type = String(b.mimeType || "").toLowerCase();
    const name = String(b.fileName || key);
    if (type !== "application/pdf" && !/\.pdf$/i.test(name)) continue;
    if ((b.data.length * 3) / 4 > 4 * 1024 * 1024) continue;
    pdfs.push({ name, data: b.data });
    if (pdfs.length >= 3) break;
  }

  return { subject, from, date, text, pdfs, ok: pdfs.length > 0 || text.length > 40 };
}

/** De oude "Bouw Claude-verzoek": het tekstblok, inclusief de regel
 *  "Bijlagen: " die er ook stond als er niets bij zat. */
export function legacyUserText(message: ReturnType<typeof legacyNormalise>): string {
  return (
    "Onderwerp: " +
    message.subject +
    "\nAfzender: " +
    message.from +
    "\nDatum: " +
    message.date +
    "\nBijlagen: " +
    message.pdfs.map((p) => p.name).join(", ") +
    "\n\n" +
    message.text
  );
}

/** En de documentblokken: één per PDF — dus altijd nul, want `binary` was leeg. */
export function legacyDocumentCount(message: ReturnType<typeof legacyNormalise>): number {
  return message.pdfs.length;
}
