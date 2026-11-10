import { expect, test } from "vitest";
import { normalizeGmailMessage } from "./normalizeGmailMessage.js";
import { buildClaudeRequest, requestSize } from "./buildClaudeRequest.js";
import {
  noticeForSetup,
  noticeForUnreadable,
  parseModelJson,
  toQueueEntry,
} from "./claudeToLaVega.js";
import { GMAIL_CONFIRMATION_PAYLOAD, EXPECTED_CODE } from "./__fixtures__/gmailConfirmation.test.fixture.js";
import { addToQueue, OWNER_KEY } from "./queue.js";
import { encodeBase64Url, simulateGmailNode } from "./__fixtures__/gmailNode.js";
import {
  RAW_HTML_ONLY,
  RAW_LINK_ONLY,
  RAW_NO_BODY,
  RAW_PDF_INVOICE,
} from "./__fixtures__/rawMail.js";
import { normalizeInboundMail } from "./normalizeInboundMail.js";
import { INBOUND_STORAGE_REFERENCE, INBOUND_WITH_PDF } from "./__fixtures__/inboundPayload.js";

/* Eén droogloop van de hele workflow op vier echte mailvormen, met het model
 * vervangen door een vast antwoord. Wat dit bewijst: de vier vormen komen alle
 * vier ergens uit — twee als factuur, twee als melding — en geen enkele
 * verdwijnt onderweg. Dat laatste was de fout.
 *
 * Wat dit NIET bewijst: dat n8n zich gedraagt zoals hier aangenomen. Dat kan
 * alleen een echte run in n8n. */

const MODEL_ANSWERS: Record<string, string> = {
  "m-pdf": JSON.stringify({
    isInvoice: true,
    kind: "invoice",
    invoiceNumber: "2026-0184",
    issueDate: "2026-08-13",
    dueDate: "2026-09-12",
    amount: 1815,
    vatAmount: 315,
    currency: "EUR",
    counterparty: "Van Dijk Installatietechniek BV",
    direction: "expense",
    note: "Factuur met PDF-bijlage.",
  }),
  "m-html": JSON.stringify({
    isInvoice: true,
    kind: "invoice",
    invoiceNumber: "FN-2026-08-8831",
    issueDate: "2026-08-15",
    dueDate: null,
    amount: 180.69,
    vatAmount: 31.36,
    currency: "EUR",
    counterparty: "Fastned B.V.",
    direction: "expense",
    note: "Automatische incasso op 22 augustus.",
  }),
  "m-link": JSON.stringify({
    isInvoice: false,
    kind: "notification",
    amount: null,
    note: "De factuur staat in MijnKPN; log zelf in om hem te downloaden.",
  }),
};

function run(raw: string, id: string) {
  const item = simulateGmailNode(encodeBase64Url(raw), { id, downloadAttachments: true });
  const attachments = Object.keys(item.binary).map((key) => ({
    key,
    fileName: item.binary[key].fileName,
    mimeType: item.binary[key].mimeType,
    data: item.binary[key].data,
  }));
  return normalizeGmailMessage(item.json, attachments);
}

test("vier mailvormen, vier uitkomsten, niets verdwijnt onderweg", () => {
  const messages = [
    run(RAW_PDF_INVOICE, "m-pdf"),
    run(RAW_HTML_ONLY, "m-html"),
    run(RAW_LINK_ONLY, "m-link"),
    run(RAW_NO_BODY, "m-leeg"),
  ];

  const invoices: unknown[] = [];
  const notices: unknown[] = [];
  const processedIds: string[] = [];
  const sent: { id: string; documents: number; textChars: number }[] = [];

  for (const message of messages) {
    if (!message.ok) {
      // De tak "Melding: zelf ophalen" van de If-node.
      notices.push(noticeForUnreadable({ ...message, reason: message.reason }));
      processedIds.push(message.messageId);
      continue;
    }
    const request = buildClaudeRequest(message);
    const size = requestSize(request);
    sent.push({ id: message.messageId, documents: size.documents, textChars: size.textChars });

    const entry = toQueueEntry(message, parseModelJson(MODEL_ANSWERS[message.messageId]));
    if (entry.invoice) invoices.push(entry.invoice);
    if (entry.notice) notices.push(entry.notice);
    processedIds.push(message.messageId);
  }

  // eslint-disable-next-line no-console
  console.log(
    "[droogloop] " +
      sent.map((s) => `${s.id}: ${s.documents} doc / ${s.textChars} tekens`).join(" · ") +
      ` · ${invoices.length} facturen, ${notices.length} meldingen`,
  );

  // Drie mails bereiken het model, één daarvan met de PDF erbij.
  expect(sent).toEqual([
    { id: "m-pdf", documents: 1, textChars: 733 },
    { id: "m-html", documents: 0, textChars: 659 },
    { id: "m-link", documents: 0, textChars: 304 },
  ]);

  const store: Record<string, unknown> = {};
  const result = addToQueue(
    store,
    { invoices, notices, processedIds } as never,
    "2026-08-17T08:00:00.000Z",
  );
  expect(result).toEqual({
    addedInvoices: 2,
    addedNotices: 2,
    inQueue: 2,
    noticesInQueue: 2,
    remembered: 4,
  });

  // Het antwoord aan LaVega, zoals "Geef de rij en leeg hem" het samenstelt.
  // Gmail-berichten dragen geen queueKey: ze horen bij de eigenaar (OWNER_KEY).
  const byKey = store.queueByKey as Record<string, unknown>;
  const noticesByKey = store.noticesByKey as Record<string, unknown>;
  const body = {
    invoices: byKey[OWNER_KEY],
    notices: noticesByKey[OWNER_KEY],
    servedAt: "2026-08-17T08:00:01.000Z",
  };
  expect((body.invoices as { amountCents: number }[]).map((i) => i.amountCents)).toEqual([
    181500, 18069,
  ]);
  expect((body.notices as { kind: string }[]).map((n) => n.kind)).toEqual([
    "notification",
    "unreadable",
  ]);
  // Geen enkele melding draagt een bedrag: er is niets om per ongeluk te boeken.
  for (const notice of body.notices as Record<string, unknown>[]) {
    expect("amount" in notice).toBe(false);
    expect("amountCents" in notice).toBe(false);
  }
});

