/* Ruwe RFC-5322-berichten voor de MIME-parser, als latin1-string.
 *
 * Ze staan hier voluit, niet als object. De parser IS de vertaling van zo'n
 * bericht naar een object, dus een fixture die die stap overslaat kan de fouten
 * die daar zitten niet vangen.
 *
 * `latin1` is geen detail: één teken = één byte. Zo komt een base64-bijlage
 * ongeschonden door, en zo werkt ook `bytesToLatin1` in de Worker.
 */

function base64Lines(binary: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let out = "";
  for (let i = 0; i < binary.length; i += 3) {
    const b0 = binary.charCodeAt(i) & 0xff;
    const b1 = i + 1 < binary.length ? binary.charCodeAt(i + 1) & 0xff : 0;
    const b2 = i + 2 < binary.length ? binary.charCodeAt(i + 2) & 0xff : 0;
    out += alphabet[b0 >> 2];
    out += alphabet[((b0 & 0x03) << 4) | (b1 >> 4)];
    out += i + 1 < binary.length ? alphabet[((b1 & 0x0f) << 2) | (b2 >> 6)] : "=";
    out += i + 2 < binary.length ? alphabet[b2 & 0x3f] : "=";
  }
  return (out.match(/.{1,76}/g) ?? []).join("\r\n");
}

export const PDF_BINARY =
  "%PDF-1.4\n" +
  "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n" +
  "4 0 obj << /Length 92 >> stream\n" +
  "BT /F1 12 Tf 72 720 Td (Factuur 2026-0207 - Totaal EUR 968,00 incl. 21% btw) Tj ET\n" +
  "endstream endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n";

export const PDF_BASE64_LINES = base64Lines(PDF_BINARY);
const PNG_BASE64_LINES = base64Lines("\x89PNG\r\n\x1a\n" + "logo".repeat(20));

/** A — een korte text/plain náást de volledige HTML, plus een logo ÉN de PDF.
 *  Het logo staat er met opzet vóór: op de volgorde vertrouwen mag niet. */
export const RAW_PDF_INVOICE = [
  "Received: from mail.vandijk-installatie.nl by mx.cloudflare.net; Sun, 16 Aug 2026 09:20:02 +0000",
  "Authentication-Results: mx.cloudflare.net; dkim=pass header.d=vandijk-installatie.nl;",
  " spf=pass smtp.mailfrom=vandijk-installatie.nl; dmarc=pass header.from=vandijk-installatie.nl",
  "From: Van Dijk Installatietechniek <facturen@vandijk-installatie.nl>",
  "To: alexander-7f3a@invoices.lavega.dev",
  "Subject: =?UTF-8?Q?Factuur_2026-0207_=E2=80=94_meterkast?=",
  "Date: Sun, 16 Aug 2026 11:20:00 +0200",
  "Message-ID: <2026-0207.factuur@vandijk-installatie.nl>",
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
  "--binnen-2b70",
  'Content-Type: text/html; charset="utf-8"',
  "Content-Transfer-Encoding: quoted-printable",
  "",
  "<html><body><p>Beste Alexander,</p>",
  "<table>",
  "<tr><td>Factuurnummer</td><td>2026-0207</td></tr>",
  "<tr><td>Subtotaal</td><td>EUR 800,00</td></tr>",
  "<tr><td>Btw 21%</td><td>EUR 168,00</td></tr>",
  "<tr><td>Totaal te voldoen</td><td>EUR 968,00</td></tr>",
  "</table>",
  "<p>Van Dijk Installatietechniek BV &middot; KvK 24398211</p>",
  "</body></html>",
  "",
  "--binnen-2b70--",
  "",
  "--buiten-84f1",
  'Content-Type: image/png; name="logo.png"',
  "Content-Transfer-Encoding: base64",
  'Content-Disposition: inline; filename="logo.png"',
  "",
  PNG_BASE64_LINES,
  "",
  "--buiten-84f1",
  "Content-Type: application/pdf",
  "Content-Transfer-Encoding: base64",
  "Content-Disposition: attachment; filename*=UTF-8''factuur%20augustus%202026.pdf",
  "",
  PDF_BASE64_LINES,
  "",
  "--buiten-84f1--",
  "",
].join("\r\n");

