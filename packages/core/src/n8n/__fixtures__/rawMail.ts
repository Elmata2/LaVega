/* Vier ruwe berichten in RFC-2822, zoals Gmail ze in `raw` teruggeeft.
 *
 * Ze staan hier voluit en niet als kant-en-klaar object, want de fout die we
 * repareren zat juist in de vertaling van zo'n bericht naar een object. Een
 * fixture die dat overslaat zou de fout niet kunnen vangen.
 *
 * De vier vormen komen uit het onderzoek naar wat er echt in een mailbox van
 * een eenmans-BV binnenkomt:
 *   A  PDF als bijlage, met een korte text/plain naast de volledige HTML
 *      (multipart/mixed → multipart/alternative → text/plain + text/html)
 *   B  de hele factuur in de HTML, geen PDF, wel een logo in de handtekening
 *   C  een melding met een link: "uw factuur staat klaar", geen bedrag
 *   D  een mail zonder enige leesbare tekst
 */

const PDF_BYTES =
  "%PDF-1.4\n" +
  "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n" +
  "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n" +
  "3 0 obj << /Type /Page /Parent 2 0 R /Contents 4 0 R >> endobj\n" +
  "4 0 obj << /Length 92 >> stream\n" +
  "BT /F1 12 Tf 72 720 Td (Factuur 2026-0184 - Totaal EUR 1815,00 incl. 21% btw) Tj ET\n" +
  "endstream endobj\n" +
  "trailer << /Root 1 0 R >>\n%%EOF\n";

const PNG_BYTES = "\x89PNG\r\n\x1a\n" + "logo-bytes-die-er-niet-toe-doen".repeat(4);

function base64Lines(bytes: string): string {
  return (Buffer.from(bytes, "binary").toString("base64").match(/.{1,76}/g) ?? []).join("\n");
}

const PDF_BASE64 = base64Lines(PDF_BYTES);
const PNG_BASE64 = base64Lines(PNG_BYTES);

/** A — factuur als PDF-bijlage, met de logo-bijlage ERVOOR (dus attachment_0 is
 *  het logo en attachment_1 de factuur; op volgorde vertrouwen mag niet). */
export const RAW_PDF_INVOICE = [
  "From: Van Dijk Installatietechniek <facturen@vandijk-installatie.nl>",
  "To: alexander@generation-c.nl",
  "Subject: Factuur 2026-0184 van Van Dijk Installatietechniek",
  "Date: Thu, 13 Aug 2026 09:12:44 +0200",
  "Message-ID: <2026-0184.factuur@vandijk-installatie.nl>",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="buiten-84f1"',
  "",
  "--buiten-84f1",
  'Content-Type: multipart/alternative; boundary="binnen-2b70"',
  "",
  "--binnen-2b70",
  'Content-Type: text/plain; charset="utf-8"',
  "Content-Transfer-Encoding: quoted-printable",
  "",
  "Beste Alexander,",
  "",
  "In de bijlage vind je onze factuur. Zie de PDF voor de details.",
  "",
  "Met vriendelijke groet,",
  "Van Dijk Installatietechniek",
  "",
  "--binnen-2b70",
  'Content-Type: text/html; charset="utf-8"',
  "Content-Transfer-Encoding: quoted-printable",
  "",
  "<html><body>",
  "<p>Beste Alexander,</p>",
  "<p>Hierbij factuur <strong>2026-0184</strong> voor de werkzaamheden aan de",
  "meterkast op de Weena 505.</p>",
  "<table>",
  "<tr><td>Factuurnummer</td><td>2026-0184</td></tr>",
  "<tr><td>Factuurdatum</td><td>13-08-2026</td></tr>",
  "<tr><td>Vervaldatum</td><td>12-09-2026</td></tr>",
  "<tr><td>Arbeid, 12 uur</td><td>EUR 1.020,00</td></tr>",
  "<tr><td>Materiaal</td><td>EUR 480,00</td></tr>",
  "<tr><td>Subtotaal</td><td>EUR 1.500,00</td></tr>",
  "<tr><td>Btw 21%</td><td>EUR 315,00</td></tr>",
  "<tr><td><strong>Totaal te voldoen</strong></td><td><strong>EUR 1.815,00</strong></td></tr>",
  "</table>",
  "<p>Wij verzoeken u het bedrag binnen 30 dagen over te maken op",
  "NL12 RABO 0123 4567 89 onder vermelding van het factuurnummer.</p>",
  "<p>Van Dijk Installatietechniek BV &middot; KvK 24398211 &middot; BTW NL8123.45.678.B01</p>",
  "</body></html>",
  "",
  "--binnen-2b70--",
  "",
  "--buiten-84f1",
  'Content-Type: image/png; name="logo.png"',
  "Content-Transfer-Encoding: base64",
  'Content-Disposition: inline; filename="logo.png"',
  "",
  PNG_BASE64,
  "",
  "--buiten-84f1",
  'Content-Type: application/pdf; name="factuur-2026-0184.pdf"',
  "Content-Transfer-Encoding: base64",
  'Content-Disposition: attachment; filename="factuur-2026-0184.pdf"',
  "",
  PDF_BASE64,
  "",
  "--buiten-84f1--",
  "",
].join("\r\n");

