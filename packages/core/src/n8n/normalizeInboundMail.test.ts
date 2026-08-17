import { expect, test } from "vitest";
import {
  normalizeInboundMail,
  readAuthResult,
  readSenderChecks,
  senderCheckOf,
} from "./normalizeInboundMail.js";
import { normalizeGmailMessage } from "./normalizeGmailMessage.js";
import {
  INBOUND_HTML_ONLY,
  INBOUND_PLAIN_TEXT,
  INBOUND_STORAGE_REFERENCE,
  INBOUND_WITH_PDF,
  PDF_BASE64,
} from "./__fixtures__/inboundPayload.js";

test("1 — platte tekst: de hele factuur staat in text/plain en die wint", () => {
  const m = normalizeInboundMail(INBOUND_PLAIN_TEXT);
  expect(m.source).toBe("inbound-mail");
  expect(m.ok).toBe(true);
  expect(m.textSource).toBe("text");
  expect(m.text).toContain("290,40");
  expect(m.text).toContain("HN-2026-4412");
  expect(m.pdfs).toEqual([]);
  expect(m.skipped).toEqual([]);
  expect(m.reason).toBe("");
});

test("2 — alleen HTML: de tekst komt uit de HTML, precies zoals bij Gmail", () => {
  const m = normalizeInboundMail(INBOUND_HTML_ONLY);
  expect(m.ok).toBe(true);
  expect(m.textSource).toBe("html");
  expect(m.text).toContain("180,69");
  expect(m.text).toContain("FN-2026-08-8831");
  // Geen tags meer over: het model krijgt leesbare tekst, geen opmaak.
  expect(m.text).not.toContain("<td>");
});

test("2 — dezelfde HTML levert via de Gmail-tak dezelfde tekst op: één normalisatie, twee enveloppen", () => {
  const inbound = normalizeInboundMail(INBOUND_HTML_ONLY);
  const gmail = normalizeGmailMessage({ id: "g-1", html: INBOUND_HTML_ONLY.html }, []);
  expect(inbound.text).toBe(gmail.text);
  expect(inbound.textSource).toBe(gmail.textSource);
});

test("3 — met PDF: alleen de PDF gaat mee, het logo niet, en de volgorde doet er niet toe", () => {
  const m = normalizeInboundMail(INBOUND_WITH_PDF);
  expect(m.ok).toBe(true);
  expect(m.pdfs.map((p) => p.name)).toEqual(["factuur-2026-0207.pdf"]);
  expect(m.pdfs[0].data).toBe(PDF_BASE64);
  expect(m.pdfs[0].bytes).toBeGreaterThan(100);
  expect(m.skipped).toEqual([]);
});

test("4 — een opslagverwijzing wordt geweigerd, met een reden die naar de Worker wijst", () => {
  const m = normalizeInboundMail(INBOUND_STORAGE_REFERENCE);
  expect(m.pdfs).toEqual([]);
  expect(m.skipped).toHaveLength(1);
  expect(m.skipped[0]).toContain("geen base64");
  // De Gmail-reden noemt N8N_DEFAULT_BINARY_DATA_MODE. Die instelling heeft met
  // dit pad NIETS te maken, en hem hier noemen zou hem naar de verkeerde knop
  // sturen.
  expect(m.skipped[0]).toContain("Worker");
  expect(m.skipped[0]).not.toContain("N8N_DEFAULT_BINARY_DATA_MODE");
  // En hij verdwijnt niet: te weinig tekst + geweigerde bijlage = een melding,
  // met de reden erbij.
  expect(m.ok).toBe(false);
  expect(m.reason).toContain("de bijlage ging niet mee");
  expect(m.reason).toContain("factuur.pdf");
});

test("de Gmail-tak blijft zijn eigen reden houden bij een verwijzing", () => {
  const gmail = normalizeGmailMessage({ id: "g-ref" }, [
    {
      key: "attachment_0",
      fileName: "factuur.pdf",
      mimeType: "application/pdf",
      data: "filesystem-v2:workflows/abc/executions/123/binary_data/xyz",
    },
  ]);
  expect(gmail.skipped[0]).toContain("N8N_DEFAULT_BINARY_DATA_MODE");
});

test("herkomst reist mee: op welk adres hij binnenkwam en wie hem stuurde", () => {
  const m = normalizeInboundMail(INBOUND_WITH_PDF);
  expect(m.deliveredTo).toBe("alexander-7f3a@invoices.lavega.dev");
  expect(m.queueKey).toBe("alexander-7f3a");
  expect(m.from).toBe("Van Dijk Installatietechniek <facturen@vandijk-installatie.nl>");
});

test("een afzender die zakt wordt GEMARKEERD, niet weggegooid", () => {
  const m = normalizeInboundMail({ ...INBOUND_PLAIN_TEXT, auth: { spf: "fail", dkim: "none", dmarc: "fail" } });
  expect(m.senderCheck).toBe("failed");
  expect(m.senderChecks).toEqual({ spf: "fail", dkim: "none", dmarc: "fail" });
  // Nog steeds leesbaar, dus hij gaat gewoon naar het model. Wegfilteren zou
  // betekenen dat een echte factuur kan verdwijnen zonder dat iemand het merkt.
  expect(m.ok).toBe(true);
});

test("geen auth-header betekent 'unknown', nooit 'pass'", () => {
  const { auth: _auth, ...zonder } = INBOUND_PLAIN_TEXT;
  const m = normalizeInboundMail(zonder);
  expect(m.senderChecks).toEqual({ spf: "unknown", dkim: "unknown", dmarc: "unknown" });
  expect(m.senderCheck).toBe("unknown");
});