/** B — de hele factuur in de HTML, geen text/plain-deel. De gewoonste vorm. */
export const RAW_HTML_ONLY = [
  "Authentication-Results: mx.cloudflare.net; dkim=pass header.d=fastned.nl; spf=pass smtp.mailfrom=fastned.nl; dmarc=pass header.from=fastned.nl",
  "From: Fastned B.V. <facturatie@fastned.nl>",
  "To: alexander-7f3a@invoices.lavega.dev",
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
  "<html><body><h1>Uw factuur van augustus 2026</h1>",
  "<table>",
  "<tr><td>Laadsessies (14 stuks, 218 kWh)</td><td>EUR 137,34</td></tr>",
  "<tr><td>Btw 21%</td><td>EUR 31,36</td></tr>",
  "<tr><td>Totaalbedrag</td><td>EUR 180,69</td></tr>",
  "</table>",
  "<p>Factuurnummer FN-2026-08-8831, ge=C3=AFncasseerd op 22 augustus.</p>",
  "</body></html>",
  "",
  "--fn-9911--",
  "",
].join("\r\n");

/** C — één platte tekst, geen bijlage, geen multipart. De simpelste vorm die er
 *  is, en precies daarom de vorm die een parser stil kan verminken. */
export const RAW_PLAIN_TEXT = [
  "Authentication-Results: mx.cloudflare.net; spf=pass smtp.mailfrom=hostingnoord.nl; dkim=none; dmarc=none",
  "From: Hosting Noord <facturen@hostingnoord.nl>",
  "To: alexander-7f3a@invoices.lavega.dev",
  "Subject: Factuur HN-2026-4412",
  "Date: Mon, 17 Aug 2026 08:04:11 +0200",
  "Message-ID: <hn-2026-4412@hostingnoord.nl>",
  "MIME-Version: 1.0",
  'Content-Type: text/plain; charset="utf-8"',
  "Content-Transfer-Encoding: 8bit",
  "",
  "Beste klant,",
  "",
  "Hierbij factuur HN-2026-4412. Vervaldatum 31 augustus 2026.",
  "Webhosting Pro, 12 maanden: EUR 240,00. Btw 21%: EUR 50,40.",
  "Totaal te voldoen: EUR 290,40.",
  "",
  "10 < 12 maanden looptijd is niet mogelijk.",
  "",
].join("\r\n");

/** D — een gescande bon als afbeelding, geen tekst, geen PDF. Bestaat echt, en
 *  mag niet stil verdwijnen. */
export const RAW_IMAGE_ONLY = [
  "From: Kantoorboekhandel Smit <info@smit-kantoor.nl>",
  "To: alexander-7f3a@invoices.lavega.dev",
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
  PNG_BASE64_LINES,
  "",
  "--smit-77--",
  "",
].join("\r\n");

/** E — een afzender die SPF en DKIM niet haalt. Wordt gemarkeerd, niet geweerd. */
export const RAW_SPOOFED = [
  "Authentication-Results: mx.cloudflare.net; dkim=fail header.d=ing.nl; spf=softfail smtp.mailfrom=ing.nl; dmarc=fail header.from=ing.nl",
  "From: ING Bank <facturen@ing.nl>",
  "To: alexander-7f3a@invoices.lavega.dev",
  "Subject: Openstaande factuur - direct betalen",
  "Date: Sun, 16 Aug 2026 03:11:00 +0200",
  "Message-ID: <nep-1@elders.example>",
  "MIME-Version: 1.0",
  'Content-Type: text/plain; charset="utf-8"',
  "",
  "U heeft een openstaande factuur van EUR 4.200,00. Betaal binnen 24 uur op",
  "rekening NL00 XXXX 0000 0000 00 om kosten te voorkomen.",
  "",
].join("\r\n");
