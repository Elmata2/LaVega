import { expect, test } from "vitest";
import {
  MAX_MESSAGE_BYTES,
  MAX_PDFS,
  MAX_PDF_BYTES,
  SECRET_HEADER,
  applyVerdict,
  buildPayload,
  checkAttachmentCaps,
  handleInboundEmail,
} from "../src/handler.js";
import { parseMail } from "../src/parseMail.js";
import { fakeFetch, fakeMessage } from "./fakeMessage.js";
import { RAW_IMAGE_ONLY, RAW_PDF_INVOICE, RAW_PLAIN_TEXT, RAW_SPOOFED } from "./rawMail.js";

const ENV = {
  N8N_WEBHOOK_URL: "https://n8n.example/webhook/lavega-mail-in",
  N8N_SHARED_SECRET: "geheim-123",
};
const QUEUED = { addedInvoices: 1, addedNotices: 0, inQueue: 1, noticesInQueue: 0, remembered: 1 };

/* ── De goede weg ─────────────────────────────────────────────────────────── */

test("een factuur met PDF gaat naar de webhook, met het geheim en de wachtrijsleutel", async () => {
  const message = fakeMessage({ raw: RAW_PDF_INVOICE });
  const http = fakeFetch({ body: QUEUED });

  const verdict = await handleInboundEmail(message, ENV, { fetch: http.fetch });

  expect(verdict.kind).toBe("queued");
  expect(http.calls).toHaveLength(1);
  expect(http.calls[0].url).toBe(ENV.N8N_WEBHOOK_URL);
  expect(http.calls[0].headers[SECRET_HEADER]).toBe("geheim-123");
  expect(http.calls[0].headers["content-type"]).toBe("application/json");

  const payload = http.calls[0].body as Record<string, unknown>;
  expect(payload.queueKey).toBe("alexander-7f3a");
  expect(payload.to).toBe("alexander-7f3a@invoices.lavega.dev");
  expect(payload.subject).toBe("Factuur 2026-0207 — meterkast");
  expect(payload.auth).toEqual({ spf: "pass", dkim: "pass", dmarc: "pass" });
  expect((payload.attachments as unknown[]).length).toBe(2);
});

test("een geslaagde mail wordt NIET geweigerd en er wordt niet geantwoord", async () => {
  const message = fakeMessage({ raw: RAW_PLAIN_TEXT });
  const http = fakeFetch({ body: QUEUED });
  await applyVerdict(message, await handleInboundEmail(message, ENV, { fetch: http.fetch }), {
    fetch: http.fetch,
  });
  expect(message.rejected).toEqual([]);
  expect(message.replied).toEqual([]);
});

test("een afzender die SPF/DKIM niet haalt gaat er WEL door, gemarkeerd", async () => {
  const message = fakeMessage({ raw: RAW_SPOOFED, from: "nep@elders.example" });
  const http = fakeFetch({ body: { ...QUEUED, addedNotices: 1 } });

  const verdict = await handleInboundEmail(message, ENV, { fetch: http.fetch });

  expect(verdict.kind).toBe("queued");
  expect((http.calls[0].body as Record<string, unknown>).auth).toEqual({
    spf: "softfail",
    dkim: "fail",
    dmarc: "fail",
  });
  // Wegfilteren zou betekenen dat een ECHTE factuur van een domein met een
  // slecht ingericht SPF-record verdwijnt zonder dat iemand het merkt.
  expect(message.rejected).toEqual([]);
});

/* ── Niets verdwijnt: elke fout eindigt in een bounce met de oorzaak erin ── */

test("N8N_WEBHOOK_URL niet gezet: de bounce noemt die variabele bij naam", async () => {
  const message = fakeMessage({ raw: RAW_PLAIN_TEXT });
  const http = fakeFetch({ body: QUEUED });
  const verdict = await handleInboundEmail(
    message,
    { N8N_SHARED_SECRET: "x" },
    { fetch: http.fetch },
  );

  expect(verdict.kind).toBe("reject");
  expect(verdict.kind === "reject" && verdict.reason).toContain("N8N_WEBHOOK_URL");
  // En er is niets naar buiten gegaan.
  expect(http.calls).toEqual([]);
});

