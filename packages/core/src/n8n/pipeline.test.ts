import { expect, test } from "vitest";
import { normalizeGmailMessage } from "./normalizeGmailMessage.js";
import { buildClaudeRequest, requestSize } from "./buildClaudeRequest.js";
import { noticeForUnreadable, parseModelJson, toQueueEntry } from "./claudeToLaVega.js";
import { addToQueue } from "./queue.js";
import { encodeBase64Url, simulateGmailNode } from "./__fixtures__/gmailNode.js";
import { RAW_HTML_ONLY, RAW_LINK_ONLY, RAW_NO_BODY, RAW_PDF_INVOICE } from "./__fixtures__/rawMail.js";

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
  const result = addToQueue(store, { invoices, notices, processedIds } as never, "2026-08-17T08:00:00.000Z");
  expect(result).toEqual({
    addedInvoices: 2,
    addedNotices: 2,
    inQueue: 2,
    noticesInQueue: 2,
    remembered: 4,
  });

  // Het antwoord aan LaVega, zoals "Geef de rij en leeg hem" het samenstelt.
  const body = { invoices: store.queue, notices: store.notices, servedAt: "2026-08-17T08:00:01.000Z" };
  expect((body.invoices as { amountCents: number }[]).map((i) => i.amountCents)).toEqual([181500, 18069]);
  expect((body.notices as { kind: string }[]).map((n) => n.kind)).toEqual(["notification", "unreadable"]);
  // Geen enkele melding draagt een bedrag: er is niets om per ongeluk te boeken.
  for (const notice of body.notices as Record<string, unknown>[]) {
    expect("amount" in notice).toBe(false);
    expect("amountCents" in notice).toBe(false);
  }
});

test("een tweede run op dezelfde mailbox stuurt niets opnieuw naar het model", () => {
  const store: Record<string, unknown> = { seenIds: ["m-pdf", "m-html", "m-link", "m-leeg"] };
  const seen = new Set(store.seenIds as string[]);
  const again = [run(RAW_PDF_INVOICE, "m-pdf"), run(RAW_HTML_ONLY, "m-html")].filter(
    (m) => !seen.has(m.messageId),
  );
  expect(again).toEqual([]);
});
