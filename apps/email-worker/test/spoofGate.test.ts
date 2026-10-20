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
import {
  checkSpoofGate,
  isDeliveryStatusNotification,
  isPlausibleDomain,
  isServiceDomain,
} from "../src/spoofGate.js";
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

/* ── De poort zelf: vier benoemde weigeringen en de uitzonderingen ─────────── */

test("onze eigen dienst claimen vanaf een vreemde envelop is impersonatie", () => {
  const refusal = checkSpoofGate({
    envelopeFrom: "nep@elders.example",
    fromHeader: "LaVega <facturen@invoices.lavega.dev>",
    headers: {},
  });
  expect(refusal?.kind).toBe("service-impersonation");
  expect(refusal?.reason).toContain("invoices.lavega.dev");
  expect(refusal?.reason).toContain("nep@elders.example");
});

test("From en envelop die beide van LaVega zijn, zijn geen impersonatie", () => {
  expect(
    checkSpoofGate({
      envelopeFrom: "noreply@lavega.dev",
      fromHeader: "LaVega <facturen@lavega.dev>",
      headers: {},
    }),
  ).toBeNull();
});

test("een lege envelop zonder leveringsmelding wordt geweigerd", () => {
  const refusal = checkSpoofGate({
    envelopeFrom: "<>",
    fromHeader: "Leverancier <facturen@voorbeeld.nl>",
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
  expect(refusal?.kind).toBe("null-envelope-sender");
  expect(refusal?.reason).toContain("<>");
});

test("dezelfde lege envelop MET report-type=delivery-status mag door", async () => {
  const raw = [
    "From: Mail Delivery System <MAILER-DAEMON@mx.cloudflare.net>",
    "To: alexander-7f3a@invoices.lavega.dev",
    "Subject: Delivery Status Notification (Failure)",
    "Message-ID: <dsn-1@mx.cloudflare.net>",
    "MIME-Version: 1.0",
    'Content-Type: multipart/report; report-type=delivery-status; boundary="dsn"',
    "",
    "--dsn",
    'Content-Type: text/plain; charset="utf-8"',
    "",
    "Uw bericht kon niet worden afgeleverd.",
    "--dsn--",
    "",
  ].join("\r\n");
  const message = fakeMessage({ raw, from: "<>" });
  const http = fakeFetch({ body: { addedInvoices: 0, addedNotices: 1 } });

  expect(
    isDeliveryStatusNotification({
      "content-type": 'multipart/report; report-type="delivery-status"',
    }),
  ).toBe(true);
  const verdict = await handleInboundEmail(message, ENV, { fetch: http.fetch });

  expect(verdict.kind).toBe("queued");
});

test("een From-regel zonder bruikbaar domein wordt geweigerd", () => {
  const refusal = checkSpoofGate({
    envelopeFrom: "facturen@hostingnoord.nl",
    fromHeader: "Leverancier zonder adres",
    headers: {},
  });
  expect(refusal?.kind).toBe("unusable-from-domain");
});

test("een envelop-afzender zonder bruikbaar domein wordt geweigerd", () => {
  const refusal = checkSpoofGate({
    envelopeFrom: "nep",
    fromHeader: "Leverancier <facturen@voorbeeld.nl>",
    headers: {},
  });
  expect(refusal?.kind).toBe("unusable-envelope-domain");
  expect(refusal?.reason).toContain("nep");
});

test("de poort accepteert een doorgestuurde factuur: envelop gmail, From leverancier", () => {
  expect(
    checkSpoofGate({
      envelopeFrom: "jan@gmail.com",
      fromHeader: "Van Dijk <facturen@vandijk-installatie.nl>",
      headers: {},
    }),
  ).toBeNull();
});

test("isServiceDomain kent alleen lavega.dev en zijn subdomeinen", () => {
  expect(isServiceDomain("lavega.dev")).toBe(true);
  expect(isServiceDomain("invoices.lavega.dev")).toBe(true);
  expect(isServiceDomain("nep-lavega.dev")).toBe(false);
  expect(isServiceDomain("lavega.dev.elders.example")).toBe(false);
});

test("isPlausibleDomain: ruim voor echte domeinen, streng voor onzin", () => {
  expect(isPlausibleDomain("voorbeeld.nl")).toBe(true);
  expect(isPlausibleDomain("mail.vandijk-installatie.nl")).toBe(true);
  expect(isPlausibleDomain("xn--bcher-kva.example")).toBe(true);
  expect(isPlausibleDomain("")).toBe(false);
  expect(isPlausibleDomain("localhost")).toBe(false);
  expect(isPlausibleDomain("-voorbeeld.nl")).toBe(false);
  expect(isPlausibleDomain("voorbeeld..nl")).toBe(false);
  expect(isPlausibleDomain("voorbeeld.1")).toBe(false);
});