test("N8N_SHARED_SECRET niet gezet: idem, met het commando dat het oplost", async () => {
  const message = fakeMessage({ raw: RAW_PLAIN_TEXT });
  const verdict = await handleInboundEmail(
    message,
    { N8N_WEBHOOK_URL: ENV.N8N_WEBHOOK_URL },
    {
      fetch: fakeFetch({ body: QUEUED }).fetch,
    },
  );
  expect(verdict.kind === "reject" && verdict.reason).toContain("N8N_SHARED_SECRET");
  expect(verdict.kind === "reject" && verdict.reason).toContain("wrangler secret put");
});

test("een adres zonder lokaal deel wordt geweigerd, niet op een verzonnen sleutel gezet", async () => {
  const message = fakeMessage({ raw: RAW_PLAIN_TEXT, to: "invoices.lavega.dev" });
  const verdict = await handleInboundEmail(message, ENV, {
    fetch: fakeFetch({ body: QUEUED }).fetch,
  });
  expect(verdict.kind === "reject" && verdict.reason).toContain("geen lokaal deel");
});

test("te groot bericht: geweigerd VÓÓR het parsen, met de twee getallen erin", async () => {
  const message = fakeMessage({ raw: RAW_PLAIN_TEXT, rawSize: MAX_MESSAGE_BYTES + 1 });
  const http = fakeFetch({ body: QUEUED });
  const verdict = await handleInboundEmail(message, ENV, { fetch: http.fetch });

  expect(verdict.kind).toBe("reject");
  expect(verdict.kind === "reject" && verdict.reason).toContain("17.0 MB");
  expect(http.calls).toEqual([]);
});

test("n8n onbereikbaar: bounce die zegt dat de mail NIET verwerkt is", async () => {
  const message = fakeMessage({ raw: RAW_PLAIN_TEXT });
  const verdict = await handleInboundEmail(message, ENV, {
    fetch: fakeFetch({ throws: "connect ECONNREFUSED" }).fetch,
  });
  expect(verdict.kind === "reject" && verdict.reason).toContain("ECONNREFUSED");
  expect(verdict.kind === "reject" && verdict.reason).toContain("NIET verwerkt");
});

test("401 van n8n: de bounce noemt het geheim en de header, niet 'er ging iets mis'", async () => {
  const message = fakeMessage({ raw: RAW_PLAIN_TEXT });
  const verdict = await handleInboundEmail(message, ENV, {
    fetch: fakeFetch({ status: 401 }).fetch,
  });
  expect(verdict.kind === "reject" && verdict.reason).toContain("N8N_SHARED_SECRET");
  expect(verdict.kind === "reject" && verdict.reason).toContain(SECRET_HEADER);
});

test("404 van n8n: de bounce noemt de twee echte oorzaken", async () => {
  const message = fakeMessage({ raw: RAW_PLAIN_TEXT });
  const verdict = await handleInboundEmail(message, ENV, {
    fetch: fakeFetch({ status: 404 }).fetch,
  });
  expect(verdict.kind === "reject" && verdict.reason).toContain("niet op Actief");
  expect(verdict.kind === "reject" && verdict.reason).toContain("production-URL");
});

test("500 van n8n: status én het begin van het antwoord staan in de bounce", async () => {
  const message = fakeMessage({ raw: RAW_PLAIN_TEXT });
  const verdict = await handleInboundEmail(message, ENV, {
    fetch: fakeFetch({ status: 500, text: "Alle modelaanroepen mislukten: invalid x-api-key" })
      .fetch,
  });
  expect(verdict.kind === "reject" && verdict.reason).toContain("500");
  expect(verdict.kind === "reject" && verdict.reason).toContain("invalid x-api-key");
  expect(verdict.kind === "reject" && verdict.reason).toContain("Executions");
});

