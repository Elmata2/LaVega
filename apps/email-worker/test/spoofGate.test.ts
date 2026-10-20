/* Wat de lokale spoof-poort weigert. Cloudflare meet SPF/DKIM/DMARC bij
 * SMTP-ingang, maar geeft die uitslag niet aan de Worker (authResults.ts).
 * Deze poort kijkt daarom niet naar authenticatie-uitkomsten, maar naar dingen
 * die zonder meting al onwaar zijn: een From-regel die onze eigen dienst claimt
 * terwijl de envelop ergens anders vandaan komt, een lege envelop-afzender die
 * geen bounce is, en een adres waar geen bruikbaar domein uit komt.
 *
 * De hoofdzaak die deze poort NIET mag raken, staat er meteen bij: een
 * doorgestuurde factuur heeft bijna altijd een envelop-domein dat van het
 * From-domein verschilt.
 */

import { expect, test } from "vitest";
import { handleInboundEmail } from "../src/handler.js";
import { fakeFetch, fakeMessage } from "./fakeMessage.js";
import { RAW_FORWARDED_INVOICE, RAW_PLAIN_TEXT } from "./rawMail.js";

const ENV = {
  N8N_WEBHOOK_URL: "https://n8n.example/webhook/lavega-mail-in",
  N8N_SHARED_SECRET: "geheim-123",
};
const QUEUED = { addedInvoices: 1, addedNotices: 0, inQueue: 1, noticesInQueue: 0 };

/** Een mail die zegt dat hij van LaVega komt, maar van buiten is verstuurd. */
const RAW_CLAIMS_LAVEGA = [
  "From: LaVega Facturen <facturen@invoices.lavega.dev>",
  "To: alexander-7f3a@invoices.lavega.dev",
  "Subject: Nieuwe factuur, betaal binnen 24 uur",
  "Message-ID: <nep-lavega@elders.example>",
  "MIME-Version: 1.0",
  'Content-Type: text/plain; charset="utf-8"',
  "",
  "Betaal EUR 1.200,00 op rekening NL00 XXXX 0000 0000 00.",
  "",
].join("\r\n");

test("een mail die zich voordoet als LaVega zelf gaat niet naar de wachtrij", async () => {
  const message = fakeMessage({ raw: RAW_CLAIMS_LAVEGA, from: "nep@elders.example" });
  const http = fakeFetch({ body: QUEUED });

  const verdict = await handleInboundEmail(message, ENV, { fetch: http.fetch });

  expect(verdict.kind).toBe("reject");
  expect(verdict.kind === "reject" && verdict.reason).toContain("invoices.lavega.dev");
  expect(http.calls).toEqual([]);
});

test("een doorgestuurde factuur vanaf Gmail (ander envelop-domein) blijft werken", async () => {
  // De Gmail-gebruiker stuurt door: MAIL FROM is gmail.com, From is de
  // leverancier. Dit is de gewoonste vorm van dit product en de poort mag hem
  // niet als "domeinen verschillen" afkeuren.
  const message = fakeMessage({ raw: RAW_FORWARDED_INVOICE, from: "jan.deVries@gmail.com" });
  const http = fakeFetch({ body: QUEUED });

  const verdict = await handleInboundEmail(message, ENV, { fetch: http.fetch });

  expect(verdict.kind).toBe("queued");
  expect(http.calls).toHaveLength(1);
  expect((http.calls[0].body as Record<string, unknown>).queueKey).toBe("alexander-7f3a");
});

test("een gewone leveranciersmail zonder doorsturen blijft werken", async () => {
  const message = fakeMessage({ raw: RAW_PLAIN_TEXT, from: "facturen@hostingnoord.nl" });
  const http = fakeFetch({ body: QUEUED });

  const verdict = await handleInboundEmail(message, ENV, { fetch: http.fetch });

  expect(verdict.kind).toBe("queued");
});