test("readAuthResult kent alleen de RFC-uitslagen; de rest is unknown", () => {
  expect(readAuthResult("PASS")).toBe("pass");
  expect(readAuthResult(" softfail ")).toBe("softfail");
  expect(readAuthResult("ja hoor")).toBe("unknown");
  expect(readAuthResult(undefined)).toBe("unknown");
  expect(readAuthResult(true)).toBe("unknown");
});

test("readSenderChecks maakt van een kapot object drie keer unknown", () => {
  expect(readSenderChecks(null)).toEqual({ spf: "unknown", dkim: "unknown", dmarc: "unknown" });
  expect(readSenderChecks({ spf: "pass" })).toEqual({ spf: "pass", dkim: "unknown", dmarc: "unknown" });
});

test("senderCheckOf: 'passed' vereist een echte pass, niet de afwezigheid van een fail", () => {
  expect(senderCheckOf({ spf: "pass", dkim: "pass", dmarc: "pass" })).toBe("passed");
  expect(senderCheckOf({ spf: "pass", dkim: "none", dmarc: "none" })).toBe("passed");
  expect(senderCheckOf({ spf: "none", dkim: "none", dmarc: "none" })).toBe("unknown");
  expect(senderCheckOf({ spf: "unknown", dkim: "unknown", dmarc: "unknown" })).toBe("unknown");
  expect(senderCheckOf({ spf: "temperror", dkim: "none", dmarc: "none" })).toBe("unknown");
  // Eén zakker is genoeg, ook als de rest slaagt.
  expect(senderCheckOf({ spf: "pass", dkim: "fail", dmarc: "pass" })).toBe("failed");
  expect(senderCheckOf({ spf: "softfail", dkim: "pass", dmarc: "pass" })).toBe("failed");
});

test("de PDF-limieten van de Gmail-tak gelden hier onverkort", () => {
  const tooBig = "A".repeat(Math.ceil((5 * 1024 * 1024 * 4) / 3));
  const m = normalizeInboundMail({
    ...INBOUND_WITH_PDF,
    attachments: [{ fileName: "jaarrekening.pdf", mimeType: "application/pdf", data: tooBig }],
  });
  expect(m.pdfs).toEqual([]);
  expect(m.skipped[0]).toContain("groter dan de limiet van 4 MB");

  const many = [1, 2, 3, 4, 5].map((n) => ({
    fileName: "bijlage-" + n + ".pdf",
    mimeType: "application/pdf",
    data: "QQ==",
  }));
  const m2 = normalizeInboundMail({ ...INBOUND_WITH_PDF, attachments: many });
  expect(m2.pdfs).toHaveLength(3);
  expect(m2.skipped).toHaveLength(2);
  expect(m2.skipped[0]).toContain("meer dan 3 PDF-bijlagen");
});

test("een lege bijlage-inhoud wijst naar de Worker, niet naar n8n", () => {
  const m = normalizeInboundMail({
    ...INBOUND_WITH_PDF,
    text: "",
    attachments: [{ fileName: "factuur.pdf", mimeType: "application/pdf", data: "" }],
  });
  expect(m.skipped[0]).toBe("factuur.pdf: de Worker stuurde geen inhoud mee voor deze bijlage");
});

test("alleen een gescande afbeelding: geen factuur, wél een reden die zegt wat hij moet doen", () => {
  const m = normalizeInboundMail({
    ...INBOUND_PLAIN_TEXT,
    text: "",
    html: "",
    attachments: [{ fileName: "scan.png", mimeType: "image/png", data: "QQ==" }],
  });
  expect(m.ok).toBe(false);
  expect(m.reason).toContain("geen enkele een PDF");
  expect(m.reason).toContain("stuur de PDF door");
});

test("helemaal niets erin levert geen stilte maar een reden op", () => {
  const m = normalizeInboundMail({});
  expect(m.ok).toBe(false);
  expect(m.reason).toBe("Geen leesbare tekst en geen bijlage in de doorgestuurde mail.");
  expect(m.messageId).toBe("");
  expect(m.deliveredTo).toBe("");
  expect(m.senderCheck).toBe("unknown");
});

test("een korte tekst zonder bijlage noemt het aantal tekens, niet 'geen factuur'", () => {
  const m = normalizeInboundMail({ ...INBOUND_PLAIN_TEXT, text: "Zie bijlage." });
  expect(m.ok).toBe(false);
  expect(m.reason).toBe("Maar 12 tekens tekst en geen PDF-bijlage in de doorgestuurde mail.");
});

test("een korte text/plain naast een lange HTML: de langste wint, net als bij Gmail", () => {
  const m = normalizeInboundMail({
    ...INBOUND_PLAIN_TEXT,
    text: "Bekijk uw factuur online.",
    html: "<p>Factuurnummer 99</p><p>Totaal EUR 240,00 inclusief 21% btw, te voldoen voor 1 september.</p>",
  });
  expect(m.textSource).toBe("html");
  expect(m.text).toContain("240,00");
});

test("bij gelijke lengte wint text/plain: '10 < 12' mag niet door een tagfilter", () => {
  const zelfde = "Verbruik was 10 < 12 kWh en het totaal is EUR 42,00 voor deze maand.";
  const m = normalizeInboundMail({ ...INBOUND_PLAIN_TEXT, text: zelfde, html: zelfde });
  expect(m.textSource).toBe("text");
  expect(m.text).toContain("10 < 12 kWh");
});
