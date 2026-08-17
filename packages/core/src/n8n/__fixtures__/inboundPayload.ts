/* Vier POST-bodies zoals de Cloudflare Email Worker ze naar de webhook
 * "E-mail binnen" stuurt.
 *
 * WAAROM DIT PAYLOADS ZIJN EN GEEN RUWE MAILS. De Gmail-fixtures hiernaast
 * (rawMail.ts) staan er voluit in RFC-2822, omdat de fout die dáár gerepareerd
 * werd juist in de vertaling van een ruw bericht naar een object zat. Voor dit
 * pad ligt de grens ergens anders: het MIME-parsen gebeurt in de Worker
 * (apps/email-worker/src/parseMail.ts, daar getest op ruwe berichten), en wat
 * packages/core te zien krijgt is de JSON die daaruit komt. Dit bestand legt
 * dus het CONTRACT tussen die twee vast. Verandert de Worker zijn veldnamen,
 * dan hoort dit bestand mee te veranderen — en de test in
 * apps/email-worker/test/contract.test.ts vergelijkt beide kanten met elkaar.
 *
 * De vier vormen:
 *   1 platte tekst — de hele factuur staat in text/plain
 *   2 alleen HTML  — geen text/plain-deel; dit is de gewoonste factuurmail
 *   3 met PDF      — een korte tekst en de factuur als bijlage
 *   4 opslagverwijzing — `data` bevat geen base64 maar een pad. Die MOET
 *     geweigerd worden: hem als base64 doorsturen leverde eerder "Invalid
 *     base64 data" bij Anthropic op, en dan is er niets gelezen terwijl de run
 *     groen is.
 */

export type InboundAttachmentFixture = { fileName: string; mimeType: string; data: string };

export type InboundPayloadFixture = {
  to: string;
  queueKey: string;
  from: string;
  subject: string;
  date: string;
  messageId: string;
  text: string;
  html: string;
  auth: { spf: string; dkim: string; dmarc: string };
  attachments: InboundAttachmentFixture[];
};

/** Een minimale, ECHTE PDF-byte-reeks, base64 zoals de Worker hem meestuurt. */
export const PDF_BASE64 = Buffer.from(
  "%PDF-1.4\n" +
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n" +
    "4 0 obj << /Length 92 >> stream\n" +
    "BT /F1 12 Tf 72 720 Td (Factuur 2026-0207 - Totaal EUR 968,00 incl. 21% btw) Tj ET\n" +
    "endstream endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n",
  "binary",
).toString("base64");

/** 1 — de hele factuur staat in het text/plain-deel. */
export const INBOUND_PLAIN_TEXT: InboundPayloadFixture = {
  to: "alexander-7f3a@invoices.lavega.dev",
  queueKey: "alexander-7f3a",
  from: "Hosting Noord <facturen@hostingnoord.nl>",
  subject: "Factuur HN-2026-4412",
  date: "Mon, 17 Aug 2026 08:04:11 +0200",
  messageId: "<hn-2026-4412@hostingnoord.nl>",
  text: [
    "Beste klant,",
    "",
    "Hierbij factuur HN-2026-4412 van 17 augustus 2026.",
    "Vervaldatum: 31 augustus 2026.",
    "",
    "Webhosting Pro, 12 maanden   EUR 240,00",
    "Btw 21%                      EUR  50,40",
    "Totaal te voldoen            EUR 290,40",
    "",
    "Hosting Noord B.V., KvK 61224488.",
  ].join("\n"),
  html: "",
  auth: { spf: "pass", dkim: "pass", dmarc: "pass" },
  attachments: [],
};

/** 2 — geen text/plain-deel. Dit is de vorm die in de Gmail-tak stil wegviel. */
export const INBOUND_HTML_ONLY: InboundPayloadFixture = {
  to: "alexander-7f3a@invoices.lavega.dev",
  queueKey: "alexander-7f3a",
  from: "Fastned B.V. <facturatie@fastned.nl>",
  subject: "Uw factuur van augustus 2026",
  date: "Sat, 15 Aug 2026 06:03:10 +0200",
  messageId: "<aug-2026-8831@fastned.nl>",
  text: "",
  html: [
    "<html><body><h1>Uw factuur van augustus 2026</h1>",
    "<table>",
    "<tr><td>Laadsessies (14 stuks, 218 kWh)</td><td>EUR 137,34</td></tr>",
    "<tr><td>Abonnement Gold</td><td>EUR 11,99</td></tr>",
    "<tr><td>Btw 21%</td><td>EUR 31,36</td></tr>",
    "<tr><td>Totaalbedrag</td><td>EUR 180,69</td></tr>",
    "</table>",
    "<p>Factuurnummer FN-2026-08-8831, factuurdatum 15 augustus 2026.</p>",
    "</body></html>",
  ].join("\n"),
  auth: { spf: "pass", dkim: "pass", dmarc: "pass" },
  attachments: [],
};

/** 3 — korte tekst, factuur als PDF, plus een logo dat niet mee hoort te gaan.
 *  Het logo staat ERVOOR, dus op volgorde vertrouwen mag niet. */
export const INBOUND_WITH_PDF: InboundPayloadFixture = {
  to: "alexander-7f3a@invoices.lavega.dev",
  queueKey: "alexander-7f3a",
  from: "Van Dijk Installatietechniek <facturen@vandijk-installatie.nl>",
  subject: "Factuur 2026-0207",
  date: "Sun, 16 Aug 2026 11:20:00 +0200",
  messageId: "<2026-0207.factuur@vandijk-installatie.nl>",
  text: "Beste Alexander, in de bijlage vind je onze factuur voor de meterkast. Met vriendelijke groet, Van Dijk.",
  html: "",
  auth: { spf: "pass", dkim: "none", dmarc: "none" },
  attachments: [
    { fileName: "logo.png", mimeType: "image/png", data: Buffer.from("PNG-bytes").toString("base64") },
    { fileName: "factuur-2026-0207.pdf", mimeType: "application/pdf", data: PDF_BASE64 },
  ],
};

/** 4 — de Worker leverde een verwijzing in plaats van bytes. Weigeren, en de
 *  reden meesturen: doorsturen levert "Invalid base64 data" op en dan is er
 *  niets gelezen terwijl de run groen blijft. */
export const INBOUND_STORAGE_REFERENCE: InboundPayloadFixture = {
  to: "alexander-7f3a@invoices.lavega.dev",
  queueKey: "alexander-7f3a",
  from: "onbekend@voorbeeld.nl",
  subject: "Factuur",
  date: "Sun, 16 Aug 2026 12:00:00 +0200",
  messageId: "<ref-1@voorbeeld.nl>",
  text: "Zie bijlage.",
  html: "",
  auth: { spf: "fail", dkim: "fail", dmarc: "fail" },
  attachments: [
    {
      fileName: "factuur.pdf",
      mimeType: "application/pdf",
      data: "r2://lavega-mail/2026-08-16/abc-def.pdf",
    },
  ],
};