test("een doorgestuurde mail loopt door precies hetzelfde pad en komt met herkomst in de rij", () => {
  const message = normalizeInboundMail(INBOUND_WITH_PDF);
  expect(message.ok).toBe(true);

  // Dezelfde twee nodes als bij Gmail — er is geen tweede pad.
  const request = buildClaudeRequest(message);
  const size = requestSize(request);
  expect(size.documents).toBe(1);
  expect(size.pdfBytes).toBeGreaterThan(100);

  const entry = toQueueEntry(message, {
    isInvoice: true,
    kind: "invoice",
    invoiceNumber: "2026-0207",
    amount: 968,
    currency: "EUR",
    counterparty: "Van Dijk Installatietechniek BV",
    direction: "expense",
  });

  const store: Record<string, unknown> = {};
  const result = addToQueue(
    store,
    { invoices: [entry.invoice], notices: [], processedIds: [message.messageId] } as never,
    "2026-08-17T09:00:00.000Z",
  );
  expect(result.addedInvoices).toBe(1);

  // Deze rij draagt een echte queueKey ("alexander-7f3a") en landt dus in zijn
  // EIGEN vak, niet bij de eigenaar (OWNER_KEY) — dat vak bestaat hier niet
  // eens, want er kwam geen enkel Gmail-bericht of sleutelloze mail binnen.
  const byKey = store.queueByKey as Record<string, Record<string, unknown>[]>;
  expect(byKey[OWNER_KEY]).toBeUndefined();
  const row = byKey["alexander-7f3a"][0];
  expect(row).toMatchObject({
    source: "inbound-mail",
    amountCents: 96800,
    from: "Van Dijk Installatietechniek <facturen@vandijk-installatie.nl>",
    deliveredTo: "alexander-7f3a@invoices.lavega.dev",
    queueKey: "alexander-7f3a",
    // SPF stond op pass, DKIM en DMARC op none. Dat is 'passed' — en dat betekent
    // alleen dat het domein klopte, niet dat de factuur echt is.
    senderCheck: "passed",
  });
});

test("een doorgestuurde mail zonder leesbare inhoud wordt een melding, geen stilte", () => {
  const message = normalizeInboundMail(INBOUND_STORAGE_REFERENCE);
  expect(message.ok).toBe(false);
  const notice = noticeForUnreadable({ ...message, reason: message.reason });
  expect(notice.kind).toBe("unreadable");
  expect(notice.reason).toContain("de bijlage ging niet mee");
  expect(notice.deliveredTo).toBe("alexander-7f3a@invoices.lavega.dev");
  expect(notice.senderCheck).toBe("failed");
  // Geen Gmail-link, want dit is geen Gmail-bericht.
  expect(notice.mailUrl).toBe("");
});

test("both setup kinds reach the owner's queue key and never become a Claude request", () => {
  const confirmation = normalizeInboundMail(GMAIL_CONFIRMATION_PAYLOAD);
  const test1 = normalizeInboundMail({
    ...INBOUND_WITH_PDF,
    messageId: "<t1>",
    subject: "LaVega test k3x9 factuur",
  });
  const notices = [];
  for (const m of [confirmation, test1]) {
    // The If-node: ok:false never reaches "Bouw Claude-verzoek".
    expect(m.ok).toBe(false);
    expect(m.setup).not.toBeNull();
    notices.push(noticeForSetup(m as never));
  }
  const store: Record<string, unknown> = {};
  const result = addToQueue(
    store,
    { invoices: [], notices, processedIds: notices.map((n) => n.messageId) } as never,
    "2026-10-21T14:00:00.000Z",
  );
  expect(result.addedNotices).toBe(2);
  const byKey = store.noticesByKey as Record<string, { kind: string; code: string }[]>;
  expect(byKey["alexander-7f3a"].map((n) => [n.kind, n.code])).toEqual([
    ["forwarding-confirmation", EXPECTED_CODE],
    ["setup-test", "k3x9"],
  ]);
  expect(byKey[OWNER_KEY]).toBeUndefined();
});

test("Gmail resending the same confirmation does not duplicate the notice", () => {
  const m = normalizeInboundMail(GMAIL_CONFIRMATION_PAYLOAD);
  const n = noticeForSetup(m as never);
  const store: Record<string, unknown> = {};
  addToQueue(store, { invoices: [], notices: [n], processedIds: [] } as never, "t1");
  const again = addToQueue(store, { invoices: [], notices: [n], processedIds: [] } as never, "t2");
  expect(again.addedNotices).toBe(0);
});