test("een 200 zonder JSON is geen succes", async () => {
  const message = fakeMessage({ raw: RAW_PLAIN_TEXT });
  const verdict = await handleInboundEmail(message, ENV, {
    fetch: fakeFetch({ status: 200, text: "OK" }).fetch,
  });
  expect(verdict.kind === "reject" && verdict.reason).toContain("geen JSON");
  expect(verdict.kind === "reject" && verdict.reason).toContain("Last Node");
});

test("een 200 zonder de telling wordt GEEN nul: onbekend is onbekend", async () => {
  const message = fakeMessage({ raw: RAW_PLAIN_TEXT });
  const verdict = await handleInboundEmail(message, ENV, {
    fetch: fakeFetch({ status: 200, body: { message: "Workflow was started" } }).fetch,
  });
  expect(verdict.kind).toBe("reject");
  expect(verdict.kind === "reject" && verdict.reason).toContain("addedInvoices");
  expect(verdict.kind === "reject" && verdict.reason).toContain("onbekend");
});

test("verwerkt maar niets toegevoegd: een ANTWOORD, geen stilte en geen bounce", async () => {
  const message = fakeMessage({ raw: RAW_IMAGE_ONLY });
  const verdict = await handleInboundEmail(message, ENV, {
    fetch: fakeFetch({ body: { addedInvoices: 0, addedNotices: 0, inQueue: 0, noticesInQueue: 0 } })
      .fetch,
  });

  expect(verdict.kind).toBe("reply");
  expect(verdict.kind === "reply" && verdict.body).toContain("niets aan de wachtrij toegevoegd");
  expect(verdict.kind === "reply" && verdict.inReplyTo).toBe("<scan-20260812-2@smit-kantoor.nl>");
});

/* ── Het oordeel uitvoeren ────────────────────────────────────────────────── */

test("applyVerdict: een reply wordt een reply, met From = het ontvangende adres", async () => {
  const message = fakeMessage({ raw: RAW_PLAIN_TEXT });
  const seen: { from: string; to: string; raw: string }[] = [];
  await applyVerdict(
    message,
    { kind: "reply", body: "Niets toegevoegd.", subject: "Factuur", inReplyTo: "<a@b.nl>" },
    {
      fetch: fakeFetch({ body: QUEUED }).fetch,
      makeReply: (from, to, raw) => {
        seen.push({ from, to, raw });
        return { from, to, raw };
      },
    },
  );
  expect(message.rejected).toEqual([]);
  expect(message.replied).toHaveLength(1);
  expect(seen[0].from).toBe("alexander-7f3a@invoices.lavega.dev");
  expect(seen[0].to).toBe("facturen@hostingnoord.nl");
  expect(seen[0].raw).toContain("In-Reply-To: <a@b.nl>");
});

test("applyVerdict: geen Message-ID om op te antwoorden → bounce, nooit stilte", async () => {
  const message = fakeMessage({ raw: RAW_PLAIN_TEXT });
  await applyVerdict(
    message,
    { kind: "reply", body: "Niets toegevoegd.", subject: "Factuur", inReplyTo: "" },
    { fetch: fakeFetch({ body: QUEUED }).fetch, makeReply: (from, to, raw) => ({ from, to, raw }) },
  );
  expect(message.replied).toEqual([]);
  expect(message.rejected).toHaveLength(1);
  expect(message.rejected[0]).toContain("geen Message-ID");
});

test("applyVerdict: een antwoord dat Cloudflare weigert wordt een bounce, met beide redenen", async () => {
  const message = fakeMessage({ raw: RAW_PLAIN_TEXT, replyThrows: "could not send reply" });
  await applyVerdict(
    message,
    { kind: "reply", body: "Niets toegevoegd.", subject: "Factuur", inReplyTo: "<a@b.nl>" },
    { fetch: fakeFetch({ body: QUEUED }).fetch, makeReply: (from, to, raw) => ({ from, to, raw }) },
  );
  expect(message.rejected).toHaveLength(1);
  expect(message.rejected[0]).toContain("Niets toegevoegd.");
  expect(message.rejected[0]).toContain("could not send reply");
});

