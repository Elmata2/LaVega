/* Het naadje: wat de Worker POST, moet zijn wat packages/core verwacht.
 *
 * Dit is de test die voorkomt dat de twee kanten los van elkaar goed zijn en
 * samen niets doen. Zonder deze test zou een omgedoopt veld — `to` → `address`,
 * `auth` → `authResults` — aan beide zijden groen blijven, en pas bij de eerste
 * echte factuur blijken doordat er een lege regel in de wachtrij staat.
 *
 * De import gaat met een RELATIEF PAD naar packages/core en niet via
 * `@lavega/core`, en dat is opzet: apps/email-worker heeft nul afhankelijkheden
 * (zie wrangler.toml en src/types.d.ts) zodat er niets meeloopt in het pad dat
 * een factuur draagt. Deze ene testregel is de prijs daarvan.
 */

import { expect, test } from "vitest";
import { buildPayload, SECRET_HEADER } from "../src/handler.js";
import { parseMail } from "../src/parseMail.js";
import { fakeMessage } from "./fakeMessage.js";
import { RAW_HTML_ONLY, RAW_IMAGE_ONLY, RAW_PDF_INVOICE, RAW_PLAIN_TEXT, RAW_SPOOFED } from "./rawMail.js";
import { normalizeInboundMail } from "../../../packages/core/src/n8n/normalizeInboundMail.js";
import { TOKEN_HEADER } from "../../web/src/n8n-provision.js";

function through(raw: string) {
  const message = fakeMessage({ raw });
  return normalizeInboundMail(buildPayload(message, parseMail(raw)));
}

test("platte tekst: van ruwe mail tot genormaliseerd bericht, in één keer", () => {
  const m = through(RAW_PLAIN_TEXT);
  expect(m.source).toBe("inbound-mail");
  expect(m.ok).toBe(true);
  expect(m.textSource).toBe("text");
  expect(m.text).toContain("290,40");
  expect(m.text).toContain("10 < 12 maanden");
  expect(m.deliveredTo).toBe("alexander-7f3a@invoices.lavega.dev");
  expect(m.queueKey).toBe("alexander-7f3a");
  expect(m.senderChecks).toEqual({ spf: "pass", dkim: "none", dmarc: "none" });
  expect(m.senderCheck).toBe("passed");
});

test("alleen HTML: de Worker stuurt de HTML rauw mee, core maakt er tekst van", () => {
  const m = through(RAW_HTML_ONLY);
  expect(m.ok).toBe(true);
  expect(m.textSource).toBe("html");
  expect(m.text).toContain("180,69");
  expect(m.text).toContain("geïncasseerd");
  expect(m.text).not.toContain("<table>");
});

test("met PDF: het logo valt af, de factuur gaat mee, de base64 is onaangeroerd", () => {
  const m = through(RAW_PDF_INVOICE);
  expect(m.ok).toBe(true);
  expect(m.pdfs.map((p) => p.name)).toEqual(["factuur augustus 2026.pdf"]);
  expect(m.skipped).toEqual([]);
  // De grootte die core berekent uit de base64 moet de echte PDF-grootte zijn.
  expect(m.pdfs[0].bytes).toBe(parseMail(RAW_PDF_INVOICE).attachments[1].bytes);
  // Het onderwerp is door RFC 2047 heen gekomen en staat nu in het bericht.
  expect(m.subject).toBe("Factuur 2026-0207 — meterkast");
});

test("een gescande afbeelding levert een melding met een uitvoerbare instructie", () => {
  const m = through(RAW_IMAGE_ONLY);
  expect(m.ok).toBe(false);
  expect(m.reason).toContain("geen enkele een PDF");
  expect(m.reason).toContain("stuur de PDF door");
});

test("een gezakte afzender komt door tot in het bericht, gemarkeerd", () => {
  const m = through(RAW_SPOOFED);
  expect(m.senderCheck).toBe("failed");
  expect(m.senderChecks).toEqual({ spf: "softfail", dkim: "fail", dmarc: "fail" });
  expect(m.ok).toBe(true);
});

test("elke sleutel die de Worker stuurt is een sleutel die core leest, en omgekeerd", () => {
  const payload = buildPayload(fakeMessage({ raw: RAW_PDF_INVOICE }), parseMail(RAW_PDF_INVOICE));
  expect(Object.keys(payload).sort()).toEqual(
    ["attachments", "auth", "date", "from", "html", "messageId", "queueKey", "subject", "text", "to"].sort(),
  );
  expect(Object.keys(payload.attachments[0]).sort()).toEqual(["data", "fileName", "mimeType"]);

  // En de andere kant op: geen enkel veld dat core meestuurt is leeg gebleven
  // doordat de Worker het anders noemt.
  const m = normalizeInboundMail(payload);
  for (const [field, value] of Object.entries({
    messageId: m.messageId,
    subject: m.subject,
    from: m.from,
    date: m.date,
    deliveredTo: m.deliveredTo,
    queueKey: m.queueKey,
  })) {
    expect(value, field + " kwam leeg door de normalisatie").not.toBe("");
  }
});

test("the Worker's header name matches what LaVega binds on the n8n webhook", () => {
  // Both webhook nodes share one Header Auth credential, because n8n refuses to
  // activate a workflow whose node lacks a credential it declares. One
  // credential means one header name, so these two constants must agree — they
  // did not, and every forwarded invoice would have been rejected by n8n while
  // the bounce blamed the wrong header.
  expect(SECRET_HEADER).toBe(TOKEN_HEADER);
});
