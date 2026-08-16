import { expect, test } from "vitest";
import { buildClaudeRequest, requestSize, INVOICE_SYSTEM } from "./buildClaudeRequest.js";
import { normalizeGmailMessage } from "./normalizeGmailMessage.js";
import { encodeBase64Url, simulateGmailNode, type GmailNodeItem } from "./__fixtures__/gmailNode.js";
import { RAW_LINK_ONLY, RAW_PDF_INVOICE } from "./__fixtures__/rawMail.js";
import { legacyNormalise, legacyUserText } from "./__fixtures__/legacyNode.js";

function message(raw: string, id: string, downloadAttachments: boolean) {
  const item: GmailNodeItem = simulateGmailNode(encodeBase64Url(raw), { id, downloadAttachments });
  const attachments = Object.keys(item.binary).map((key) => ({
    key,
    fileName: item.binary[key].fileName,
    mimeType: item.binary[key].mimeType,
    data: item.binary[key].data,
  }));
  return normalizeGmailMessage(item.json, attachments);
}

function textBlock(request: ReturnType<typeof buildClaudeRequest>): string {
  const block = request.messages[0].content.find(
    (c) => (c as { type?: string }).type === "text",
  ) as { text: string };
  return block.text;
}

test("de PDF gaat als document-blok mee, met dezelfde base64 als in de mail", () => {
  const msg = message(RAW_PDF_INVOICE, "m-pdf", true);
  const request = buildClaudeRequest(msg);
  const size = requestSize(request);

  // eslint-disable-next-line no-console
  console.log(
    `[verzoek pdf-factuur] ${size.documents} document(en), ${size.textChars} tekens tekst, ` +
      `${size.pdfBytes} bytes PDF`,
  );

  expect(size.documents).toBe(1);
  const document = request.messages[0].content[0] as {
    type: string;
    source: { type: string; media_type: string; data: string };
  };
  expect(document.type).toBe("document");
  expect(document.source.media_type).toBe("application/pdf");
  expect(document.source.data).toBe(msg.pdfs[0].data);
  // De base64 moet ook echt een PDF zijn, geen id of pad.
  expect(Buffer.from(document.source.data, "base64").toString("utf8")).toContain("%PDF-1.4");

  const text = textBlock(request);
  expect(text).toContain("Bijlagen: factuur-2026-0184.pdf");
  expect(text).toContain("1.815,00");
});

test("zonder bijlage staat er GEEN regel 'Bijlagen:' — dat was de bewering die het model overnam", () => {
  const withPdf = buildClaudeRequest(message(RAW_PDF_INVOICE, "m-pdf", true));
  const withoutPdf = buildClaudeRequest(message(RAW_LINK_ONLY, "m-link", true));

  expect(textBlock(withPdf)).toMatch(/^Bijlagen: /m);
  expect(textBlock(withoutPdf)).not.toContain("Bijlagen");
  expect(requestSize(withoutPdf).documents).toBe(0);

  // ... en de mail zelf zit er wél volledig in.
  expect(textBlock(withoutPdf)).toContain("MijnKPN");
});

test("dezelfde mail vóór de fix: nul documenten en een lege bijlagenlijst", () => {
  // De oude node's eigen uitkomst, op de mail zoals de oude nodeconfiguratie
  // hem leverde: zonder bijlagen, en met alleen het text/plain-deel.
  const starved = legacyNormalise(simulateGmailNode(encodeBase64Url(RAW_PDF_INVOICE), { id: "m-pdf", downloadAttachments: false }));
  const legacyText = legacyUserText(starved);

  const fixed = buildClaudeRequest(message(RAW_PDF_INVOICE, "m-pdf", true));
  const size = requestSize(fixed);

  // eslint-disable-next-line no-console
  console.log(
    `[verzoek voor/na] voor: ${starved.pdfs.length} documenten, ${legacyText.length} tekens tekst, ` +
      `met de regel "Bijlagen: " leeg · na: ${size.documents} document, ${size.textChars} tekens tekst`,
  );

  expect(legacyText).toContain("Bijlagen: \n");
  expect(starved.pdfs).toEqual([]);
  expect(size.documents).toBe(1);
  expect(size.textChars).toBeGreaterThan(legacyText.length);
});

test("de systeemprompt vraagt om een soort, en verbiedt een verzonnen valuta", () => {
  expect(INVOICE_SYSTEM).toContain('"kind"');
  expect(INVOICE_SYSTEM).toContain("notification");
  expect(INVOICE_SYSTEM).toContain("staat er geen valuta, zet dan null");
  expect(INVOICE_SYSTEM).toContain("je ziet alleen wat je is meegegeven");
});

test("een afgekapte mail zegt dat tegen het model", () => {
  const long = { source: "gmail" as const, messageId: "x", subject: "s", from: "f", date: "d" };
  const msg = normalizeGmailMessage({ ...long, id: "x", text: "Bedrag. ".repeat(2000) }, []);
  expect(textBlock(buildClaudeRequest(msg))).toContain("De tekst hieronder is afgekapt");
});