test("applyVerdict: een bounce wordt afgekapt op 400 tekens, want dat gaat een SMTP-regel in", async () => {
  const message = fakeMessage({ raw: RAW_PLAIN_TEXT });
  await applyVerdict(
    message,
    { kind: "reject", reason: "x".repeat(900) },
    {
      fetch: fakeFetch({ body: QUEUED }).fetch,
    },
  );
  expect(message.rejected[0].length).toBeLessThanOrEqual(401);
});

/* ── De bijlage-limieten ──────────────────────────────────────────────────── */

test("checkAttachmentCaps: een PDF boven 4 MB wordt geweigerd MET zijn bestandsnaam", () => {
  const mail = parseMail(RAW_PLAIN_TEXT);
  mail.attachments = [
    {
      fileName: "jaarrekening 2025.pdf",
      mimeType: "application/pdf",
      data: "",
      bytes: MAX_PDF_BYTES + 1,
    },
  ];
  const problem = checkAttachmentCaps(mail);
  expect(problem).toContain("jaarrekening 2025.pdf");
  expect(problem).toContain("4.0 MB");
});

test("checkAttachmentCaps: meer dan drie PDF's wordt geweigerd, niet stil ingekort", () => {
  const mail = parseMail(RAW_PLAIN_TEXT);
  mail.attachments = [1, 2, 3, 4].map((n) => ({
    fileName: "f" + n + ".pdf",
    mimeType: "application/pdf",
    data: "",
    bytes: 100,
  }));
  expect(checkAttachmentCaps(mail)).toContain("4 PDF-bijlagen");
  expect(checkAttachmentCaps(mail)).toContain("de grens is " + MAX_PDFS);
});

test("checkAttachmentCaps: logo's tellen niet mee, alleen PDF's", () => {
  const mail = parseMail(RAW_PLAIN_TEXT);
  mail.attachments = [1, 2, 3, 4, 5].map((n) => ({
    fileName: "logo" + n + ".png",
    mimeType: "image/png",
    data: "",
    bytes: 100,
  }));
  expect(checkAttachmentCaps(mail)).toBeNull();
});

test("een te grote PDF komt niet bij n8n aan en levert een bounce met de naam op", async () => {
  const big = "A".repeat(Math.ceil(((MAX_PDF_BYTES + 1024) * 4) / 3));
  const raw = [
    "From: leverancier@voorbeeld.nl",
    "To: alexander-7f3a@invoices.lavega.dev",
    "Subject: Grote factuur",
    "Message-ID: <groot@voorbeeld.nl>",
    'Content-Type: multipart/mixed; boundary="b"',
    "",
    "--b",
    'Content-Type: application/pdf; name="scan.pdf"',
    "Content-Transfer-Encoding: base64",
    "",
    big,
    "--b--",
    "",
  ].join("\r\n");

  const message = fakeMessage({ raw });
  const http = fakeFetch({ body: QUEUED });
  const verdict = await handleInboundEmail(message, ENV, { fetch: http.fetch });

  expect(verdict.kind).toBe("reject");
  expect(verdict.kind === "reject" && verdict.reason).toContain("scan.pdf");
  expect(http.calls).toEqual([]);
});

test("buildPayload gebruikt de From:-header en valt terug op de envelop-afzender", () => {
  const withHeader = fakeMessage({ raw: RAW_PLAIN_TEXT, from: "envelop@voorbeeld.nl" });
  expect(buildPayload(withHeader, parseMail(RAW_PLAIN_TEXT)).from).toBe(
    "Hosting Noord <facturen@hostingnoord.nl>",
  );

  const zonderHeader = fakeMessage({
    raw: "Subject: x\r\n\r\ntekst",
    from: "envelop@voorbeeld.nl",
  });
  expect(buildPayload(zonderHeader, parseMail("Subject: x\r\n\r\ntekst")).from).toBe(
    "envelop@voorbeeld.nl",
  );
});