/** B — de hele factuur staat in de HTML. Geen text/plain-deel, dus mailparser
 *  levert `html` en GEEN `text`: precies de mail die de oude code liet vallen. */
export const RAW_HTML_ONLY = [
  "From: Fastned B.V. <facturatie@fastned.nl>",
  "To: alexander@generation-c.nl",
  "Subject: Uw factuur van augustus 2026",
  "Date: Sat, 15 Aug 2026 06:03:10 +0200",
  "Message-ID: <aug-2026-8831@fastned.nl>",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="fn-9911"',
  "",
  "--fn-9911",
  'Content-Type: text/html; charset="utf-8"',
  "Content-Transfer-Encoding: quoted-printable",
  "",
  "<html><body>",
  "<h1>Uw factuur van augustus 2026</h1>",
  "<p>Beste heer Steunenberg, hieronder vindt u het overzicht van uw",
  "laadsessies in augustus 2026.</p>",
  "<table>",
  "<tr><th>Omschrijving</th><th>Bedrag</th></tr>",
  "<tr><td>Laadsessies (14 stuks, 218 kWh)</td><td>EUR 137,34</td></tr>",
  "<tr><td>Abonnement Gold</td><td>EUR 11,99</td></tr>",
  "<tr><td>Subtotaal</td><td>EUR 149,33</td></tr>",
  "<tr><td>Btw 21%</td><td>EUR 31,36</td></tr>",
  "<tr><td>Totaalbedrag</td><td>EUR 180,69</td></tr>",
  "</table>",
  "<p>Factuurnummer FN-2026-08-8831. Factuurdatum 15 augustus 2026.",
  "Het bedrag wordt op 22 augustus 2026 automatisch ge&iuml;ncasseerd van",
  "rekening NL91 INGB 0002 4455 66. U hoeft niets te doen.</p>",
  "<p style=3D\"color:#888\">Fastned B.V., James Wattstraat 77-79, Amsterdam.</p>",
  "</body></html>",
  "",
  "--fn-9911",
  'Content-Type: image/png; name="fastned-logo.png"',
  "Content-Transfer-Encoding: base64",
  'Content-Disposition: inline; filename="fastned-logo.png"',
  "",
  PNG_BASE64,
  "",
  "--fn-9911--",
  "",
].join("\r\n");

/** C — melding met een link. Er staat geen bedrag in en er zit niets bij; de
 *  factuur staat achter een inlog. Dit is geen factuur en ook geen "niets". */
export const RAW_LINK_ONLY = [
  "From: KPN <noreply@kpn.com>",
  "To: alexander@generation-c.nl",
  "Subject: Uw factuur van augustus staat voor u klaar",
  "Date: Fri, 14 Aug 2026 04:31:02 +0200",
  "Message-ID: <mijnkpn-20260814-77213@kpn.com>",
  "MIME-Version: 1.0",
  'Content-Type: multipart/alternative; boundary="kpn-31aa"',
  "",
  "--kpn-31aa",
  'Content-Type: text/plain; charset="utf-8"',
  "Content-Transfer-Encoding: 7bit",
  "",
  "Beste klant,",
  "",
  "Uw factuur van augustus 2026 staat klaar in MijnKPN. Log in om hem te",
  "bekijken of te downloaden. Dit bericht is automatisch verstuurd; u kunt er",
  "niet op antwoorden.",
  "",
  "--kpn-31aa",
  'Content-Type: text/html; charset="utf-8"',
  "Content-Transfer-Encoding: 7bit",
  "",
  "<html><body><p>Beste klant,</p>",
  "<p>Uw factuur van augustus 2026 staat klaar in MijnKPN.</p>",
  '<p><a href="https://www.kpn.com/mijnkpn/facturen">Bekijk uw factuur</a></p>',
  "<p>Dit bericht is automatisch verstuurd.</p></body></html>",
  "",
  "--kpn-31aa--",
  "",
].join("\r\n");

/** D — niets leesbaars: alleen een plaatje. Zulke mail bestaat (een gescande
 *  bon die als inline afbeelding verstuurd wordt) en mag niet stil verdwijnen. */
export const RAW_NO_BODY = [
  "From: Kantoorboekhandel Smit <info@smit-kantoor.nl>",
  "To: alexander@generation-c.nl",
  "Subject: Bon",
  "Date: Wed, 12 Aug 2026 17:45:00 +0200",
  "Message-ID: <scan-20260812-2@smit-kantoor.nl>",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="smit-77"',
  "",
  "--smit-77",
  'Content-Type: image/png; name="scan.png"',
  "Content-Transfer-Encoding: base64",
  'Content-Disposition: attachment; filename="scan.png"',
  "",
  PNG_BASE64,
  "",
  "--smit-77--",
  "",
].join("\r\n");
